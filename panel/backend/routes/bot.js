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
    res.json(botService.getBotSettings());
});

router.put('/settings', async (req, res, next) => {
    try {
        const schema = z.object({
            enabled: z.boolean().optional(),
            bot_token: z.string().max(100).nullable().optional(),
            currency: z.enum(['RUB', 'USD', 'USDT']).optional(),
            welcome_text: z.string().max(2000).nullable().optional(),
            payment_instructions: z.string().max(2000).nullable().optional(),
            notify_admin: z.boolean().optional(),
        });
        const data = schema.parse(req.body);

        const current = botService.getBotSettings();
        // Токен «••••» не перезаписываем
        if (data.bot_token && String(data.bot_token).startsWith('••••')) delete data.bot_token;
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
            enabled: z.union([z.boolean(), z.number()]).optional(),
        });
        const t = schema.parse(req.body);
        const result = db.prepare(
            'INSERT INTO tariffs (name, days, price, currency, protocols, enabled) VALUES (?, ?, ?, ?, ?, ?)'
        ).run(t.name, t.days, t.price, botService.getBotSettings().currency, t.protocols, t.enabled ? 1 : 0);
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
            enabled: z.union([z.boolean(), z.number()]),
        });
        const t = schema.parse(req.body);
        const result = db.prepare(
            'UPDATE tariffs SET name = ?, days = ?, price = ?, protocols = ?, enabled = ? WHERE id = ?'
        ).run(t.name, t.days, t.price, t.protocols, t.enabled ? 1 : 0, req.params.id);
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

module.exports = router;
