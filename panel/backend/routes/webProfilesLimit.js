/**
 * Настройка лимита WEB-профилей Telemt.
 *
 * Telemt отклоняет конфиг с ошибкой «WEB profiles exceed
 * web.limits.max_profiles», когда клиентов с Web Proxy больше лимита
 * (по умолчанию 32). Панель теперь хранит лимит в настройках и
 * применяет его в конфиг Telemt перед синхронизацией профилей.
 */
const express = require('express');
const { z } = require('zod');
const db = require('../db');
const telemt = require('../services/telemtApi');
const logger = require('../utils/logger');
const { httpError } = require('../middleware/errorHandler');

const router = express.Router();

const KEY = 'web_max_profiles';
const DEFAULT_LIMIT = 32;
/** Разумный потолок: профили держатся в памяти движка, бесконечно их задавать нельзя. */
const HARD_CAP = 512;

const LIMIT_RE = /^[1-9]\d{0,3}$/;

/** Текущий лимит: из настроек панели, иначе 32. */
function getLimit() {
    try {
        const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(KEY);
        const v = row ? Number(JSON.parse(row.value)) : NaN;
        return Number.isInteger(v) && v > 0 ? v : DEFAULT_LIMIT;
    } catch {
        return DEFAULT_LIMIT;
    }
}

/** Сохранить лимит в настройках панели. */
function setLimit(value) {
    db.prepare(
        'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
    ).run(KEY, JSON.stringify(value));
}

// --- Получить текущий лимит (из конфига Telemt и из настроек панели) ---
router.get('/web-profile-limit', async (req, res, next) => {
    try {
        const panel = getLimit();
        let engine = null;
        try {
            const cfg = await telemt.getConfig();
            const v = cfg?.web?.limits?.max_profiles;
            if (Number.isInteger(v)) engine = v;
        } catch { /* движок недоступен — покажем только панельное значение */ }
        res.json({ panel, engine, default: DEFAULT_LIMIT, hardCap: HARD_CAP });
    } catch (err) {
        next(err);
    }
});

// --- Применить лимит ---
router.post('/web-profile-limit', async (req, res, next) => {
    try {
        const schema = z.object({ limit: LIMIT_RE });
        const { limit } = schema.parse(req.body);
        const value = Math.min(Number(limit), HARD_CAP);

        // 1. Патчим конфиг Telemt: web.limits.max_profiles
        //    reload=false — только в файл; профили применит следующий sync
        await telemt.patchConfig({ web: { limits: { max_profiles: value } } }, false);

        // 2. Фиксируем в настройках панели
        setLimit(value);

        logger.info('Лимит WEB-профилей обновлён', { value });
        res.json({ ok: true, limit: value, message: `Лимит WEB-профилей: ${value}. Применён при следующей синхронизации профилей.` });
    } catch (err) {
        if (err.message && err.message.includes('Telemt')) {
            return next(httpError(502, err.message));
        }
        next(err);
    }
});

module.exports = router;