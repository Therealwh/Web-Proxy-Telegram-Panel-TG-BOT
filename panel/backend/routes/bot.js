/**
 * @fileoverview Роуты настройки TG-бота продаж: статус, настройки, тарифы, статистика.
 * @module routes/bot
 */

const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const crypto = require('crypto');
const { z } = require('zod');
const db = require('../db');
const botService = require('../services/bot');
const scheduler = require('../services/scheduler');
const telemt = require('../services/telemtApi');
const { clientLinks } = require('../services/links');
const { getAll } = require('./settings');
const { httpError } = require('../middleware/errorHandler');
const logger = require('../utils/logger');
const config = require('../config');

const router = express.Router();

// ── Массовые рассылки: загрузка картинки (до 5 МБ, только изображения) ──
const bcUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        if (/^image\/(jpeg|png|webp)$/.test(file.mimetype)) return cb(null, true);
        cb(new Error('Только JPEG, PNG или WebP'));
    },
});

const IMAGE_EXTS = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

/** Время МСК (наивное «YYYY-MM-DDTHH:mm») → UTC ISO; некорректное — null. */
function mskToUtc(naive) {
    if (!naive) return null;
    const d = new Date(`${naive}:00+03:00`);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

router.get('/broadcasts', async (req, res, next) => {
    try {
        const rows = db.prepare('SELECT * FROM broadcasts ORDER BY id DESC LIMIT 50').all();
        res.json({ broadcasts: rows });
    } catch (err) { next(err); }
});

router.post('/broadcasts', bcUpload.single('image'), async (req, res, next) => {
    try {
        const text = String(req.body?.text || '').trim();
        if (!text) throw Object.assign(new Error('Введите текст рассылки'), { statusCode: 400 });
        if (text.length > 4000) throw Object.assign(new Error('Текст слишком длинный (максимум 4000 символов)'), { statusCode: 400 });
        const target = ['all', 'active', 'expired', 'noproxy'].includes(req.body?.target) ? req.body.target : 'all';
        let scheduledUtc = null;
        if (req.body?.scheduled_at) {
            scheduledUtc = mskToUtc(String(req.body.scheduled_at));
            if (!scheduledUtc) throw Object.assign(new Error('Некорректная дата рассылки'), { statusCode: 400 });
            if (new Date(scheduledUtc) < new Date(Date.now() + 60 * 1000)) {
                throw Object.assign(new Error('Время в будущем минимум через минуту (по МСК)'), { statusCode: 400 });
            }
        }

        const info = db.prepare(
            `INSERT INTO broadcasts (text, target, scheduled_at) VALUES (?, ?, ?)`
        ).run(text, target, scheduledUtc);
        const id = info.lastInsertRowid;

        // Картинка: сохраняем на диск панели
        if (req.file) {
            const ext = IMAGE_EXTS[req.file.mimetype] || 'jpg';
            const dir = path.join(config.dataDir, 'broadcast');
            fs.mkdirSync(dir, { recursive: true });
            const filePath = path.join(dir, `${id}_${crypto.randomBytes(4).toString('hex')}.${ext}`);
            fs.writeFileSync(filePath, req.file.buffer);
            db.prepare('UPDATE broadcasts SET image_path = ? WHERE id = ?').run(filePath, id);
        }

        // Без расписания — запуск немедленно
        if (!scheduledUtc) {
            require('../services/broadcasts').startBroadcast(id);
            return res.json({ ok: true, id, started: true });
        }
        res.json({ ok: true, id, scheduled_at: scheduledUtc });
    } catch (err) { next(err); }
});

router.delete('/broadcasts/:id', async (req, res, next) => {
    try {
        const row = db.prepare('SELECT * FROM broadcasts WHERE id = ?').get(Number(req.params.id));
        if (!row) throw Object.assign(new Error('Рассылка не найдена'), { statusCode: 404 });
        if (row.status === 'sending') throw Object.assign(new Error('Рассылка уже отправляется — нельзя отменить'), { statusCode: 409 });
        db.prepare("UPDATE broadcasts SET status = 'cancelled' WHERE id = ?").run(row.id);
        require('../services/broadcasts').removeImage(row.id);
        res.json({ ok: true });
    } catch (err) { next(err); }
});

router.post('/broadcasts/:id/send-now', async (req, res, next) => {
    try {
        const row = db.prepare("SELECT * FROM broadcasts WHERE id = ? AND status = 'pending'").get(Number(req.params.id));
        if (!row) throw Object.assign(new Error('Рассылка не найдена или уже отправлена'), { statusCode: 404 });
        require('../services/broadcasts').startBroadcast(row.id);
        res.json({ ok: true });
    } catch (err) { next(err); }
});

router.get('/broadcasts/:id/image', async (req, res, next) => {
    try {
        const row = db.prepare('SELECT image_path FROM broadcasts WHERE id = ?').get(Number(req.params.id));
        if (!row?.image_path || !fs.existsSync(row.image_path)) throw Object.assign(new Error('Нет картинки'), { statusCode: 404 });
        res.setHeader('Cache-Control', 'private, max-age=3600');
        res.sendFile(path.resolve(row.image_path));
    } catch (err) { next(err); }
});

// --- Отправить бэкап базы админу в Telegram (кнопка «Отправить сейчас») ---
router.post('/backup-tg', async (req, res, next) => {
    try {
        const filename = await scheduler.backupToTelegram();
        res.json({ ok: true, filename });
    } catch (err) {
        next(err);
    }
});

// --- Статус бота ---
router.get('/status', (req, res) => {
    res.json({ running: botService.isRunning() });
});

// --- Настройки бота ---
router.get('/settings', (req, res) => {
    const s = botService.getBotSettings();
    // Секреты маскируем — показываем только хвост
    for (const key of ['bot_token', 'cryptobot_token', 'yookassa_secret_key']) {
        if (s[key]) s[key] = '••••••' + String(s[key]).slice(-4);
    }
    res.json(s);
});

router.put('/settings', async (req, res, next) => {
    try {
        const schema = z.object({
            enabled: z.boolean().optional(),
            bot_token: z.string().max(100).nullable().optional(),
            currency: z.enum(['RUB', 'USD', 'USDT', 'EUR']).optional(),
            welcome_text: z.string().max(4000).nullable().optional(),
            payment_instructions: z.string().max(2000).nullable().optional(),
            notify_admin: z.boolean().optional(),
            // Обязательная подписка на канал
            channel_username: z.string().max(64).regex(/^@?[A-Za-z0-9_]{4,64}$/, 'Юзернейм канала: @name').nullable().optional(),
            channel_required: z.boolean().optional(),
            // Ссылка на статус-страницу (кнопка в боте)
            status_url: z.string().max(256).nullable().optional(),
            // Кастомные кнопки в боте
            custom_buttons: z.array(z.object({
                name: z.string().min(1).max(64),
                url: z.string().url().max(256),
                enabled: z.boolean(),
            })).max(8).optional(),
            // Платёжные системы
            cryptobot_token: z.string().max(100).nullable().optional(),
            yookassa_shop_id: z.string().max(100).nullable().optional(),
            yookassa_secret_key: z.string().max(200).nullable().optional(),
            // Telegram Stars (оплата звёздами): тумблер + курс автоконверта
            stars_enabled: z.boolean().optional(),
            stars_rate_rub: z.number().positive().max(100000).optional(),
            stars_rate_usd: z.number().positive().max(1000).optional(),
            // Реквизиты для ручной оплаты
            pay_card: z.string().max(64).nullable().optional(),
            pay_phone: z.string().max(64).nullable().optional(),
            pay_bank: z.string().max(64).nullable().optional(),
        });
        const data = schema.parse(req.body);

        const current = botService.getBotSettings();
        // Замаскированные значения «••••» не перезаписываем
        for (const key of ['bot_token', 'cryptobot_token', 'yookassa_secret_key']) {
            if (data[key] && String(data[key]).startsWith('••••')) delete data[key];
        }
        const merged = { ...current, ...data };

        db.prepare(
            'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
        ).run('bot_settings', JSON.stringify(merged));

        // Перезапускаем бота с новыми настройками
        await botService.start().catch((err) => logger.error('Бот не запустился', { error: err.message }));
        res.json({ ok: true });
    } catch (err) {
        next(err);
    }
});

// --- Тарифы ---
router.get('/tariffs', (req, res) => {
    res.json({ tariffs: db.prepare('SELECT * FROM tariffs ORDER BY days').all() });
});

router.post('/tariffs', (req, res, next) => {
    try {
        const schema = z.object({
            name: z.string().min(1).max(64),
            days: z.number().int().min(1).max(3650),
            price: z.number().min(0),
            protocols: z.enum(['web', 'mtproto', 'both']),
            max_ips: z.number().int().min(1).max(100).nullable().optional(),
            quota_gb: z.number().positive().nullable().optional(),
            enabled: z.union([z.boolean(), z.number()]).optional(),
        });
        const t = schema.parse(req.body);
        const result = db.prepare(
            'INSERT INTO tariffs (name, days, price, currency, protocols, max_ips, quota_gb, enabled) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
        ).run(t.name, t.days, t.price, botService.getBotSettings().currency, t.protocols,
              t.max_ips ?? null, t.quota_gb ?? null, t.enabled ? 1 : 0);
        res.status(201).json({ id: result.lastInsertRowid });
    } catch (err) {
        next(err);
    }
});

router.put('/tariffs/:id', (req, res, next) => {
    try {
        const schema = z.object({
            name: z.string().min(1).max(64),
            days: z.number().int().min(1).max(3650),
            price: z.number().min(0),
            protocols: z.enum(['web', 'mtproto', 'both']),
            max_ips: z.number().int().min(1).max(100).nullable().optional(),
            quota_gb: z.number().positive().nullable().optional(),
            enabled: z.union([z.boolean(), z.number()]),
        });
        const t = schema.parse(req.body);
        const result = db.prepare(
            'UPDATE tariffs SET name = ?, days = ?, price = ?, protocols = ?, max_ips = ?, quota_gb = ?, enabled = ? WHERE id = ?'
        ).run(t.name, t.days, t.price, t.protocols, t.max_ips ?? null, t.quota_gb ?? null, t.enabled ? 1 : 0, req.params.id);
        if (result.changes === 0) throw httpError(404, 'Тариф не найден');
        res.json({ ok: true });
    } catch (err) {
        next(err);
    }
});

router.delete('/tariffs/:id', (req, res, next) => {
    try {
        const result = db.prepare('DELETE FROM tariffs WHERE id = ?').run(req.params.id);
        if (result.changes === 0) throw httpError(404, 'Тариф не найден');
        res.json({ ok: true });
    } catch (err) {
        next(err);
    }
});

// --- Статистика продаж ---
router.get('/stats', (req, res) => {
    const total = db.prepare("SELECT COUNT(*) AS c, COALESCE(SUM(amount),0) AS s FROM payments WHERE status = 'success'").get();
    const month = db.prepare(
        "SELECT COUNT(*) AS c, COALESCE(SUM(amount),0) AS s FROM payments WHERE status = 'success' AND paid_at >= datetime('now','-30 days')"
    ).get();
    res.json({
        sales_total: total.c,
        sales_month: month.c,
        revenue_total: total.s,
        revenue_month: month.s,
    });
});

// --- Сброс статистики продаж и дохода (тестовые платежи) ---
router.post('/stats/reset', (req, res, next) => {
    try {
        const info = db.prepare("DELETE FROM payments WHERE status IN ('success', 'failed')").run();
        logger.info('Статистика продаж сброшена', { deleted: info.changes });
        res.json({ ok: true, deleted: info.changes });
    } catch (err) {
        next(err);
    }
});

// ═══ Админка бота: пользователи Telegram ═══

// --- Список пользователей бота (сгруппированы по telegram_id) ---
// Показываем ВСЕХ: и тех, кто взаимодействовал с ботом без покупок (bot_users),
// и тех, у кого есть прокси (clients.telegram_id).
router.get('/users', (req, res) => {
    const rows = db.prepare(
        `SELECT id, username, status, balance, expires_at, created_at, telegram_id
         FROM clients WHERE telegram_id IS NOT NULL
         ORDER BY created_at DESC`
    ).all();
    // Параметры списка: страница/лимит/поиск/фильтр (v2)
    const page = Math.max(1, parseInt(String(req.query.page || '1'), 10) || 1);
    const limit = Math.min(100, Math.max(10, parseInt(String(req.query.limit || '25'), 10) || 25));
    const search = String(req.query.search || '').trim().toLowerCase();
    const filter = String(req.query.filter || 'all');

    const users = new Map();

    // Все, кто писал/нажимал боту (даже без прокси)
    for (const b of db.prepare(
        'SELECT telegram_id, username, first_name, last_name, seen_at, balance FROM bot_users'
    ).all()) {
        users.set(b.telegram_id, {
            telegram_id: b.telegram_id,
            username: b.username || null,
            first_name: b.first_name || null,
            last_name: b.last_name || null,
            seen_at: b.seen_at,
            proxies: [],
            balance: b.balance || 0,
            active: 0,
        });
    }

    for (const r of rows) {
        if (!users.has(r.telegram_id)) {
            users.set(r.telegram_id, {
                telegram_id: r.telegram_id,
                username: null, first_name: null, last_name: null, seen_at: null,
                proxies: [], balance: 0, active: 0,
            });
        }
        const u = users.get(r.telegram_id);
        u.proxies.push({
            id: r.id, username: r.username, status: r.status,
            expires_at: r.expires_at, balance: r.balance || 0,
            created_at: r.created_at,
        });
        u.balance += r.balance || 0;
        if (r.status === 'active') u.active += 1;
    }

    // С прокси сверху (по новому прокси), затем остальные — по последней активности
    let list = [...users.values()];

    // Поиск: telegram_id, @username, имя/фамилия, ники прокси
    if (search) {
        const q = search.replace(/^@/, '');
        list = list.filter((u) => {
            if (String(u.telegram_id).includes(q)) return true;
            if ((u.username || '').toLowerCase().includes(q)) return true;
            if (`${u.first_name || ''} ${u.last_name || ''}`.toLowerCase().includes(q)) return true;
            if (u.proxies.some((p) => (p.username || '').toLowerCase().includes(q))) return true;
            return false;
        });
    }

    // Фильтры
    if (filter === 'proxies') list = list.filter((u) => u.proxies.length > 0);
    else if (filter === 'active') list = list.filter((u) => u.active > 0);
    else if (filter === 'noproxies') list = list.filter((u) => u.proxies.length === 0);
    else if (filter === 'balance') list = list.filter((u) => u.balance > 0);

    // Сортировка по последней активности: новый прокси или визит в бота
    list.sort((a, b) => {
        const ka = String(a.proxies[0]?.created_at || a.seen_at || '');
        const kb = String(b.proxies[0]?.created_at || b.seen_at || '');
        return kb.localeCompare(ka);
    });

    const total = list.length;
    const pages = Math.max(1, Math.ceil(total / limit));
    const safePage = Math.min(page, pages);
    const slice = list.slice((safePage - 1) * limit, safePage * limit)
        .map((u) => ({
            ...u,
            proxies_count: u.proxies.length,
            active_count: u.active,
            last_proxy_date: u.proxies[0]?.created_at || null,
        }));

    res.json({ users: slice, total, page: safePage, pages, limit });
});

// --- Выдать прокси пользователю (создание в Telemt + привязка к telegram_id) ---
router.post('/users/:tgId/issue', async (req, res, next) => {
    try {
        const schema = z.object({
            days: z.number().int().min(1).max(3650),
            protocols: z.enum(['web', 'mtproto', 'both']).default('both'),
            max_ips: z.number().int().min(1).max(100).nullable().optional(),
            quota_gb: z.number().positive().nullable().optional(),
        });
        const p = schema.parse(req.body);
        const tgId = Number(req.params.tgId);

        const known = db.prepare('SELECT telegram_id FROM bot_users WHERE telegram_id = ?').get(tgId)
            || db.prepare('SELECT telegram_id FROM clients WHERE telegram_id = ?').get(tgId);
        if (!known) throw httpError(404, 'Пользователь не найден');

        const count = db.prepare('SELECT COUNT(*) AS c FROM clients WHERE telegram_id = ?').get(tgId).c;
        const username = `tg${tgId}x${count + 1}`;
        const expires = new Date(Date.now() + p.days * 86400000).toISOString();

        const created = await telemt.createUser({
            username,
            expiration_rfc3339: expires,
            ...(p.max_ips ? { max_unique_ips: p.max_ips } : {}),
            ...(p.quota_gb ? { data_quota_bytes: Math.round(p.quota_gb * 1024 ** 3) } : {}),
        });

        db.prepare(
            `INSERT INTO clients (username, secret, expires_at, telegram_id, web_enabled, mtproto_enabled)
             VALUES (?, ?, ?, ?, ?, ?)`
        ).run(
            username, created.secret, expires, tgId,
            ['web', 'both'].includes(p.protocols) ? 1 : 0,
            ['mtproto', 'both'].includes(p.protocols) ? 1 : 0
        );

        // Предоплаченный баланс (выданный админом до покупки) переносим на новый прокси
        let transferred = 0;
        const bu = db.prepare('SELECT balance FROM bot_users WHERE telegram_id = ?').get(tgId);
        if (bu && bu.balance > 0) {
            db.prepare('UPDATE clients SET balance = balance + ? WHERE username = ?').run(bu.balance, username);
            db.prepare('UPDATE bot_users SET balance = 0 WHERE telegram_id = ?').run(tgId);
            transferred = bu.balance;
        }

        // Уведомляем пользователя в боте (ошибка отправки не откатывает выдачу)
        let notified = true;
        try {
            const client = db.prepare('SELECT * FROM clients WHERE username = ?').get(username);
            const links = clientLinks(client);
            const until = new Date(expires).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' }) + ' МСК';
            let text = `🎁 <b>Администратор выдал вам прокси!</b>\n\n📦 Прокси: <b>${username}</b>\n📅 Действует до: <b>${until}</b>\n\n`;
            if (links.web_https) text += `🌐 <b>Web Proxy</b> (нажми — подключится сам):\n${links.web_https}\n\n`;
            if (links.mtproto_https) text += `🔌 <b>MTProto</b>:\n${links.mtproto_https}\n\n`;
            // Fake TLS выдаётся рядом с обычной ссылкой, а не вместо неё:
            // выдача администратором — такой же путь получения ссылок, как и
            // оплата, и обе должны вести себя одинаково.
            if (links.mtproto_faketls_https) {
                text += `🛡 <b>MTProto Fake TLS</b> (если обычный не подключается):\n${links.mtproto_faketls_https}\n\n`;
            }
            if (transferred > 0) text += `💰 На счету прокси: ${transferred.toFixed(2)} (перенос баланса)\n\n`;
            text += `💡 Управление — в разделе «📱 Личный кабинет».`;
            await botService.sendMessageTo(tgId, text);
        } catch (e) {
            notified = false;
            logger.warn('Не удалось уведомить пользователя о выданном прокси', { tgId, error: e.message });
        }

        logger.info('Прокси выдан администратором', { tgId, username, days: p.days, protocols: p.protocols });
        res.json({ ok: true, username, notified, transferred });
    } catch (err) {
        next(err);
    }
});

// --- Изменить баланс пользователю (выдать/списать) ---
// Если у пользователя ещё нет прокси — баланс хранится в bot_users
// и автоматически переносится на прокси при первой покупке.
router.post('/users/:tgId/balance', (req, res, next) => {
    try {
        const schema = z.object({
            amount: z.number().int().describe('Положительное — начислить, отрицательное — списать'),
        });
        const { amount } = schema.parse(req.body);

        const clients = db.prepare('SELECT id FROM clients WHERE telegram_id = ?').all(req.params.tgId);
        const bu = db.prepare('SELECT telegram_id FROM bot_users WHERE telegram_id = ?').get(req.params.tgId);
        if (clients.length === 0 && !bu) throw httpError(404, 'Пользователь не найден');

        if (clients.length > 0) {
            const update = db.prepare('UPDATE clients SET balance = MAX(0, balance + ?) WHERE id = ?');
            db.transaction(() => {
                for (const c of clients) update.run(amount, c.id);
            })();
        } else {
            db.prepare('UPDATE bot_users SET balance = MAX(0, balance + ?) WHERE telegram_id = ?')
                .run(amount, req.params.tgId);
        }

        logger.info('Баланс изменён администратором', { tgId: req.params.tgId, amount, via: clients.length ? 'clients' : 'bot_users' });
        res.json({ ok: true });
    } catch (err) {
        next(err);
    }
});

// --- Отправить сообщение пользователю через бота ---
router.post('/users/:tgId/message', async (req, res, next) => {
    try {
        const schema = z.object({ text: z.string().min(1).max(4000) });
        const { text } = schema.parse(req.body);
        const bot = require('../services/bot');
        await bot.sendMessageTo(Number(req.params.tgId), text);
        res.json({ ok: true });
    } catch (err) {
        next(err);
    }
});

module.exports = router;
