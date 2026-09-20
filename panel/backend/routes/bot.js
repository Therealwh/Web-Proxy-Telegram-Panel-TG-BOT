/**
 * @fileoverview Роуты настройки TG-бота продаж: статус, настройки, тарифы, статистика.
 * @module routes/bot
 */

const express = require('express');
const { z } = require('zod');
const db = require('../db');
const botService = require('../services/bot');
const { httpError } = require('../middleware/errorHandler');
const logger = require('../utils/logger');

const router = express.Router();

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

// ═══ Админка бота: пользователи Telegram ═══

// --- Список пользователей бота (сгруппированы по telegram_id) ---
router.get('/users', (req, res) => {
    const rows = db.prepare(
        `SELECT id, username, status, balance, expires_at, created_at, telegram_id
         FROM clients WHERE telegram_id IS NOT NULL
         ORDER BY created_at DESC`
    ).all();

    const users = new Map();
    for (const r of rows) {
        if (!users.has(r.telegram_id)) {
            users.set(r.telegram_id, {
                telegram_id: r.telegram_id,
                proxies: [],
                balance: 0,
                active: 0,
            });
        }
        const u = users.get(r.telegram_id);
        u.proxies.push({
            id: r.id, username: r.username, status: r.status,
            expires_at: r.expires_at, balance: r.balance || 0,
        });
        u.balance += r.balance || 0;
        if (r.status === 'active') u.active += 1;
    }

    res.json({ users: [...users.values()] });
});

// --- Изменить баланс пользователю (выдать/списать) ---
router.post('/users/:tgId/balance', (req, res, next) => {
    try {
        const schema = z.object({
            amount: z.number().int().describe('Положительное — начислить, отрицательное — списать'),
        });
        const { amount } = schema.parse(req.body);

        const clients = db.prepare('SELECT id FROM clients WHERE telegram_id = ?').all(req.params.tgId);
        if (clients.length === 0) throw httpError(404, 'Пользователь не найден');

        const update = db.prepare(
            'UPDATE clients SET balance = MAX(0, balance + ?) WHERE id = ?'
        );
        db.transaction(() => {
            for (const c of clients) update.run(amount, c.id);
        })();

        logger.info('Баланс изменён администратором', { tgId: req.params.tgId, amount });
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
