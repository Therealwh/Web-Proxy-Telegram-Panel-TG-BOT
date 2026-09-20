/**
 * @fileoverview Управление API-ключами публичного API (админская часть).
 * Ключ показывается один раз при создании; в БД хранится только sha256-хэш.
 * @module routes/apiKeys
 */

const express = require('express');
const crypto = require('crypto');
const { z } = require('zod');
const db = require('../db');
const { httpError } = require('../middleware/errorHandler');

const router = express.Router();

const hashKey = (key) => crypto.createHash('sha256').update(key).digest('hex');

// --- Список ключей ---
router.get('/', (req, res) => {
    const keys = db.prepare(
        `SELECT id, name, key_prefix, permissions, expires_at, allowed_ips,
                requests_count, last_used_at, enabled, created_at
         FROM api_keys ORDER BY created_at DESC`
    ).all();
    res.json({ keys });
});

// --- Создать ключ ---
router.post('/', (req, res, next) => {
    try {
        const schema = z.object({
            name: z.string().min(1, 'Введите название').max(64),
            permissions: z.enum(['read', 'write', 'full']),
            expires_at: z.string().datetime({ offset: true }).nullable().optional(),
            allowed_ips: z.array(z.string().max(45)).max(20).nullable().optional(),
        });
        const data = schema.parse(req.body);

        // Формат ключа: tgk_<48 hex> — легко распознать в логах
        const key = 'tgk_' + crypto.randomBytes(24).toString('hex');
        const result = db.prepare(
            `INSERT INTO api_keys (name, key_hash, key_prefix, permissions, expires_at, allowed_ips)
             VALUES (?, ?, ?, ?, ?, ?)`
        ).run(
            data.name, hashKey(key), key.slice(0, 12), data.permissions,
            data.expires_at ?? null,
            data.allowed_ips ? JSON.stringify(data.allowed_ips) : null
        );
        res.status(201).json({ id: result.lastInsertRowid, key });
    } catch (err) {
        next(err);
    }
});

// --- Включить/выключить ---
router.patch('/:id', (req, res, next) => {
    try {
        const schema = z.object({ enabled: z.boolean() });
        const { enabled } = schema.parse(req.body);
        const result = db.prepare('UPDATE api_keys SET enabled = ? WHERE id = ?')
            .run(enabled ? 1 : 0, req.params.id);
        if (result.changes === 0) throw httpError(404, 'Ключ не найден');
        res.json({ ok: true });
    } catch (err) {
        next(err);
    }
});

// --- Удалить ---
router.delete('/:id', (req, res, next) => {
    try {
        const result = db.prepare('DELETE FROM api_keys WHERE id = ?').run(req.params.id);
        if (result.changes === 0) throw httpError(404, 'Ключ не найден');
        res.json({ ok: true });
    } catch (err) {
        next(err);
    }
});

module.exports = { router, hashKey };
