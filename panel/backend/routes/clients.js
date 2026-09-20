/**
 * @fileoverview Управление клиентами прокси.
 * Клиент панели = пользователь Telemt (синхронизация через Control API)
 * + метаданные в локальной БД (протоколы, заметки, TG).
 * @module routes/clients
 */

const express = require('express');
const { z } = require('zod');
const db = require('../db');
const telemt = require('../services/telemtApi');
const { clientLinks } = require('../services/links');
const { syncWebProfiles } = require('../services/webProfiles');
const { ensureQrToken } = require('../services/qrTokens');
const { httpError } = require('../middleware/errorHandler');
const logger = require('../utils/logger');

const router = express.Router();

/** Возвращает глобальный домен маскировки из настроек. */
function getMaskDomain() {
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get('mask_domain');
    return row ? JSON.parse(row.value) : 'www.cloudflare.com';
}

// --- Схемы валидации ---

// Дата принимается в любом парсящемся формате (ISO, YYYY-MM-DD и т.д.)
// и нормализуется в ISO 8601 — защита от различий браузеров/локалей.
const dateField = z.string()
    .refine((v) => !Number.isNaN(Date.parse(v)), 'Некорректная дата')
    .transform((v) => new Date(v).toISOString())
    .nullable().optional();

// Числа принимаем и как строки (форма может прислать строку)
const numField = (min, max) => {
    let s = z.coerce.number().int().min(min);
    if (max) s = s.max(max);
    return s.nullable().optional();
};

const clientSchema = z.object({
    username: z.string()
        .regex(/^[A-Za-z0-9_.-]{1,64}$/, 'Логин: латиница, цифры, _ . - (до 64 символов)'),
    quota_bytes: z.coerce.number().int().positive().nullable().optional(),
    expires_at: dateField,
    max_ips: numField(1, 100),
    rate_down_bps: numField(0),
    rate_up_bps: numField(0),
    ad_tag: z.string().regex(/^[0-9a-f]{32}$/, 'Ad Tag — 32 hex-символа').nullable().optional(),
    web_enabled: z.boolean().optional(),
    mtproto_enabled: z.boolean().optional(),
    note: z.string().max(500).nullable().optional(),
});

const patchSchema = clientSchema.partial().omit({ username: true });

/** Формирует тело CreateUserRequest для Telemt из данных клиента. */
function toTelemtUser(data) {
    const user = { username: data.username };
    if (data.quota_bytes) user.data_quota_bytes = data.quota_bytes;
    if (data.expires_at) user.expiration_rfc3339 = data.expires_at;
    if (data.max_ips) user.max_unique_ips = data.max_ips;
    if (data.rate_down_bps) user.rate_limit_down_bps = data.rate_down_bps;
    if (data.rate_up_bps) user.rate_limit_up_bps = data.rate_up_bps;
    if (data.ad_tag) user.user_ad_tag = data.ad_tag;
    return user;
}

/** Дополняет запись клиента вычисляемыми полями (ссылки, статус). */
function enrichClient(row) {
    const expired = row.expires_at && new Date(row.expires_at) < new Date();
    const status = expired ? 'expired' : row.status;
    return {
        ...row,
        status,
        quota_percent: row.quota_bytes
            ? Math.min(100, Math.round((row.traffic_used / row.quota_bytes) * 100))
            : null,
        links: clientLinks(row, getMaskDomain()),
    };
}

// --- Список клиентов с поиском и фильтрами ---
router.get('/', (req, res) => {
    const { search, status, page = '1', limit = '50' } = req.query;
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(200, Math.max(1, parseInt(limit, 10) || 50));

    let where = '1=1';
    const params = [];
    if (search) {
        where += ' AND username LIKE ?';
        params.push(`%${String(search).slice(0, 64)}%`);
    }
    if (status && ['active', 'blocked', 'expired'].includes(status)) {
        if (status === 'expired') {
            where += " AND expires_at IS NOT NULL AND expires_at < datetime('now')";
        } else {
            where += ' AND status = ?';
            params.push(status);
        }
    }

    const total = db.prepare(`SELECT COUNT(*) AS c FROM clients WHERE ${where}`).get(...params).c;
    const rows = db.prepare(
        `SELECT * FROM clients WHERE ${where}
         ORDER BY created_at DESC LIMIT ? OFFSET ?`
    ).all(...params, limitNum, (pageNum - 1) * limitNum);

    // Токены публичных QR-страниц генерируются при первом показе списка
    for (const row of rows) ensureQrToken(row.id);

    res.json({
        clients: rows.map(enrichClient),
        total,
        page: pageNum,
        pages: Math.ceil(total / limitNum),
    });
});

// --- Получить одного клиента ---
router.get('/:id', (req, res, next) => {
    try {
        const row = db.prepare('SELECT * FROM clients WHERE id = ?').get(req.params.id);
        if (!row) throw httpError(404, 'Клиент не найден');
        res.json(enrichClient(row));
    } catch (err) {
        next(err);
    }
});

// --- Создать клиента ---
router.post('/', async (req, res, next) => {
    try {
        const data = clientSchema.parse(req.body);

        const exists = db.prepare('SELECT id FROM clients WHERE username = ?').get(data.username);
        if (exists) throw httpError(409, 'Клиент с таким именем уже существует');

        // Создаём пользователя в Telemt — источник истины по секрету
        const created = await telemt.createUser(toTelemtUser(data));
        const secret = created.secret;

        const result = db.prepare(
            `INSERT INTO clients
             (username, secret, quota_bytes, expires_at, max_ips, rate_down_bps,
              rate_up_bps, ad_tag, web_enabled, mtproto_enabled, note)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(
            data.username, secret,
            data.quota_bytes ?? null, data.expires_at ?? null, data.max_ips ?? null,
            data.rate_down_bps ?? null, data.rate_up_bps ?? null, data.ad_tag ?? null,
            data.web_enabled === false ? 0 : 1,
            data.mtproto_enabled === false ? 0 : 1,
            data.note ?? null
        );

        logger.info('Клиент создан', { username: data.username });
        syncWebProfiles(); // добавляем WEB-профиль, если Web Proxy включён
        const row = db.prepare('SELECT * FROM clients WHERE id = ?').get(result.lastInsertRowid);
        res.status(201).json(enrichClient(row));
    } catch (err) {
        next(err);
    }
});

// --- Массовое создание (CSV) ---
router.post('/bulk', async (req, res, next) => {
    try {
        const schema = z.object({
            usernames: z.array(z.string().regex(/^[A-Za-z0-9_.-]{1,64}$/)).min(1).max(100),
            defaults: patchSchema.optional(),
        });
        const { usernames, defaults = {} } = schema.parse(req.body);

        const results = { created: [], errors: [] };
        for (const username of usernames) {
            try {
                const exists = db.prepare('SELECT id FROM clients WHERE username = ?').get(username);
                if (exists) throw new Error('уже существует');
                const created = await telemt.createUser(toTelemtUser({ username, ...defaults }));
                db.prepare(
                    `INSERT INTO clients
                     (username, secret, quota_bytes, expires_at, max_ips, rate_down_bps,
                      rate_up_bps, ad_tag, web_enabled, mtproto_enabled)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
                ).run(
                    username, created.secret,
                    defaults.quota_bytes ?? null, defaults.expires_at ?? null,
                    defaults.max_ips ?? null, defaults.rate_down_bps ?? null,
                    defaults.rate_up_bps ?? null, defaults.ad_tag ?? null,
                    defaults.web_enabled === false ? 0 : 1,
                    defaults.mtproto_enabled === false ? 0 : 1
                );
                results.created.push(username);
            } catch (err) {
                results.errors.push({ username, error: err.message });
            }
        }
        logger.info('Массовое создание клиентов', results);
        syncWebProfiles();
        res.json(results);
    } catch (err) {
        next(err);
    }
});

// --- Обновить клиента ---
router.patch('/:id', async (req, res, next) => {
    try {
        const row = db.prepare('SELECT * FROM clients WHERE id = ?').get(req.params.id);
        if (!row) throw httpError(404, 'Клиент не найден');

        const data = patchSchema.parse(req.body);

        // Обновляем в Telemt (null — снять ограничение)
        const patch = {};
        if ('quota_bytes' in data) patch.data_quota_bytes = data.quota_bytes;
        if ('expires_at' in data) patch.expiration_rfc3339 = data.expires_at;
        if ('max_ips' in data) patch.max_unique_ips = data.max_ips;
        if ('rate_down_bps' in data) patch.rate_limit_down_bps = data.rate_down_bps;
        if ('rate_up_bps' in data) patch.rate_limit_up_bps = data.rate_up_bps;
        if ('ad_tag' in data) patch.user_ad_tag = data.ad_tag;
        if (Object.keys(patch).length > 0) {
            await telemt.patchUser(row.username, patch);
        }

        const fields = [];
        const params = [];
        for (const key of ['quota_bytes', 'expires_at', 'max_ips', 'rate_down_bps',
                           'rate_up_bps', 'ad_tag', 'note']) {
            if (key in data) {
                fields.push(`${key} = ?`);
                params.push(data[key]);
            }
        }
        if ('web_enabled' in data) { fields.push('web_enabled = ?'); params.push(data.web_enabled ? 1 : 0); }
        if ('mtproto_enabled' in data) { fields.push('mtproto_enabled = ?'); params.push(data.mtproto_enabled ? 1 : 0); }

        if (fields.length > 0) {
            fields.push("updated_at = datetime('now')");
            params.push(row.id);
            db.prepare(`UPDATE clients SET ${fields.join(', ')} WHERE id = ?`).run(...params);
        }

        syncWebProfiles(); // web_enabled мог измениться
        const updated = db.prepare('SELECT * FROM clients WHERE id = ?').get(row.id);
        res.json(enrichClient(updated));
    } catch (err) {
        next(err);
    }
});

// --- Удалить клиента ---
router.delete('/:id', async (req, res, next) => {
    try {
        const row = db.prepare('SELECT * FROM clients WHERE id = ?').get(req.params.id);
        if (!row) throw httpError(404, 'Клиент не найден');

        // 1. Удаляем из БД панели (синк профилей больше не будет его включать)
        db.prepare('DELETE FROM clients WHERE id = ?').run(row.id);

        // 2. Убираем WEB-профиль ДО удаления пользователя в Telemt,
        //    иначе Telemt отклонит удаление (profile references unknown user)
        await syncWebProfiles();

        // 3. Теперь пользователь ни на что не ссылается — удаляем в Telemt
        await telemt.deleteUser(row.username);

        logger.info('Клиент удалён', { username: row.username });
        res.json({ ok: true });
    } catch (err) {
        next(err);
    }
});

// --- Включить / выключить клиента ---
router.post('/:id/toggle', async (req, res, next) => {
    try {
        const row = db.prepare('SELECT * FROM clients WHERE id = ?').get(req.params.id);
        if (!row) throw httpError(404, 'Клиент не найден');

        const enable = row.status !== 'active';
        if (enable) {
            await telemt.enableUser(row.username);
            db.prepare("UPDATE clients SET status = 'active', updated_at = datetime('now') WHERE id = ?").run(row.id);
        } else {
            await telemt.disableUser(row.username);
            db.prepare("UPDATE clients SET status = 'blocked', updated_at = datetime('now') WHERE id = ?").run(row.id);
        }
        res.json({ ok: true, status: enable ? 'active' : 'blocked' });
    } catch (err) {
        next(err);
    }
});

// --- Продлить доступ ---
router.post('/:id/extend', async (req, res, next) => {
    try {
        const schema = z.object({ days: z.number().int().min(1).max(3650) });
        const { days } = schema.parse(req.body);
        const row = db.prepare('SELECT * FROM clients WHERE id = ?').get(req.params.id);
        if (!row) throw httpError(404, 'Клиент не найден');

        // Продлеваем от текущей даты истечения, если она в будущем, иначе от сейчас
        const base = row.expires_at && new Date(row.expires_at) > new Date()
            ? new Date(row.expires_at)
            : new Date();
        const newExpiry = new Date(base.getTime() + days * 86400000).toISOString();

        await telemt.patchUser(row.username, { expiration_rfc3339: newExpiry });
        db.prepare("UPDATE clients SET expires_at = ?, status = 'active', updated_at = datetime('now') WHERE id = ?")
            .run(newExpiry, row.id);
        // Если клиент был заблокирован по просрочке — включаем обратно
        await telemt.enableUser(row.username).catch(() => {});

        res.json({ ok: true, expires_at: newExpiry });
    } catch (err) {
        next(err);
    }
});

// --- Перегенерировать секрет (ссылки обновятся) ---
router.post('/:id/rotate', async (req, res, next) => {
    try {
        const row = db.prepare('SELECT * FROM clients WHERE id = ?').get(req.params.id);
        if (!row) throw httpError(404, 'Клиент не найден');
        const result = await telemt.rotateSecret(row.username);
        db.prepare("UPDATE clients SET secret = ?, updated_at = datetime('now') WHERE id = ?")
            .run(result.secret, row.id);
        res.json({ ok: true, secret: result.secret });
    } catch (err) {
        next(err);
    }
});

// --- Сброс счётчика трафика ---
router.post('/:id/reset-quota', async (req, res, next) => {
    try {
        const row = db.prepare('SELECT * FROM clients WHERE id = ?').get(req.params.id);
        if (!row) throw httpError(404, 'Клиент не найден');
        await telemt.resetQuota(row.username);
        db.prepare('UPDATE clients SET traffic_used = 0 WHERE id = ?').run(row.id);
        res.json({ ok: true });
    } catch (err) {
        next(err);
    }
});

// --- История подключений клиента ---
router.get('/:id/history', (req, res, next) => {
    try {
        const row = db.prepare('SELECT * FROM clients WHERE id = ?').get(req.params.id);
        if (!row) throw httpError(404, 'Клиент не найден');
        const logs = db.prepare(
            'SELECT * FROM connection_logs WHERE username = ? ORDER BY created_at DESC LIMIT 200'
        ).all(row.username);
        res.json({ logs });
    } catch (err) {
        next(err);
    }
});

// --- Экспорт клиентов в CSV ---
router.get('/export/csv', (req, res) => {
    const rows = db.prepare('SELECT * FROM clients ORDER BY created_at DESC').all();
    const header = 'username,status,quota_bytes,traffic_used,expires_at,max_ips,web_enabled,mtproto_enabled,created_at';
    const lines = rows.map((r) =>
        [r.username, r.status, r.quota_bytes ?? '', r.traffic_used, r.expires_at ?? '',
         r.max_ips ?? '', r.web_enabled, r.mtproto_enabled, r.created_at].join(',')
    );
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="tggate-clients.csv"');
    res.send([header, ...lines].join('\n'));
});

module.exports = router;
