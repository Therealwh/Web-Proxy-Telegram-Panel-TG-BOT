/**
 * @fileoverview Маршруты списка блокировки IP и подсетей.
 * @module routes/blocklist
 */

const express = require('express');
const { z } = require('zod');
const blocklist = require('../services/ipBlocklist');
const { httpError } = require('../middleware/errorHandler');

const router = express.Router();

/** Текущий список с указанием, применены ли правила на сервере. */
router.get('/', (req, res) => {
    const rules = blocklist.active();
    res.json({ items: blocklist.list(), active: rules.length });
});

/** Добавить адрес или подсеть. */
router.post('/', async (req, res, next) => {
    try {
        const { cidr, reason } = z.object({
            cidr: z.string().min(1).max(64),
            reason: z.string().max(300).optional(),
        }).parse(req.body);
        const added = blocklist.add(cidr, reason);
        const applied = await blocklist.sync();
        res.json({ ok: true, ...added, applied: applied.ok, appliedError: applied.error });
    } catch (err) {
        next(err);
    }
});

/** Удалить правило. */
router.delete('/:id', async (req, res, next) => {
    try {
        const id = z.coerce.number().int().positive().parse(req.params.id);
        if (!blocklist.remove(id)) throw httpError(404, 'Правило не найдено');
        const applied = await blocklist.sync();
        res.json({ ok: true, applied: applied.ok, appliedError: applied.error });
    } catch (err) {
        next(err);
    }
});

/** Включить или выключить правило. */
router.patch('/:id', async (req, res, next) => {
    try {
        const id = z.coerce.number().int().positive().parse(req.params.id);
        const { enabled } = z.object({ enabled: z.boolean() }).parse(req.body);
        if (!blocklist.setEnabled(id, enabled)) throw httpError(404, 'Правило не найдено');
        const applied = await blocklist.sync();
        res.json({ ok: true, applied: applied.ok, appliedError: applied.error });
    } catch (err) {
        next(err);
    }
});

/** Переприменить список на сервере. */
router.post('/apply', async (req, res, next) => {
    try {
        const result = await blocklist.sync();
        if (!result.ok) throw httpError(500, result.error);
        res.json({ ok: true });
    } catch (err) {
        next(err);
    }
});

module.exports = router;