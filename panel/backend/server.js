/**
 * @fileoverview Р“Р»Р°РІРЅС‹Р№ С„Р°Р№Р» backend РїР°РЅРµР»Рё TGGATE.
 * РџРѕРґРЅРёРјР°РµС‚ Express-СЃРµСЂРІРµСЂ: API, СЃС‚Р°С‚РёРєР° С„СЂРѕРЅС‚РµРЅРґР°, WebSocket.
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
const db = require('./db'); // РёРЅРёС†РёР°Р»РёР·Р°С†РёСЏ Р‘Р” + РјРёРіСЂР°С†РёРё РїСЂРё require
const { requireAuth, csrfProtection, audit } = require('./middleware/auth');
const { notFound, errorHandler } = require('./middleware/errorHandler');
const wsHub = require('./services/wsHub');

// Р РѕСѓС‚С‹
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
const salesRouter = require('./routes/sales');
const zapret2Router = require('./routes/zapret2');
const geoRouter = require('./routes/geo');
const publicPagesRouter = require('./routes/publicPages');
const openapiSpec = require('./public-api/docs/openapi');

const app = express();
const server = http.createServer(app);

// Р”РѕРІРµСЂСЏРµРј proxy-Р·Р°РіРѕР»РѕРІРєР°Рј РѕС‚ Nginx (СЂРµР°Р»СЊРЅС‹Р№ IP РєР»РёРµРЅС‚Р°)
app.set('trust proxy', 'loopback');

// ---------------------------------------------------------------------------
// Р“Р»РѕР±Р°Р»СЊРЅС‹Рµ middleware
// ---------------------------------------------------------------------------
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'"], // Tailwind inline-СЃС‚РёР»Рё
            imgSrc: ["'self'", 'data:'],
            connectSrc: ["'self'", 'wss:', 'ws:'],
        },
    },
}));
// Р‘СЌРєР°Рї: Р·Р°РіСЂСѓР·РєР° С„Р°Р№Р»Р° РјРѕР¶РµС‚ Р±С‹С‚СЊ Р±РѕР»СЊС€РѕР№ вЂ” РѕС‚РґРµР»СЊРЅС‹Р№ Р»РёРјРёС‚ Р”Рћ РіР»РѕР±Р°Р»СЊРЅРѕРіРѕ json
app.use('/api/backup/restore', express.json({ limit: '60mb' }));

app.use(compression());
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());

// CORS: РїР°РЅРµР»СЊ Рё API РЅР° РѕРґРЅРѕРј РґРѕРјРµРЅРµ вЂ” РєСЂРѕСЃСЃ-РґРѕРјРµРЅ РЅРµ РЅСѓР¶РµРЅ
app.use(cors({ origin: false }));

// Р‘Р°Р·РѕРІС‹Р№ rate limiting РЅР° РІСЃРµ API
app.use('/api', rateLimit({
    windowMs: 60 * 1000,
    max: 300,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'РЎР»РёС€РєРѕРј РјРЅРѕРіРѕ Р·Р°РїСЂРѕСЃРѕРІ. РџРѕРїСЂРѕР±СѓР№С‚Рµ С‡РµСЂРµР· РјРёРЅСѓС‚Сѓ.' },
}));

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

// Р’РµСЂСЃРёСЏ РїР°РЅРµР»Рё РёР· С„Р°Р№Р»Р° VERSION (РєСЌС€РёСЂСѓРµРј РїСЂРё СЃС‚Р°СЂС‚Рµ)
const PANEL_VERSION = (() => {
    try {
        return fs.readFileSync(path.join(__dirname, '..', '..', 'VERSION'), 'utf8').trim();
    } catch {
        return '1.0.0';
    }
})();

// РџСЂРѕРІРµСЂРєР° Р¶РёРІРѕСЃС‚Рё (РґР»СЏ install.sh Рё РјРѕРЅРёС‚РѕСЂРёРЅРіР°) вЂ” Р±РµР· Р°РІС‚РѕСЂРёР·Р°С†РёРё
app.get('/api/health', (req, res) => res.json({ ok: true, service: 'tggate-panel', version: PANEL_VERSION }));

// Р’РЅСѓС‚СЂРµРЅРЅРёРµ (С‚РѕР»СЊРєРѕ loopback): /api/internal/*
app.use('/api/internal', internalRouter);

// Р‘СЌРєР°Рї-СЂРѕСѓС‚ (restore СЃРјРѕРЅС‚РёСЂРѕРІР°РЅ РІС‹С€Рµ СЃ СѓРІРµР»РёС‡РµРЅРЅС‹Рј Р»РёРјРёС‚РѕРј)
const backupRouter = require('./routes/backup');
app.use('/api/backup', backupRouter);

// РђСѓС‚РµРЅС‚РёС„РёРєР°С†РёСЏ: /api/auth/*
app.use('/api/auth', csrfProtection, authRouter);

// Р—Р°С‰РёС‰С‘РЅРЅС‹Рµ API: JWT + CSRF + Р°СѓРґРёС‚
app.use('/api/clients', requireAuth, csrfProtection, audit(db), clientsRouter);
app.use('/api/stats', requireAuth, statsRouter);
app.use('/api/telemt', requireAuth, csrfProtection, audit(db), telemtRouter);
app.use('/api/logs', requireAuth, logsRouter);
app.use('/api/settings', requireAuth, csrfProtection, audit(db), settingsModule.router);
app.use('/api/qr', qrRouter); // JWT РїСЂРѕРІРµСЂСЏРµС‚СЃСЏ РІРЅСѓС‚СЂРё СЂРѕСѓС‚РµСЂР° (header РёР»Рё ?token=)
app.use('/api/website', requireAuth, csrfProtection, audit(db), websiteRouter);
app.use('/api/bot', requireAuth, csrfProtection, audit(db), botRouter);
app.use('/api/api-keys', requireAuth, csrfProtection, audit(db), apiKeysModule.router);
app.use('/api/updates', requireAuth, csrfProtection, audit(db), updatesRouter);
app.use('/api/zapret2', requireAuth, csrfProtection, audit(db), zapret2Router.router);
app.use('/api/geo', requireAuth, geoRouter);
app.use('/api/sales', requireAuth, salesRouter);
app.use('/api/payments', paymentsRouter.router); // РІРЅСѓС‚СЂРё: РІРµР±С…СѓРєРё РїСѓР±Р»РёС‡РЅС‹, Р°РґРјРёРЅСЃРєРѕРµ вЂ” JWT

// РџСѓР±Р»РёС‡РЅС‹Р№ API v1 (РїРѕ API-РєР»СЋС‡Р°Рј). РџСЂРµС„РёРєСЃ /panel-api вЂ” РїРѕС‚РѕРјСѓ С‡С‚Рѕ
// /api/v1/* РЅР° РїСѓР±Р»РёС‡РЅРѕРј РґРѕРјРµРЅРµ РїСЂРёРЅР°РґР»РµР¶РёС‚ Telemt WEB (carrier-РїСѓС‚Рё).
app.use('/panel-api/v1', apiV1Router);

// Р”РѕРєСѓРјРµРЅС‚Р°С†РёСЏ API: JSON-СЃРїРµРєР° + Swagger UI (Р»РѕРєР°Р»СЊРЅР°СЏ РєРѕРїРёСЏ, Р±РµР· CDN)
const pathSwagger = require.resolve('swagger-ui-dist/swagger-ui.css');
app.use('/api/docs-assets', express.static(require('path').dirname(pathSwagger)));
app.get('/api/docs.json', (req, res) => res.json(openapiSpec));
app.get('/api/docs', (req, res) => {
    // РРЅР»Р°Р№РЅ-СЃРєСЂРёРїС‚ РёРЅРёС†РёР°Р»РёР·Р°С†РёРё вЂ” СЂР°Р·СЂРµС€Р°РµРј unsafe-inline С‚РѕР»СЊРєРѕ Р·РґРµСЃСЊ
    res.setHeader('Content-Security-Policy',
        "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:");
    res.type('html').send(`<!DOCTYPE html>
<html lang="ru"><head><meta charset="UTF-8"><title>TGGATE API вЂ” РґРѕРєСѓРјРµРЅС‚Р°С†РёСЏ</title>
<link rel="stylesheet" href="/api/docs-assets/swagger-ui.css"></head>
<body><div id="swagger-ui"></div>
<script src="/api/docs-assets/swagger-ui-bundle.js"></script>
<script>SwaggerUIBundle({ url: '/api/docs.json', dom_id: '#swagger-ui' });</script>
</body></html>`);
});

// РџСѓР±Р»РёС‡РЅС‹Рµ СЃС‚СЂР°РЅРёС†С‹: /qr/:id Рё /status
app.use('/', publicPagesRouter);

// 404 РґР»СЏ РЅРµРёР·РІРµСЃС‚РЅС‹С… API
app.use('/api', notFound);

// ---------------------------------------------------------------------------
// РЎС‚Р°С‚РёРєР° С„СЂРѕРЅС‚РµРЅРґР° (SPA)
// ---------------------------------------------------------------------------
if (fs.existsSync(config.frontendDist)) {
    app.use(express.static(config.frontendDist, {
        maxAge: '7d',
        index: false,
    }));
    // SPA fallback: РІСЃРµ РЅРµ-API GET-Р·Р°РїСЂРѕСЃС‹ в†’ index.html
    app.get('*', (req, res, next) => {
        if (req.path.startsWith('/api') || req.path.startsWith('/ws')) return next();
        res.sendFile(path.join(config.frontendDist, 'index.html'));
    });
}

// ---------------------------------------------------------------------------
// РћР±СЂР°Р±РѕС‚РєР° РѕС€РёР±РѕРє
// ---------------------------------------------------------------------------
app.use(errorHandler);

// ---------------------------------------------------------------------------
// Р—Р°РїСѓСЃРє
// ---------------------------------------------------------------------------
wsHub.init(server);

// РџСѓС€ СЃРёСЃС‚РµРјРЅРѕР№ СЃС‚Р°С‚РёСЃС‚РёРєРё РІ WebSocket РєР°Р¶РґСѓСЋ СЃРµРєСѓРЅРґСѓ
const { getServerLoad } = require('./services/stats');
setInterval(async () => {
    const load = await getServerLoad();
    wsHub.broadcast('stats', load);
}, 1000).unref();

// РљРѕР»Р»РµРєС‚РѕСЂ Р»РѕРіРѕРІ РїРѕРґРєР»СЋС‡РµРЅРёР№ РёР· Telemt
require('./services/logCollector').start();

// РЎР±РѕСЂС‰РёРє С‚СЂР°С„РёРєР° РїРѕ РєР»РёРµРЅС‚Р°Рј (РґРµР»СЊС‚Р° total_octets СЂР°Р· РІ РјРёРЅСѓС‚Сѓ)
require('./services/trafficCollector').start();

// Р–РёРІРѕР№ РіСЂР°С„РёРє СЃРєРѕСЂРѕСЃС‚Рё С‚СЂР°С„РёРєР° (Р·Р°РјРµСЂ РєР°Р¶РґС‹Рµ 5 СЃРµРєСѓРЅРґ)
require('./services/trafficLive').start();

// РџРµСЂРёРѕРґРёС‡РµСЃРєР°СЏ СЃРІРµСЂРєР° WEB-РїСЂРѕС„РёР»РµР№ (СЃР°РјРѕРІРѕСЃСЃС‚Р°РЅРѕРІР»РµРЅРёРµ, СЂР°Р· РІ 60 СЃРµРєСѓРЅРґ)
const { syncWebProfiles } = require('./services/webProfiles');
setInterval(() => syncWebProfiles(), 60000).unref();
syncWebProfiles();

// Р¤РѕРЅРѕРІС‹Рµ Р·Р°РґР°С‡Рё: РјРѕРЅРёС‚РѕСЂРёРЅРі, РЅР°РїРѕРјРёРЅР°РЅРёСЏ, Р±СЌРєР°РїС‹
require('./services/scheduler').start();

// Р—Р°РїСѓСЃРє TG-Р±РѕС‚Р° РїСЂРѕРґР°Р¶ (РµСЃР»Рё РЅР°СЃС‚СЂРѕРµРЅ)
require('./services/bot').start().catch((err) =>
    logger.warn('TG-Р±РѕС‚ РЅРµ Р·Р°РїСѓСЃС‚РёР»СЃСЏ РїСЂРё СЃС‚Р°СЂС‚Рµ', { error: err.message })
);

server.listen(config.port, config.host, () => {
    logger.info(`TGGATE РїР°РЅРµР»СЊ Р·Р°РїСѓС‰РµРЅР°: http://${config.host}:${config.port}`);
    logger.info(`Р”РѕРјРµРЅ: ${config.domain}, РїСѓС‚СЊ Р°РґРјРёРЅРєРё: /${config.adminPath}/`);
});

// Graceful shutdown
// Graceful shutdown: Р·Р°РєСЂС‹РІР°РµРј WS-РєР»РёРµРЅС‚С‹ Рё СЃРµСЂРІРµСЂ, С„РѕСЂСЃ-РІС‹С…РѕРґ Р·Р° 3 СЃРµРє
// (РёРЅР°С‡Рµ РѕС‚РєСЂС‹С‚С‹Рµ WebSocket-СЃРѕРµРґРёРЅРµРЅРёСЏ РґРµСЂР¶Р°С‚ РїСЂРѕС†РµСЃСЃ 90 СЃРµРєСѓРЅРґ вЂ” 502 РїСЂРё СЂРµСЃС‚Р°СЂС‚Рµ)
async function shutdown(signal) {
    logger.info(`РџРѕР»СѓС‡РµРЅ ${signal}, Р·Р°РІРµСЂС€Р°СЋ СЂР°Р±РѕС‚Сѓ...`);
    try { wsHub.closeAll(); } catch { /* ignore */ }
    try { server.closeAllConnections?.(); } catch { /* СЃС‚Р°СЂС‹Рµ РІРµСЂСЃРёРё Node */ }
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 3000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
