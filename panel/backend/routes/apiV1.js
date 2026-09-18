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

// --- Создать клиента (write) ---
router.post('/clients', requireApiKey('write'), async (req, res, next) => {
    try {
        const schema = z.object({
            username: z.string().regex(/^[A-Za-z0-9_.-]{1,64}$/),
            days: z.number().int().min(1).max(3650).optional(),
            quota_gb: z.number().positive().optional(),
        });
        const data = schema.parse(req.body);

        const exists = db.prepare('SELECT id FROM clients WHERE username = ?').get(data.username);
        if (exists) throw httpError(409, 'Клиент с таким именем уже существует');

        const expires = data.days ? new Date(Date.now() + data.days * 86400000).toISOString() : null;
        const created = await telemt.createUser({
            username: data.username,
            ...(expires && { expiration_rfc3339: expires }),
            ...(data.quota_gb && { data_quota_bytes: Math.round(data.quota_gb * 1024 ** 3) }),
        });

        const result = db.prepare(
            'INSERT INTO clients (username, secret, quota_bytes, expires_at) VALUES (?, ?, ?, ?)'
        ).run(data.username, created.secret, data.quota_gb ? Math.round(data.quota_gb * 1024 ** 3) : null, expires);

        const client = db.prepare('SELECT * FROM clients WHERE id = ?').get(result.lastInsertRowid);
        const settings = getAll();
        logger.info('Клиент создан через публичный API', { username: data.username, key: req.apiKey.name });
        fireWebhook('client.created', { username: data.username, expires_at: expires });

        res.status(201).json({ client, links: clientLinks(client, settings.mask_domain) });
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
        await telemt.deleteUser(client.username);
        db.prepare('DELETE FROM clients WHERE id = ?').run(client.id);
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
    const tariffs = db.prepare('SELECT id, name, days, price, currency, protocols FROM tariffs WHERE enabled = 1').all();
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
