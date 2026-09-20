/**
 * @fileoverview Публичные страницы: QR-страница клиента (/qr/:id) и
 * страница статуса (/status). Без авторизации; nginx проксирует эти пути.
 * @module routes/publicPages
 */

const express = require('express');
const rateLimit = require('express-rate-limit');
const QRCode = require('qrcode');
const db = require('../db');
const { clientLinks } = require('../services/links');
const { getAll } = require('./settings');

const router = express.Router();

// Лимит на публичные страницы (защита от перебора id)
const publicLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 60,
    standardHeaders: true,
    legacyHeaders: false,
    message: 'Слишком много запросов',
});

/** HTML-обёртка публичных страниц */
function page(title, body) {
    return `<!DOCTYPE html>
<html lang="ru">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta name="robots" content="noindex, nofollow">
    <title>${title}</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { min-height: 100vh; font-family: 'Segoe UI', system-ui, sans-serif;
               background: linear-gradient(135deg, #0f172a, #1e293b); color: #e2e8f0;
               display: flex; align-items: center; justify-content: center; padding: 1rem; }
        .card { background: #1e293b; border: 1px solid #334155; border-radius: 1rem;
                padding: 2rem; max-width: 480px; width: 100%; text-align: center; }
        h1 { font-size: 1.4rem; margin-bottom: 1.5rem; }
        img { border-radius: 0.75rem; width: 220px; height: 220px; background: #fff; }
        .qr-block { margin-bottom: 1.5rem; }
        .qr-block h3 { margin-bottom: 0.75rem; font-size: 1rem; color: #94a3b8; }
        a.btn { display: inline-block; margin-top: 0.5rem; padding: 0.5rem 1rem;
                background: #0088cc; color: #fff; border-radius: 0.5rem;
                text-decoration: none; font-size: 0.9rem; word-break: break-all; }
        .muted { color: #64748b; font-size: 0.8rem; margin-top: 1.5rem; }
        .ok { color: #10b981; } .bad { color: #ef4444; }
    </style>
</head>
<body><div class="card">${body}</div></body>
</html>`;
}

// --- QR-страница клиента (по случайному токену, не по id!) ---
const { getClientByToken } = require('../services/qrTokens');

router.get('/qr/:token([0-9a-f]{16})', publicLimiter, (req, res) => {
    const client = getClientByToken(req.params.token);
    if (!client || client.status !== 'active') {
        return res.status(404).send(page('Не найдено', '<h1>Ссылка недействительна</h1><p class="muted">Обратитесь к администратору</p>'));
    }

    // Фиксируем сканирование
    db.prepare('INSERT INTO qr_scans (client_id, qr_type, ip, user_agent) VALUES (?, ?, ?, ?)')
        .run(client.id, 'page', req.ip, String(req.headers['user-agent'] || '').slice(0, 255));

    const settings = getAll();
    const links = clientLinks(client, settings.mask_domain);

    let body = `<h1>Подключение к прокси</h1>`;
    if (links.web) {
        body += `<div class="qr-block"><h3>🌐 Web Proxy</h3>
            <img src="/qrimg/${client.qr_token}/web.png" alt="QR Web Proxy">
            <br><a class="btn" href="${links.web_https}">Подключить Web Proxy</a></div>`;
    }
    if (links.mtproto) {
        body += `<div class="qr-block"><h3>🔌 MTProto</h3>
            <img src="/qrimg/${client.qr_token}/mtproto.png" alt="QR MTProto">
            <br><a class="btn" href="${links.mtproto_https}">Подключить MTProto</a></div>`;
    }
    if (client.expires_at) {
        body += `<p class="muted">Действует до: ${new Date(client.expires_at).toLocaleDateString('ru-RU')}</p>`;
    }
    res.send(page('Подключение к прокси', body));
});

// --- Публичные QR-изображения (по токену клиента) ---
router.get('/qrimg/:token([0-9a-f]{16})/:type.png', publicLimiter, async (req, res) => {
    const client = getClientByToken(req.params.token);
    if (!client || client.status !== 'active') return res.status(404).end();
    const links = clientLinks(client, getAll().mask_domain);
    const link = req.params.type === 'web' ? links.web : links.mtproto;
    if (!link) return res.status(404).end();

    // Фиксируем сканирование
    db.prepare('INSERT INTO qr_scans (client_id, qr_type, ip, user_agent) VALUES (?, ?, ?, ?)')
        .run(client.id, req.params.type, req.ip, String(req.headers['user-agent'] || '').slice(0, 255));

    const png = await QRCode.toBuffer(link, { width: 512, margin: 2 });
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'no-store');
    res.send(png);
});

// --- Публичная страница статуса ---
router.get('/status', publicLimiter, (req, res) => {
    const rows = db.prepare(
        `SELECT service, COUNT(*) AS total, SUM(ok) AS ok_count
         FROM uptime_checks WHERE created_at >= datetime('now', '-1 day') GROUP BY service`
    ).all();

    const line = (service, label) => {
        const row = rows.find((r) => r.service === service);
        if (!row || row.total === 0) return `<p>${label}: <span class="muted">нет данных</span></p>`;
        const pct = Math.round((row.ok_count / row.total) * 100);
        const cls = pct >= 99 ? 'ok' : 'bad';
        return `<p>${label}: <span class="${cls}">${pct}% доступности (24ч)</span></p>`;
    };

    res.send(page('Статус сервиса', `
        <h1>Статус сервиса</h1>
        ${line('web', '🌐 Web Proxy')}
        ${line('mtproto', '🔌 MTProto')}
        <p class="muted">Обновлено: ${new Date().toLocaleString('ru-RU')}</p>
    `));
});

module.exports = router;
