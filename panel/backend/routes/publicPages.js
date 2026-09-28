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
        .sel { width: 100%; padding: 0.6rem; border-radius: 0.5rem; background: #0f172a;
               color: #e2e8f0; border: 1px solid #334155; margin-bottom: 0.75rem; }
        .btn.wide { width: 100%; }
        a { color: #38bdf8; }
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
    // Аптайм за 30 дней по каждому сервису
    const rows = db.prepare(
        `SELECT service, COUNT(*) AS total, SUM(ok) AS ok_count
         FROM uptime_checks WHERE created_at >= datetime('now', '-30 days') GROUP BY service`
    ).all();

    // Текущее состояние: последняя проверка по каждому сервису
    const last = {};
    for (const r of db.prepare(
        'SELECT service, ok FROM uptime_checks ORDER BY id DESC LIMIT 12'
    ).all()) {
        if (!(r.service in last)) last[r.service] = r.ok;
    }

    // Полоски аптайма по дням (30 дней, все сервисы вместе)
    const daily = db.prepare(
        `SELECT date(created_at) AS d, ROUND(100.0 * SUM(ok) / COUNT(*)) AS pct
         FROM uptime_checks WHERE created_at >= datetime('now', '-30 days')
         GROUP BY d ORDER BY d`
    ).all();
    const pctColor = (p) => (p >= 99 ? '#10b981' : p >= 95 ? '#f59e0b' : '#ef4444');
    const pctText = (p) => (p >= 99 ? 'отлично' : p >= 95 ? 'нормально' : 'со сбоями');
    const bars = daily.map((d) =>
        `<div title="${d.d}: ${d.pct}%" style="flex:1;height:34px;border-radius:3px;background:${pctColor(d.pct)};min-width:3px"></div>`
    ).join('');

    const serviceRow = (service, label) => {
        const row = rows.find((r) => r.service === service);
        const now = last[service];
        const up = now === 1;
        let right = '<span style="color:#64748b">нет данных</span>';
        if (row && row.total > 0) {
            const pct = Math.round((row.ok_count / row.total) * 100);
            right = `<span style="color:${pctColor(pct)};font-weight:600">${pct}%</span> <span style="color:#64748b">аптайм 30 дней</span>`;
        }
        const dot = now === undefined ? '#64748b' : up ? '#10b981' : '#ef4444';
        const state = now === undefined ? '…' : up ? '<span style="color:#10b981">Работает</span>' : '<span style="color:#ef4444">Сбой</span>';
        return `<div style="display:flex;align-items:center;justify-content:space-between;gap:12px;padding:14px 0;border-bottom:1px solid #1e293b">
            <div style="display:flex;align-items:center;gap:10px"><span style="width:10px;height:10px;border-radius:50%;background:${dot};display:inline-block"></span><b>${label}</b></div>
            <div style="display:flex;align-items:center;gap:10px;font-size:0.9rem">${state}<span style="color:#475569">·</span>${right}</div>
        </div>`;
    };

    const allOk = ['web', 'mtproto'].every((s) => last[s] === 1) || Object.keys(last).length === 0;
    const headline = allOk
        ? '<span style="color:#10b981">🟢 Все системы работают</span>'
        : '<span style="color:#ef4444">🔴 Наблюдаются сбои</span>';

    // Информация о посетителе
    const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.ip || '—';
    let country = '—';
    try {
        const geo = require('../services/geo');
        const g = geo.lookupMany([ip]);
        country = g[ip]?.country || '—';
    } catch { /* geo недоступен */ }
    const ua = String(req.headers['user-agent'] || '');
    const s = ua.toLowerCase();
    const os = s.includes('iphone') || s.includes('ipad') ? 'iOS'
        : s.includes('android') ? 'Android'
        : s.includes('mac os') || s.includes('macintosh') ? 'macOS'
        : s.includes('windows') ? 'Windows'
        : s.includes('linux') ? 'Linux' : '—';
    const browser = s.includes('edg/') ? 'Edge' : s.includes('opr/') || s.includes('opera') ? 'Opera'
        : s.includes('chrome') ? 'Chrome' : s.includes('firefox') ? 'Firefox'
        : s.includes('safari') ? 'Safari' : '—';

    const updated = new Date().toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' });

    res.send(`<!DOCTYPE html>
<html lang="ru">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta name="robots" content="noindex, nofollow">
    <meta http-equiv="refresh" content="60">
    <title>Статус сервиса</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { min-height: 100vh; font-family: 'Segoe UI', system-ui, sans-serif;
               background: linear-gradient(160deg, #0b1220, #0f172a 60%, #131c2e);
               color: #e2e8f0; display: flex; align-items: center; justify-content: center; padding: 24px 16px; }
        .wrap { width: 100%; max-width: 640px; }
        .hero { text-align: center; margin-bottom: 28px; }
        .hero h1 { font-size: 1.6rem; margin-bottom: 6px; }
        .hero p { color: #64748b; font-size: 0.85rem; }
        .card { background: #101a2c; border: 1px solid #1e293b; border-radius: 16px; padding: 22px; margin-bottom: 18px; }
        .card h3 { font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.08em; color: #64748b; margin-bottom: 8px; }
        .bars { display: flex; gap: 3px; align-items: flex-end; margin-top: 10px; }
        .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px 18px; font-size: 0.95rem; }
        .grid div { color: #94a3b8; } .grid b { color: #e2e8f0; font-weight: 600; }
        code.ip { background: #0b1220; padding: 3px 10px; border-radius: 6px; user-select: all; font-size: 0.9rem; }
        .foot { text-align: center; color: #475569; font-size: 0.78rem; margin-top: 16px; }
    </style>
</head>
<body><div class="wrap">
    <div class="hero">
        <h1>${headline}</h1>
        <p>Проверяется автоматически каждые 5 минут · обновлено: ${updated}</p>
    </div>

    <div class="card">
        <h3>Сервисы</h3>
        ${serviceRow('web', '🌐 Web Proxy')}
        ${serviceRow('mtproto', '🔌 MTProto')}
        ${serviceRow('api', '⚙️ Инфраструктура')}
        <h3 style="margin-top:18px">Аптайм за 30 дней</h3>
        <div class="bars">${bars || '<span style="color:#64748b;font-size:0.85rem">Данные собираются…</span>'}</div>
    </div>

    <div class="card">
        <h3>Ваше подключение</h3>
        <div class="grid">
            <div>IP-адрес</div><div><code class="ip">${ip}</code></div>
            <div>Страна</div><div><b>${country}</b></div>
            <div>Устройство</div><div><b>${os}</b></div>
            <div>Браузер</div><div><b>${browser}</b></div>
        </div>
    </div>

    <div class="foot">Страница обновляется автоматически каждую минуту</div>
</div></body>
</html>`);
});

// --- Веб-кабинет: просмотр и продление без бота (по QR-токену) ---
router.get('/p/:token([0-9a-f]{16})', publicLimiter, (req, res) => {
    const client = getClientByToken(req.params.token);
    if (!client) {
        return res.status(404).send(page('Не найдено', '<h1>Ссылка недействительна</h1><p class="muted">Обратитесь к администратору</p>'));
    }
    const settings = getAll();
    const links = clientLinks(client, settings.mask_domain);
    const until = client.expires_at
        ? new Date(client.expires_at).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' }) + ' МСК'
        : '∞';
    const status = client.status === 'active' ? '🟢 активен' : '🔴 не активен';

    let body = `<h1>📦 ${client.username}</h1>
        <p class="muted">${status} · до ${until}</p>`;
    if (links.web_https) body += `<p><a class="btn" href="${links.web_https}">🌐 Подключить Web Proxy</a></p>`;
    if (links.mtproto_https) body += `<p><a class="btn" href="${links.mtproto_https}">🔌 Подключить MTProto</a></p>`;

    const tariffs = db.prepare('SELECT * FROM tariffs WHERE enabled = 1 ORDER BY days').all();
    if (tariffs.length > 0) {
        const options = tariffs
            .map((t) => `<option value="${t.id}">${t.name} — ${t.days} дн. — ${t.price} ${t.currency === 'RUB' ? '₽' : t.currency}</option>`)
            .join('');
        body += `
        <div class="qr-block" style="margin-top:1.5rem">
            <h3>♻️ Продлить доступ</h3>
            <form method="POST" action="/p/${req.params.token}/renew">
                <select name="tariff" class="sel">${options}</select><br>
                <button class="btn wide" type="submit">Оплатить и продлить</button>
            </form>
        </div>`;
    }
    body += `<p class="muted"><a href="/status" style="color:inherit">🟢 Статус сервиса</a> · Оплата: CryptoBot / ЮKassa / карта</p>`;
    res.send(page('Мой прокси', body));
});

// Оплата продления из веб-кабинета: создаём платёж и уводим на оплату
router.post('/p/:token([0-9a-f]{16})/renew', publicLimiter, express.urlencoded({ extended: false }), async (req, res) => {
    const client = getClientByToken(req.params.token);
    if (!client) return res.status(404).send(page('Не найдено', '<h1>Ссылка недействительна</h1>'));

    const tariff = db.prepare('SELECT * FROM tariffs WHERE id = ? AND enabled = 1').get(Number(req.body?.tariff));
    if (!tariff) return res.status(400).send(page('Ошибка', '<h1>Тариф недоступен</h1><p class="muted"><a href="javascript:history.back()">← Назад</a></p>'));

    const paymentId = db.prepare(
        "INSERT INTO payments (tariff_id, amount, currency, provider, status, client_id) VALUES (?, ?, ?, 'manual', 'pending', ?)"
    ).run(tariff.id, tariff.price, tariff.currency, client.id).lastInsertRowid;

    const settings = getAll();
    const paymentsService = require('../services/payments');

    try {
        const pay = await paymentsService.createPaymentUrl({
            paymentId,
            tariff: { name: `${tariff.name} (продление ${client.username})`, price: tariff.price, currency: tariff.currency },
            settings: settings.bot_settings || {},
        });
        if (pay?.url) {
            db.prepare('UPDATE payments SET provider = ? WHERE id = ?').run(pay.provider, paymentId);
            return res.redirect(pay.url);
        }
    } catch (err) {
        // платёжка недоступна — покажем реквизиты для ручной оплаты
    }

    // Ручная оплата картой администратора
    const code = (v) => `<code style="background:#0f172a;padding:2px 8px;border-radius:6px;user-select:all">${v}</code>`;
    const rows = [];
    if (settings.pay_card) rows.push(`💳 Карта: ${code(settings.pay_card)}`);
    if (settings.pay_phone) rows.push(`📱 СБП: ${code(settings.pay_phone)}`);
    if (settings.pay_bank) rows.push(`🏦 Банк: ${code(settings.pay_bank)}`);
    res.send(page(`Счёт #${paymentId}`, `
        <h1>Счёт #${paymentId}</h1>
        <p>Продление <b>${client.username}</b> — <b>${tariff.price} ${tariff.currency}</b></p>
        <p>${rows.length ? rows.join('<br>') : '⚠️ Реквизиты не настроены'}</p>
        <p class="muted">Нажмите на реквизиты, чтобы скопировать. После перевода администратор подтвердит оплату — доступ продлится автоматически.</p>
        <a class="btn" href="/p/${req.params.token}">⬅️ Назад</a>
    `));
});

module.exports = router;
