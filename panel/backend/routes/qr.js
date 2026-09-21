/**
 * @fileoverview Роуты генерации QR-кодов для ссылок подключения.
 * Форматы: PNG и SVG, кастомизация цветов и размера, статистика сканирований.
 * Публичная страница /qr/:id монтируется отдельно в server.js.
 * @module routes/qr
 */

const express = require('express');
const QRCode = require('qrcode');
const jwt = require('jsonwebtoken');
const { z } = require('zod');
const db = require('../db');
const config = require('../config');
const { clientLinks } = require('../services/links');
const { httpError } = require('../middleware/errorHandler');
const { getAll } = require('./settings');

const router = express.Router();

/**
 * Авторизация для всех QR-роутов: JWT из заголовка Authorization
 * или из query (?token=) — тег <img> не отправляет заголовки.
 */
router.use((req, res, next) => {
    let token = null;
    const header = req.headers.authorization || '';
    if (header.startsWith('Bearer ')) token = header.slice(7);
    if (!token && req.query.token) {
        if (!['GET', 'HEAD'].includes(req.method)) {
            return res.status(401).json({ error: 'Требуется авторизация' });
        }
        token = String(req.query.token);
    }

    if (!token) return res.status(401).json({ error: 'Требуется авторизация' });
    try {
        req.admin = jwt.verify(token, config.jwtSecret);
        next();
    } catch {
        return res.status(401).json({ error: 'Недействительный токен авторизации' });
    }
});

/** Достаёт клиента и его ссылки или 404. */
function getClientWithLinks(id) {
    const client = db.prepare('SELECT * FROM clients WHERE id = ?').get(id);
    if (!client) throw httpError(404, 'Клиент не найден');
    const settings = getAll();
    return { client, links: clientLinks(client, settings.mask_domain) };
}

// --- Генерация QR (PNG/SVG) ---
router.get('/client/:id/:type.:format(png|svg)', async (req, res, next) => {
    try {
        const { client, links } = getClientWithLinks(req.params.id);
        const type = req.params.type; // web | mtproto
        const link = type === 'web' ? links.web : links.mtproto;
        if (!link) throw httpError(404, `Протокол ${type} отключён для этого клиента`);

        const querySchema = z.object({
            color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
            bg: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
            size: z.coerce.number().int().min(128).max(2048).optional(),
        });
        const { color, bg, size } = querySchema.parse(req.query);

        const options = {
            errorCorrectionLevel: 'M',
            margin: 2,
            width: size || 512,
            color: { dark: color || '#000000', light: bg || '#ffffff' },
        };

        if (req.params.format === 'svg') {
            const svg = await QRCode.toString(link, { ...options, type: 'svg' });
            res.setHeader('Content-Type', 'image/svg+xml');
            res.setHeader('Content-Disposition', `attachment; filename="tggate-${client.username}-${type}.svg"`);
            res.send(svg);
        } else {
            const png = await QRCode.toBuffer(link, { ...options, type: 'png' });
            res.setHeader('Content-Type', 'image/png');
            res.setHeader('Content-Disposition', `inline; filename="tggate-${client.username}-${type}.png"`);
            res.send(png);
        }
    } catch (err) {
        next(err);
    }
});

// --- QR как base64 (для публичного API) ---
router.get('/client/:id/:type/base64', async (req, res, next) => {
    try {
        const { links } = getClientWithLinks(req.params.id);
        const link = req.params.type === 'web' ? links.web : links.mtproto;
        if (!link) throw httpError(404, 'Протокол отключён для этого клиента');
        const dataUrl = await QRCode.toDataURL(link, { width: 512, margin: 2 });
        res.json({ qr: dataUrl });
    } catch (err) {
        next(err);
    }
});

// --- Статистика сканирований ---
router.get('/client/:id/stats', (req, res, next) => {
    try {
        const { client } = getClientWithLinks(req.params.id);
        const total = db.prepare('SELECT COUNT(*) AS c FROM qr_scans WHERE client_id = ?').get(client.id).c;
        const web = db.prepare("SELECT COUNT(*) AS c FROM qr_scans WHERE client_id = ? AND qr_type = 'web'").get(client.id).c;
        const mtproto = db.prepare("SELECT COUNT(*) AS c FROM qr_scans WHERE client_id = ? AND qr_type = 'mtproto'").get(client.id).c;
        res.json({ total, web, mtproto });
    } catch (err) {
        next(err);
    }
});

// --- Отправить QR клиенту в Telegram ---
router.post('/client/:id/send', async (req, res, next) => {
    try {
        const { client } = getClientWithLinks(req.params.id);
        if (!client.telegram_id) throw httpError(400, 'У клиента не привязан Telegram');
        const notifier = require('../services/notifier');
        const settings = getAll();
        await notifier.sendQrToClient(client, settings.mask_domain);
        res.json({ ok: true });
    } catch (err) {
        next(err);
    }
});

module.exports = router;
