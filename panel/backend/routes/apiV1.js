/**
 * @fileoverview Публичный REST API v1 для разработчиков (по API-ключам).
 * @module routes/apiV1
 */

const express = require('express');
const rateLimit = require('express-rate-limit');
const { z } = require('zod');
const db = require('../db');
const telemt = require('../services/telemtApi');
const { clientLinks } = require('../services/links');
const { requireApiKey } = require('../middleware/apiKey');
const { httpError } = require('../middleware/errorHandler');
const { fireWebhook } = require('../services/webhooks');
const { syncWebProfiles } = require('../services/webProfiles');
const { getAll } = require('./settings');
const logger = require('../utils/logger');

const router = express.Router();

// Жёсткий лимит на публичный API
router.use(rateLimit({
    windowMs: 60 * 1000,
    max: 60,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Превышен лимит запросов (60/мин)' },
}));

// --- Список клиентов (read) ---
router.get('/clients', requireApiKey('read'), (req, res) => {
    const rows = db.prepare('SELECT id, username, status, quota_bytes, traffic_used, expires_at, created_at FROM clients ORDER BY created_at DESC').all();
    res.json({ clients: rows });
});

// --- Создать клиента (write) — полный набор параметров для ботов ---
router.post('/clients', requireApiKey('write'), async (req, res, next) => {
    try {
        const schema = z.object({
            username: z.string().regex(/^[A-Za-z0-9_.-]{1,64}$/),
            days: z.number().int().min(1).max(3650).optional(),        // срок доступа
            quota_gb: z.number().positive().optional(),                 // квота трафика, ГБ
            max_ips: z.number().int().min(1).max(100).optional(),       // макс. активных IP
            rate_down_mbps: z.number().positive().optional(),           // скорость скачивания, Мбит/с
            rate_up_mbps: z.number().positive().optional(),             // скорость загрузки, Мбит/с
            protocols: z.enum(['web', 'mtproto', 'both']).optional(),   // протоколы
            ad_tag: z.string().regex(/^[0-9a-f]{32}$/).optional(),      // Ad Tag спонсора
            telegram_id: z.number().int().optional(),                   // TG клиента (для рассылок)
        });
        const data = schema.parse(req.body);

        const exists = db.prepare('SELECT id FROM clients WHERE username = ?').get(data.username);
        if (exists) throw httpError(409, 'Клиент с таким именем уже существует');

        const expires = data.days ? new Date(Date.now() + data.days * 86400000).toISOString() : null;
        const quotaBytes = data.quota_gb ? Math.round(data.quota_gb * 1024 ** 3) : null;
        const created = await telemt.createUser({
            username: data.username,
            ...(expires && { expiration_rfc3339: expires }),
            ...(quotaBytes && { data_quota_bytes: quotaBytes }),
            ...(data.max_ips && { max_unique_ips: data.max_ips }),
            ...(data.rate_down_mbps && { rate_limit_down_bps: Math.round(data.rate_down_mbps * 1e6) }),
            ...(data.rate_up_mbps && { rate_limit_up_bps: Math.round(data.rate_up_mbps * 1e6) }),
            ...(data.ad_tag && { user_ad_tag: data.ad_tag }),
        });

        const web = data.protocols !== 'mtproto';       // both | web → web вкл
        const mtproto = data.protocols !== 'web';       // both | mtproto → mtproto вкл

        const result = db.prepare(
            `INSERT INTO clients (username, secret, quota_bytes, expires_at, max_ips,
             rate_down_bps, rate_up_bps, ad_tag, web_enabled, mtproto_enabled, telegram_id)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(
            data.username, created.secret, quotaBytes, expires,
            data.max_ips ?? null,
            data.rate_down_mbps ? Math.round(data.rate_down_mbps * 1e6) : null,
            data.rate_up_mbps ? Math.round(data.rate_up_mbps * 1e6) : null,
            data.ad_tag ?? null, web ? 1 : 0, mtproto ? 1 : 0,
            data.telegram_id ?? null
        );

        const client = db.prepare('SELECT * FROM clients WHERE id = ?').get(result.lastInsertRowid);
        const settings = getAll();
        logger.info('Клиент создан через публичный API', { username: data.username, key: req.apiKey.name });
        syncWebProfiles();
        fireWebhook('client.created', { username: data.username, expires_at: expires });

        res.status(201).json({ client, links: clientLinks(client, settings.mask_domain) });
    } catch (err) {
        next(err);
    }
});

// --- Обновить клиента (write): срок, квота, IP, скорости, протоколы, статус ---
router.patch('/clients/:id', requireApiKey('write'), async (req, res, next) => {
    try {
        const schema = z.object({
            days: z.number().int().min(1).max(3650).optional(),      // добавить дней к текущему сроку
            quota_gb: z.number().positive().nullable().optional(),
            max_ips: z.number().int().min(1).max(100).nullable().optional(),
            rate_down_mbps: z.number().positive().nullable().optional(),
            rate_up_mbps: z.number().positive().nullable().optional(),
            protocols: z.enum(['web', 'mtproto', 'both']).optional(),
            enabled: z.boolean().optional(),
        });
        const data = schema.parse(req.body);
        const client = db.prepare('SELECT * FROM clients WHERE id = ?').get(req.params.id);
        if (!client) throw httpError(404, 'Клиент не найден');

        const patch = {};
        if (data.days) {
            const base = client.expires_at && new Date(client.expires_at) > new Date()
                ? new Date(client.expires_at) : new Date();
            patch.expiration_rfc3339 = new Date(base.getTime() + data.days * 86400000).toISOString();
        }
        if (data.quota_gb !== undefined) patch.data_quota_bytes = data.quota_gb ? Math.round(data.quota_gb * 1024 ** 3) : null;
        if (data.max_ips !== undefined) patch.max_unique_ips = data.max_ips;
        if (data.rate_down_mbps !== undefined) patch.rate_limit_down_bps = data.rate_down_mbps ? Math.round(data.rate_down_mbps * 1e6) : null;
        if (data.rate_up_mbps !== undefined) patch.rate_limit_up_bps = data.rate_up_mbps ? Math.round(data.rate_up_mbps * 1e6) : null;
        if (data.enabled !== undefined) patch.enabled = data.enabled;
        if (Object.keys(patch).length > 0) await telemt.patchUser(client.username, patch);

        // Локальная БД
        const fields = [];
        const params = [];
        if (patch.expiration_rfc3339) { fields.push('expires_at = ?'); params.push(patch.expiration_rfc3339); }
        if (data.quota_gb !== undefined) { fields.push('quota_bytes = ?'); params.push(patch.data_quota_bytes); }
        if (data.max_ips !== undefined) { fields.push('max_ips = ?'); params.push(data.max_ips); }
        if (data.rate_down_mbps !== undefined) { fields.push('rate_down_bps = ?'); params.push(patch.rate_limit_down_bps); }
        if (data.rate_up_mbps !== undefined) { fields.push('rate_up_bps = ?'); params.push(patch.rate_limit_up_bps); }
        if (data.protocols) {
            fields.push('web_enabled = ?', 'mtproto_enabled = ?');
            params.push(data.protocols !== 'mtproto' ? 1 : 0, data.protocols !== 'web' ? 1 : 0);
        }
        if (data.enabled !== undefined) {
            fields.push('status = ?');
            params.push(data.enabled ? 'active' : 'blocked');
        }
        if (fields.length > 0) {
            fields.push("updated_at = datetime('now')");
            params.push(client.id);
            db.prepare(`UPDATE clients SET ${fields.join(', ')} WHERE id = ?`).run(...params);
        }

        syncWebProfiles();
        const updated = db.prepare('SELECT * FROM clients WHERE id = ?').get(client.id);
        res.json({ client: updated });
    } catch (err) {
        next(err);
    }
});

// --- Получить/обновить/удалить клиента ---
router.get('/clients/:id', requireApiKey('read'), (req, res, next) => {
    try {
        const client = db.prepare('SELECT * FROM clients WHERE id = ?').get(req.params.id);
        if (!client) throw httpError(404, 'Клиент не найден');
        res.json({ client });
    } catch (err) { next(err); }
});

router.delete('/clients/:id', requireApiKey('write'), async (req, res, next) => {
    try {
        const client = db.prepare('SELECT * FROM clients WHERE id = ?').get(req.params.id);
        if (!client) throw httpError(404, 'Клиент не найден');
        // Порядок критичен: сначала профиль, потом пользователь
        db.prepare('DELETE FROM clients WHERE id = ?').run(client.id);
        await syncWebProfiles();
        await telemt.deleteUser(client.username);
        res.json({ ok: true });
    } catch (err) { next(err); }
});

// --- Ссылки подключения ---
router.get('/clients/:id/links', requireApiKey('read'), (req, res, next) => {
    try {
        const client = db.prepare('SELECT * FROM clients WHERE id = ?').get(req.params.id);
        if (!client) throw httpError(404, 'Клиент не найден');
        const settings = getAll();
        res.json({ links: clientLinks(client, settings.mask_domain) });
    } catch (err) { next(err); }
});

// --- QR-код (base64) ---
router.get('/clients/:id/qr', requireApiKey('read'), async (req, res, next) => {
    try {
        const client = db.prepare('SELECT * FROM clients WHERE id = ?').get(req.params.id);
        if (!client) throw httpError(404, 'Клиент не найден');
        const QRCode = require('qrcode');
        const settings = getAll();
        const links = clientLinks(client, settings.mask_domain);
        const out = {};
        if (links.web) out.web = await QRCode.toDataURL(links.web, { width: 512 });
        if (links.mtproto) out.mtproto = await QRCode.toDataURL(links.mtproto, { width: 512 });
        res.json({ qr: out });
    } catch (err) { next(err); }
});

// --- Продлить доступ ---
router.post('/extend/:id', requireApiKey('write'), async (req, res, next) => {
    try {
        const schema = z.object({ days: z.number().int().min(1).max(3650) });
        const { days } = schema.parse(req.body);
        const client = db.prepare('SELECT * FROM clients WHERE id = ?').get(req.params.id);
        if (!client) throw httpError(404, 'Клиент не найден');

        const base = client.expires_at && new Date(client.expires_at) > new Date()
            ? new Date(client.expires_at) : new Date();
        const newExpiry = new Date(base.getTime() + days * 86400000).toISOString();
        await telemt.patchUser(client.username, { expiration_rfc3339: newExpiry });
        db.prepare("UPDATE clients SET expires_at = ?, status = 'active' WHERE id = ?").run(newExpiry, client.id);
        res.json({ ok: true, expires_at: newExpiry });
    } catch (err) { next(err); }
});

// --- Активные подключения клиента: IP, страна, протокол (для ботов) ---
router.get('/clients/:id/connections', requireApiKey('read'), async (req, res, next) => {
    try {
        const client = db.prepare('SELECT * FROM clients WHERE id = ?').get(req.params.id);
        if (!client) throw httpError(404, 'Клиент не найден');
        const geo = require('../services/geo');

        const connections = [];
        // MTProto: активные IP из Telemt
        try {
            const users = await telemt.getUsersActiveIps().catch(() => []);
            const me = (Array.isArray(users) ? users : users?.users || [])
                .find((u) => u.username === client.username);
            for (const ip of me?.active_ips || []) {
                connections.push({ ip, protocol: 'mtproto' });
            }
        } catch { /* пропускаем */ }
        // WEB: активные сессии
        try {
            const sessions = await telemt.getWebSessions({ user: client.username, limit: 50 });
            const list = Array.isArray(sessions) ? sessions : sessions?.sessions || [];
            for (const s of list) {
                if (s.ip) connections.push({ ip: s.ip, protocol: 'web', carrier: s.carrier || null });
            }
        } catch { /* пропускаем */ }

        const geoMap = await geo.lookupMany(connections.map((c) => c.ip));
        for (const c of connections) c.country = geoMap[c.ip]?.country || '—';

        res.json({ active: connections.length, connections });
    } catch (err) { next(err); }
});

// --- Статистика сервера ---
router.get('/stats', requireApiKey('read'), async (req, res, next) => {
    try {
        const summary = await telemt.getStatsSummary().catch(() => null);
        const clients = db.prepare("SELECT COUNT(*) AS total, SUM(CASE WHEN status='active' THEN 1 ELSE 0 END) AS active FROM clients").get();
        res.json({ clients, telemt: summary });
    } catch (err) { next(err); }
});

// --- Статистика трафика ---
router.get('/stats/traffic', requireApiKey('read'), (req, res) => {
    const rows = db.prepare(
        `SELECT date, SUM(bytes) AS bytes FROM traffic_daily
         WHERE date >= date('now','-30 days') GROUP BY date ORDER BY date`
    ).all();
    res.json({ traffic: rows });
});

// --- Тарифы ---
router.get('/tariffs', requireApiKey('read'), (req, res) => {
    const tariffs = db.prepare(
        'SELECT id, name, days, price, currency, protocols, max_ips, quota_gb FROM tariffs WHERE enabled = 1'
    ).all();
    res.json({ tariffs });
});

// --- Регистрация вебхука (full) ---
router.post('/webhooks', requireApiKey('full'), (req, res, next) => {
    try {
        const schema = z.object({
            event: z.enum(['client.created', 'client.expired', 'client.blocked', 'payment.success', 'quota.exceeded']),
            url: z.string().url('Некорректный URL'),
        });
        const { event, url } = schema.parse(req.body);
        const crypto = require('crypto');
        const secret = crypto.randomBytes(24).toString('hex');
        const result = db.prepare('INSERT INTO webhooks (event, url, secret) VALUES (?, ?, ?)')
            .run(event, url, secret);
        res.status(201).json({ id: result.lastInsertRowid, secret });
    } catch (err) { next(err); }
});

module.exports = router;
