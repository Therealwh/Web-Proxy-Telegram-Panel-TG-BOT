/**
 * @fileoverview Платежи: вебхуки провайдеров (ЮKassa, CryptoBot),
 * промокоды, ручное подтверждение оплаты администратором.
 * @module routes/payments
 */

const express = require('express');
const crypto = require('crypto');
const { z } = require('zod');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const { httpError } = require('../middleware/errorHandler');
const { fireWebhook } = require('../services/webhooks');
const { getAll } = require('./settings');
const logger = require('../utils/logger');

const router = express.Router();

/**
 * Помечает платёж успешным и выдаёт/продлевает доступ клиенту.
 * @param {number} paymentId - id платежа в БД
 */
async function completePayment(paymentId) {
    const payment = db.prepare('SELECT * FROM payments WHERE id = ?').get(paymentId);
    if (!payment) throw httpError(404, 'Платёж не найден');
    if (payment.status === 'success') return payment; // идемпотентность

    const tariff = db.prepare('SELECT * FROM tariffs WHERE id = ?').get(payment.tariff_id);
    db.prepare("UPDATE payments SET status = 'success', paid_at = datetime('now') WHERE id = ?").run(paymentId);

    fireWebhook('payment.success', { payment_id: paymentId, amount: payment.amount, currency: payment.currency });
    logger.info('Платёж подтверждён', { paymentId, provider: payment.provider });
    return payment;
}

// ===========================================================================
// Вебхуки провайдеров (публичные, без JWT — проверка подписи провайдера)
// ===========================================================================

// --- ЮKassa: проверяем по событию payment.succeeded ---
router.post('/webhook/yookassa', async (req, res) => {
    try {
        const event = req.body;
        if (event?.event !== 'payment.succeeded') return res.json({ ok: true });
        const paymentId = Number(event?.object?.metadata?.tggate_payment_id);
        if (paymentId) await completePayment(paymentId);
        res.json({ ok: true });
    } catch (err) {
        logger.error('Ошибка вебхука ЮKassa', { error: err.message });
        res.status(500).json({ error: 'Ошибка обработки' });
    }
});

// --- CryptoBot: проверка HMAC-подписи ---
router.post('/webhook/cryptobot', async (req, res) => {
    try {
        const settings = getAll();
        const token = settings.cryptobot_token;
        if (!token) return res.status(400).json({ error: 'CryptoBot не настроен' });

        // Подпись: HMAC-SHA256 от тела запроса ключом sha256(token)
        const signature = req.headers['crypto-pay-api-signature'];
        const secret = crypto.createHash('sha256').update(token).digest();
        const expected = crypto.createHmac('sha256', secret)
            .update(JSON.stringify(req.body)).digest('hex');
        if (signature !== expected) return res.status(401).json({ error: 'Неверная подпись' });

        const update = req.body;
        if (update?.update_type === 'invoice_paid') {
            const paymentId = Number(update.payload?.payload);
            if (paymentId) await completePayment(paymentId);
        }
        res.json({ ok: true });
    } catch (err) {
        logger.error('Ошибка вебхука CryptoBot', { error: err.message });
        res.status(500).json({ error: 'Ошибка обработки' });
    }
});

// ===========================================================================
// Админские эндпоинты (JWT)
// ===========================================================================

// --- Список платежей ---
router.get('/', requireAuth, (req, res) => {
    const payments = db.prepare(
        `SELECT p.*, t.name AS tariff_name FROM payments p
         LEFT JOIN tariffs t ON t.id = p.tariff_id
         ORDER BY p.created_at DESC LIMIT 200`
    ).all();
    res.json({ payments });
});

// --- Ручное подтверждение оплаты (для ручных продаж) ---
router.post('/:id/confirm', requireAuth, async (req, res, next) => {
    try {
        await completePayment(Number(req.params.id));
        res.json({ ok: true });
    } catch (err) {
        next(err);
    }
});

// --- Промокоды ---
router.get('/promo', requireAuth, (req, res) => {
    res.json({ promo: db.prepare('SELECT * FROM promo_codes ORDER BY code').all() });
});

router.post('/promo', requireAuth, (req, res, next) => {
    try {
        const schema = z.object({
            code: z.string().regex(/^[A-Z0-9_-]{3,32}$/i, 'Код: 3-32 символа (латиница, цифры)'),
            discount_percent: z.number().min(1).max(100).nullable().optional(),
            discount_fixed: z.number().min(1).nullable().optional(),
            first_payment_only: z.boolean().optional(),
            max_uses: z.number().int().min(1).nullable().optional(),
            expires_at: z.string().datetime({ offset: true }).nullable().optional(),
        });
        const p = schema.parse(req.body);
        if (!p.discount_percent && !p.discount_fixed) {
            throw httpError(400, 'Укажите скидку: в процентах или фиксированную');
        }
        db.prepare(
            `INSERT INTO promo_codes (code, discount_percent, discount_fixed, first_payment_only, max_uses, expires_at)
             VALUES (?, ?, ?, ?, ?, ?)`
        ).run(p.code.toUpperCase(), p.discount_percent ?? null, p.discount_fixed ?? null,
              p.first_payment_only ? 1 : 0, p.max_uses ?? null, p.expires_at ?? null);
        res.status(201).json({ ok: true });
    } catch (err) {
        next(err);
    }
});

router.delete('/promo/:code', requireAuth, (req, res, next) => {
    try {
        const result = db.prepare('DELETE FROM promo_codes WHERE code = ?').run(req.params.code);
        if (result.changes === 0) throw httpError(404, 'Промокод не найден');
        res.json({ ok: true });
    } catch (err) {
        next(err);
    }
});

// --- Проверка промокода (для бота, публичный) ---
router.post('/promo/check', (req, res, next) => {
    try {
        const schema = z.object({ code: z.string().max(32), amount: z.number().min(0) });
        const { code, amount } = schema.parse(req.body);
        const promo = db.prepare('SELECT * FROM promo_codes WHERE code = ? AND enabled = 1').get(code.toUpperCase());
        if (!promo) return res.json({ valid: false, error: 'Промокод не найден' });
        if (promo.expires_at && new Date(promo.expires_at) < new Date()) {
            return res.json({ valid: false, error: 'Промокод истёк' });
        }
        if (promo.max_uses && promo.used_count >= promo.max_uses) {
            return res.json({ valid: false, error: 'Промокод исчерпан' });
        }
        const discount = promo.discount_percent
            ? Math.round(amount * promo.discount_percent / 100)
            : Math.min(amount, promo.discount_fixed || 0);
        res.json({ valid: true, discount, final: Math.max(0, amount - discount) });
    } catch (err) {
        next(err);
    }
});

module.exports = router;
