/**
 * @fileoverview Главный файл backend панели TGGATE.
 * Поднимает Express-сервер: API, статика фронтенда, WebSocket.
 * @module server
 */

const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const helmet = require('helmet');
const cors = require('cors');
const compression = require('compression');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');

const config = require('./config');
const logger = require('./utils/logger');
const db = require('./db'); // инициализация БД + миграции при require
const { requireAuth, csrfProtection, audit } = require('./middleware/auth');
const { notFound, errorHandler } = require('./middleware/errorHandler');
const wsHub = require('./services/wsHub');

// Роуты
const authRouter = require('./routes/auth');
const internalRouter = require('./routes/internal');
const clientsRouter = require('./routes/clients');
const statsRouter = require('./routes/stats');
const telemtRouter = require('./routes/telemt');
const logsRouter = require('./routes/logs');
const settingsModule = require('./routes/settings');
const qrRouter = require('./routes/qr');
const websiteRouter = require('./routes/website');
const botRouter = require('./routes/bot');
const apiKeysModule = require('./routes/apiKeys');
const apiV1Router = require('./routes/apiV1');
const paymentsRouter = require('./routes/payments');
const updatesRouter = require('./routes/updates');
const publicPagesRouter = require('./routes/publicPages');
const openapiSpec = require('./public-api/docs/openapi');

const app = express();
const server = http.createServer(app);

// Доверяем proxy-заголовкам от Nginx (реальный IP клиента)
app.set('trust proxy', 'loopback');

// ---------------------------------------------------------------------------
// Глобальные middleware
// ---------------------------------------------------------------------------
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'"], // Tailwind inline-стили
            imgSrc: ["'self'", 'data:'],
            connectSrc: ["'self'", 'wss:', 'ws:'],
        },
    },
}));
app.use(compression());
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());

// CORS: панель и API на одном домене — кросс-домен не нужен
app.use(cors({ origin: false }));

// Базовый rate limiting на все API
app.use('/api', rateLimit({
    windowMs: 60 * 1000,
    max: 300,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Слишком много запросов. Попробуйте через минуту.' },
}));

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

// Проверка живости (для install.sh и мониторинга) — без авторизации
app.get('/api/health', (req, res) => res.json({ ok: true, service: 'tggate-panel' }));

// Внутренние (только loopback): /api/internal/*
app.use('/api/internal', internalRouter);

// Аутентификация: /api/auth/*
app.use('/api/auth', csrfProtection, authRouter);

// Защищённые API: JWT + CSRF + аудит
app.use('/api/clients', requireAuth, csrfProtection, audit(db), clientsRouter);
app.use('/api/stats', requireAuth, statsRouter);
app.use('/api/telemt', requireAuth, csrfProtection, audit(db), telemtRouter);
app.use('/api/logs', requireAuth, logsRouter);
app.use('/api/settings', requireAuth, csrfProtection, audit(db), settingsModule.router);
app.use('/api/qr', qrRouter); // JWT проверяется внутри роутера (header или ?token=)
app.use('/api/website', requireAuth, csrfProtection, audit(db), websiteRouter);
app.use('/api/bot', requireAuth, csrfProtection, audit(db), botRouter);
app.use('/api/api-keys', requireAuth, csrfProtection, audit(db), apiKeysModule.router);
app.use('/api/updates', requireAuth, csrfProtection, audit(db), updatesRouter);
app.use('/api/payments', paymentsRouter); // внутри: вебхуки публичны, админское — JWT

// Публичный API v1 (по API-ключам)
app.use('/api/v1', apiV1Router);

// Документация API: JSON-спека + Swagger UI
app.get('/api/docs.json', (req, res) => res.json(openapiSpec));
app.get('/api/docs', (req, res) => {
    res.setHeader('Content-Security-Policy',
        "default-src 'self'; script-src 'self' https://unpkg.com; style-src 'self' 'unsafe-inline' https://unpkg.com; img-src 'self' data:");
    res.type('html').send(`<!DOCTYPE html>
<html lang="ru"><head><meta charset="UTF-8"><title>TGGATE API — документация</title>
<link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css"></head>
<body><div id="swagger-ui"></div>
<script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
<script>SwaggerUIBundle({ url: '/api/docs.json', dom_id: '#swagger-ui' });</script>
</body></html>`);
});

// Публичные страницы: /qr/:id и /status
app.use('/', publicPagesRouter);

// 404 для неизвестных API
app.use('/api', notFound);

// ---------------------------------------------------------------------------
// Статика фронтенда (SPA)
// ---------------------------------------------------------------------------
if (fs.existsSync(config.frontendDist)) {
    app.use(express.static(config.frontendDist, {
        maxAge: '7d',
        index: false,
    }));
    // SPA fallback: все не-API GET-запросы → index.html
    app.get('*', (req, res, next) => {
        if (req.path.startsWith('/api') || req.path.startsWith('/ws')) return next();
        res.sendFile(path.join(config.frontendDist, 'index.html'));
    });
}

// ---------------------------------------------------------------------------
// Обработка ошибок
// ---------------------------------------------------------------------------
app.use(errorHandler);

// ---------------------------------------------------------------------------
// Запуск
// ---------------------------------------------------------------------------
wsHub.init(server);

// Пуш системной статистики в WebSocket каждую секунду
const { getServerLoad } = require('./services/stats');
setInterval(async () => {
    const load = await getServerLoad();
    wsHub.broadcast('stats', load);
}, 1000).unref();

// Коллектор логов подключений из Telemt
require('./services/logCollector').start();

// Фоновые задачи: мониторинг, напоминания, бэкапы
require('./services/scheduler').start();

// Запуск TG-бота продаж (если настроен)
require('./services/bot').start().catch((err) =>
    logger.warn('TG-бот не запустился при старте', { error: err.message })
);

server.listen(config.port, config.host, () => {
    logger.info(`TGGATE панель запущена: http://${config.host}:${config.port}`);
    logger.info(`Домен: ${config.domain}, путь админки: /${config.adminPath}/`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
    logger.info('Получен SIGTERM, завершаю работу...');
    server.close(() => process.exit(0));
});
process.on('SIGINT', () => {
    server.close(() => process.exit(0));
});
