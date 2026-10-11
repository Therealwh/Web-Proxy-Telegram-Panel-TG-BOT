/**
 * @fileoverview Управление вебхуками из панели.
 * Раньше подписки можно было завести только через публичный API ключом
 * уровня full, а список событий в документации расходился с реальностью:
 * объявленные client.* и quota.exceeded не вызывались нигде.
 * @module routes/webhooks
 */

const express = require('express');
const crypto = require('crypto');
const { z } = require('zod');
const db = require('../db');
const { httpError } = require('../middleware/errorHandler');
const { deliverTo } = require('../services/webhooks');

const router = express.Router();

/** Полный список событий: одно место для роута и для UI. */
const EVENTS = [
    'payment.success',
    'client.created',
    'client.blocked',
    'client.unblocked',
    'client.renewed',
    'client.expired',
    'client.deleted',
    'quota.exceeded',
];

// --- Список подписок ---
router.get('/', (req, res) => {
    const hooks = db.prepare(
        `SELECT id, event, url, enabled, created_at, last_status, last_error, last_ok_at
         FROM webhooks ORDER BY created_at DESC`
    ).all();
    // Секрет наружу не отдаём — при необходимости его можно перевыпустить
    res.json({ webhooks: hooks, events: EVENTS });
});

// --- Создать подписку ---
router.post('/', (req, res, next) => {
    try {
        const schema = z.object({
            event: z.enum(EVENTS),
            url: z.string().url('Некорректный URL').max(500),
        });
        const data = schema.parse(req.body);

        const secret = 'whsec_' + crypto.randomBytes(24).toString('hex');
        const result = db.prepare(
            'INSERT INTO webhooks (event, url, secret, enabled) VALUES (?, ?, ?, 1)'
        ).run(data.event, data.url, secret);

        res.status(201).json({ id: result.lastInsertRowid, secret });
    } catch (err) {
        next(err);
    }
});

// --- Обновить (адрес или включение/выключение) ---
router.patch('/:id', (req, res, next) => {
    try {
        const schema = z.object({
            url: z.string().url('Некорректный URL').max(500).optional(),
            enabled: z.boolean().optional(),
        });
        const data = schema.parse(req.body);
        if (data.url === undefined && data.enabled === undefined) {
            throw httpError(400, 'Нечего обновлять');
        }
        const sets = [];
        const vals = [];
        if (data.url !== undefined) { sets.push('url = ?'); vals.push(data.url); }
        if (data.enabled !== undefined) { sets.push('enabled = ?'); vals.push(data.enabled ? 1 : 0); }
        vals.push(req.params.id);
        const result = db.prepare(`UPDATE webhooks SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
        if (result.changes === 0) throw httpError(404, 'Подписка не найдена');
        res.json({ ok: true });
    } catch (err) {
        next(err);
    }
});

// --- Удалить ---
router.delete('/:id', (req, res, next) => {
    try {
        const result = db.prepare('DELETE FROM webhooks WHERE id = ?').run(req.params.id);
        if (result.changes === 0) throw httpError(404, 'Подписка не найдена');
        res.json({ ok: true });
    } catch (err) {
        next(err);
    }
});

// --- Тестовая отправка: шлёт подписчику и сразу показывает результат ---
router.post('/:id/test', async (req, res, next) => {
    try {
        const hook = db.prepare('SELECT * FROM webhooks WHERE id = ?').get(req.params.id);
        if (!hook) throw httpError(404, 'Подписка не найдена');

        const result = await deliverTo(hook, hook.event, {
            test: true,
            message: 'Это тестовое событие TGGATE',
        });
        if (!result.ok) throw httpError(502, result.error || 'Тестовая доставка не удалась');
        res.json({ ok: true });
    } catch (err) {
        next(err);
    }
});

module.exports = { router, EVENTS };