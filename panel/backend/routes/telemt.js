/**
 * @fileoverview Роуты управления Telemt через панель:
 * статус/версия, просмотр и правка config.toml, перезапуск, Pulse-диагностика.
 * @module routes/telemt
 */

const express = require('express');
const fs = require('fs');
const { execSync } = require('child_process');
const { z } = require('zod');
const telemt = require('../services/telemtApi');
const config = require('../config');
const { httpError } = require('../middleware/errorHandler');
const logger = require('../utils/logger');

const router = express.Router();

// --- Статус и версия Telemt ---
router.get('/status', async (req, res, next) => {
    try {
        const [health, info, webStatus] = await Promise.all([
            telemt.getHealth(),
            telemt.getSystemInfo(),
            telemt.getWebStatus().catch(() => null),
        ]);
        res.json({ ok: true, health, info, web: webStatus });
    } catch (err) {
        // Telemt недоступен — возвращаем понятный ответ, а не 500
        res.json({ ok: false, error: err.message });
    }
});

// --- Прочитать config.toml ---
router.get('/config', (req, res, next) => {
    try {
        if (!fs.existsSync(config.telemt.configPath)) {
            throw httpError(404, 'Файл конфигурации Telemt не найден');
        }
        const content = fs.readFileSync(config.telemt.configPath, 'utf8');
        res.json({ content, path: config.telemt.configPath });
    } catch (err) {
        next(err);
    }
});

// --- Сохранить config.toml и применить через reload ---
router.put('/config', async (req, res, next) => {
    try {
        const schema = z.object({ content: z.string().min(1).max(1024 * 1024) });
        const { content } = schema.parse(req.body);

        // Бэкап текущего конфига перед правкой
        if (fs.existsSync(config.telemt.configPath)) {
            fs.copyFileSync(config.telemt.configPath, config.telemt.configPath + '.bak');
        }
        fs.writeFileSync(config.telemt.configPath, content, 'utf8');
        logger.info('config.toml обновлён через панель');

        // Применяем через runtime reload (drain + rollback при ошибке)
        let reloadResult = null;
        try {
            reloadResult = await telemt.reload();
        } catch (err) {
            // Откатываем файл, если reload не принят
            fs.copyFileSync(config.telemt.configPath + '.bak', config.telemt.configPath);
            throw httpError(400, `Конфигурация отклонена Telemt: ${err.message}`);
        }
        res.json({ ok: true, reload: reloadResult });
    } catch (err) {
        next(err);
    }
});

// --- Перезапуск сервиса telemt ---
router.post('/restart', (req, res, next) => {
    try {
        execSync('systemctl restart telemt', { timeout: 30000 });
        logger.info('Telemt перезапущен через панель');
        res.json({ ok: true });
    } catch (err) {
        next(httpError(500, 'Не удалось перезапустить Telemt: ' + err.message));
    }
});

// --- Pulse-диагностика: активные WEB-сессии ---
router.get('/web/sessions', async (req, res, next) => {
    try {
        const { user, ip, limit } = req.query;
        const query = {};
        if (user) query.user = String(user);
        if (ip) query.ip = String(ip);
        if (limit) query.limit = String(Math.min(200, parseInt(limit, 10) || 50));
        const sessions = await telemt.getWebSessions(query);
        res.json(sessions);
    } catch (err) {
        next(err);
    }
});

// --- Закрыть WEB-сессии (например, «заморозка») ---
router.post('/web/sessions/close', async (req, res, next) => {
    try {
        const schema = z.object({
            kind: z.enum(['refs', 'filter', 'all']),
            session_refs: z.array(z.string()).max(200).optional(),
            user: z.string().optional(),
            ip: z.string().optional(),
        });
        const body = schema.parse(req.body);
        const result = await telemt.closeWebSessions(body);
        logger.warn('WEB-сессии закрыты через панель', { selector: body });
        res.json(result);
    } catch (err) {
        next(err);
    }
});

// --- Применить изменение настроек прокси через PATCH /v1/config ---
router.patch('/config', async (req, res, next) => {
    try {
        const schema = z.object({ patch: z.record(z.unknown()) });
        const { patch } = schema.parse(req.body);
        const result = await telemt.patchConfig(patch);
        logger.info('Конфигурация Telemt изменена через API', { patch });
        res.json(result);
    } catch (err) {
        next(err);
    }
});

module.exports = router;
