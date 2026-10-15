/**
 * Настройка лимита WEB-профилей Telemt.
 *
 * Telemt отклоняет конфиг с ошибкой «WEB profiles exceed
 * web.limits.max_profiles», когда клиентов с Web Proxy больше лимита
 * (по умолчанию 32). Панель хранит лимит в настройках и применяет его
 * в конфиг Telemt перед синхронизацией профилей.
 *
 * Свой потолок не вводится: настоящий предел знает только Telemt, он
 * сам отклонит недопустимое значение — панели остаётся показать его
 * ошибку пользователю.
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
/** Защита от опечаток вида 999999999, не бизнес-лимит. */
const SANITY_CAP = 1_000_000;

// ВАЖНО: zod-схема, а не RegExp. Раньше сюда был передан RegExp —
// zod падал с TypeError без статуса, и пользователь видел безликое
// «Внутренняя ошибка сервера» на любом значении.
const LimitSchema = z.object({
    limit: z.coerce.number().int().min(1).max(SANITY_CAP),
});

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
        res.json({ panel, engine, default: DEFAULT_LIMIT, sanityCap: SANITY_CAP });
    } catch (err) {
        next(err);
    }
});

// --- Применить лимит ---
router.post('/web-profile-limit', async (req, res, next) => {
    try {
        const { limit } = LimitSchema.parse(req.body);

        // 1. Патчим конфиг Telemt: web.limits.max_profiles.
        //    reload=false — только в файл; профили применит следующий sync.
        //    Если движок отклонил значение (свой потолок/формат) — показываем
        //    его текст как есть: это ответ на ввод пользователя, а не поломка.
        try {
            await telemt.patchConfig({ web: { limits: { max_profiles: limit } } }, false);
        } catch (e) {
            return next(httpError(400, e.message));
        }

        // 2. Фиксируем в настройках панели
        setLimit(limit);

        logger.info('Лимит WEB-профилей обновлён', { limit });
        res.json({ ok: true, limit, message: `Лимит WEB-профилей: ${limit}. Применён при следующей синхронизации профилей.` });
    } catch (err) {
        next(err);
    }
});

module.exports = router;