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
    const links = clientLinks(client);

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
    const links = clientLinks(client);
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
// Пользовательские значения (IP из XFF подделывается!) — только через esc()
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

router.get('/status', publicLimiter, (req, res) => {
    const pctColor = (p) => (p >= 99 ? '#10b981' : p >= 95 ? '#f59e0b' : '#ef4444');

    // --- Аптайм сервисов за 30 дней ---
    const svc30 = {};
    for (const r of db.prepare(
        `SELECT service, COUNT(*) AS total, SUM(ok) AS ok_count,
                AVG(CASE WHEN ok = 1 AND latency_ms IS NOT NULL THEN latency_ms END) AS avg_ms
         FROM uptime_checks WHERE created_at >= datetime('now', '-30 days') GROUP BY service`
    ).all()) svc30[r.service] = r;

    // Текущее состояние: последняя проверка по каждому сервису
    const last = {};
    for (const r of db.prepare('SELECT service, ok FROM uptime_checks ORDER BY id DESC LIMIT 24').all()) {
        if (!(r.service in last)) last[r.service] = r.ok;
    }

    // Полоски аптайма по дням — отдельно на каждый сервис
    const daily = {};
    for (const r of db.prepare(
        `SELECT service, date(created_at) AS d, ROUND(100.0 * SUM(ok) / COUNT(*)) AS pct
         FROM uptime_checks WHERE created_at >= datetime('now', '-30 days')
         GROUP BY service, d ORDER BY d`
    ).all()) {
        (daily[r.service] = daily[r.service] || []).push(r);
    }

    // Последний сбой любого сервиса → счётчик «без сбоев N дней»
    const lastFail = db.prepare("SELECT created_at FROM uptime_checks WHERE ok = 0 ORDER BY id DESC LIMIT 1").get();
    const daysClean = lastFail
        ? Math.floor((Date.now() - new Date(lastFail.created_at + 'Z').getTime()) / 86400000)
        : 30;

    // Средний отклик Web Proxy за 24 часа
    const webLatency24 = db.prepare(
        `SELECT ROUND(AVG(latency_ms)) AS a FROM uptime_checks
         WHERE service = 'web' AND ok = 1 AND latency_ms IS NOT NULL
           AND created_at >= datetime('now', '-24 hours')`
    ).get()?.a ?? null;

    // --- Доступность из России (замеры Globalping) ---
    const rfPoints = db.prepare(
        `SELECT pct, created_at FROM availability_checks
         WHERE created_at >= datetime('now', '-24 hours') AND pct IS NOT NULL
         ORDER BY id DESC LIMIT 96`
    ).all();
    const rfNow = rfPoints[0]?.pct ?? null;
    const rf24 = db.prepare(
        "SELECT ROUND(AVG(pct), 1) AS a FROM availability_checks WHERE created_at >= datetime('now', '-24 hours') AND pct IS NOT NULL"
    ).get()?.a ?? null;
    const rf30 = db.prepare(
        "SELECT ROUND(AVG(pct), 1) AS a FROM availability_checks WHERE created_at >= datetime('now', '-30 days') AND pct IS NOT NULL"
    ).get()?.a ?? null;

    const overallOk = ['web', 'mtproto'].every((s) => last[s] === 1)
        && (rfNow === null || rfNow >= 50);
    const headline = overallOk
        ? '<span style="color:#10b981">🟢 Все системы работают</span>'
        : '<span style="color:#ef4444">🔴 Наблюдаются сбои</span>';

    const rowBars = (service) => {
        const list = daily[service] || [];
        if (!list.length) return '<span style="color:#475569;font-size:0.8rem">Данные собираются…</span>';
        return `<div class="bars">${list.map((d) =>
            `<div title="${esc(d.d)}: ${d.pct}%" style="flex:1;height:26px;border-radius:2px;background:${pctColor(d.pct)};min-width:2px"></div>`
        ).join('')}</div>`;
    };

    const serviceRow = (service, label) => {
        const row = svc30[service];
        const now = last[service];
        let right = '<span style="color:#64748b">нет данных</span>';
        if (row && row.total > 0) {
            const pct = Math.round((row.ok_count / row.total) * 100);
            const ms = row.avg_ms ? ` · ${Math.round(row.avg_ms)} мс` : '';
            right = `<span style="color:${pctColor(pct)};font-weight:600">${pct}%</span> <span style="color:#64748b">за 30 дней${ms}</span>`;
        }
        const dot = now === undefined ? '#64748b' : now === 1 ? '#10b981' : '#ef4444';
        const state = now === undefined ? '<span style="color:#64748b">…</span>'
            : now === 1 ? '<span style="color:#10b981">Работает</span>'
            : '<span style="color:#ef4444">Сбой</span>';
        return `<div style="padding:12px 0;border-bottom:1px solid #1e293b">
            <div style="display:flex;align-items:center;justify-content:space-between;gap:12px">
                <div style="display:flex;align-items:center;gap:10px"><span style="width:10px;height:10px;border-radius:50%;background:${dot};display:inline-block"></span><b>${label}</b></div>
                <div style="display:flex;align-items:center;gap:10px;font-size:0.88rem">${state}<span style="color:#334155">·</span>${right}</div>
            </div>
            <div style="margin:8px 0 2px">${rowBars(service)}</div>
        </div>`;
    };

    // Плитки-показатели над карточками
    const stat = (label, value, color = '#e2e8f0') =>
        `<div style="background:#101a2c;border:1px solid #1e293b;border-radius:14px;padding:14px 10px;text-align:center">
            <div style="font-size:1.15rem;font-weight:700;color:${color}">${value}</div>
            <div style="color:#64748b;font-size:0.72rem;margin-top:4px;text-transform:uppercase;letter-spacing:0.05em">${label}</div>
        </div>`;

    const up30 = ['web', 'mtproto'].map((s) => {
        const r = svc30[s];
        return r && r.total ? Math.round((r.ok_count / r.total) * 100) : null;
    }).filter((v) => v !== null);
    const up30avg = up30.length ? Math.round(up30.reduce((a, b) => a + b, 0) / up30.length) : null;

    // Замеры доступности из РФ: от старых к свежим
    const rfBars = rfPoints.length
        ? `<div class="bars">${rfPoints.slice().reverse().map((p) =>
            `<div title="${esc(p.created_at)}: ${p.pct}%" style="flex:1;height:34px;border-radius:2px;background:${pctColor(p.pct)};min-width:2px"></div>`
        ).join('')}</div>
        <div style="display:flex;justify-content:space-between;color:#475569;font-size:0.72rem;margin-top:6px"><span>24 часа назад</span><span>сейчас</span></div>`
        : '<span style="color:#64748b;font-size:0.85rem">Мониторинг доступности из России не активирован — включите его в настройках панели.</span>';

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
        .hero { text-align: center; margin-bottom: 22px; }
        .hero h1 { font-size: 1.6rem; margin-bottom: 6px; }
        .hero p { color: #64748b; font-size: 0.85rem; }
        .stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin-bottom: 18px; }
        @media (max-width: 560px) { .stats { grid-template-columns: repeat(2, 1fr); } }
        .card { background: #101a2c; border: 1px solid #1e293b; border-radius: 16px; padding: 20px 22px; margin-bottom: 16px; }
        .card h3 { font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.08em; color: #64748b; margin-bottom: 8px; }
        .bars { display: flex; gap: 2px; align-items: flex-end; }
        .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px 18px; font-size: 0.95rem; }
        .grid div { color: #94a3b8; } .grid b { color: #e2e8f0; font-weight: 600; }
        code.ip { background: #0b1220; padding: 3px 10px; border-radius: 6px; user-select: all; font-size: 0.9rem; }
        .foot { text-align: center; color: #475569; font-size: 0.78rem; margin-top: 14px; }
    </style>
</head>
<body><div class="wrap">
    <div class="hero">
        <h1>${headline}</h1>
        <p>Проверяется автоматически каждые 5 минут · обновлено: ${esc(updated)}</p>
    </div>

    <div class="stats">
        ${stat('Аптайм 30 дней', up30avg !== null ? up30avg + '%' : '—', up30avg !== null ? pctColor(up30avg) : '#e2e8f0')}
        ${stat('Отклик Web', webLatency24 ? webLatency24 + ' мс' : '—')}
        ${stat('Доступность из РФ (24ч)', rf24 !== null ? rf24 + '%' : '—', rf24 !== null ? pctColor(rf24) : '#e2e8f0')}
        ${stat('Без сбоев', daysClean > 0 ? daysClean + ' дн.' : '30+')}
    </div>

    <div class="card">
        <h3>Сервисы · аптайм за 30 дней</h3>
        ${serviceRow('web', '🌐 Web Proxy')}
        ${serviceRow('mtproto', '🔌 MTProto')}
        ${serviceRow('api', '⚙️ Панель и управление')}
    </div>

    <div class="card">
        <h3>Доступность из России${rf30 !== null ? ` · среднее за 30 дней: ${rf30}%` : ''}</h3>
        ${rfBars}
    </div>

    <div class="card">
        <h3>Ваше подключение</h3>
        <div class="grid">
            <div>IP-адрес</div><div><code class="ip">${esc(ip)}</code></div>
            <div>Страна</div><div><b>${esc(country)}</b></div>
            <div>Устройство</div><div><b>${esc(os)}</b></div>
            <div>Браузер</div><div><b>${esc(browser)}</b></div>
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
    const links = clientLinks(client);
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
