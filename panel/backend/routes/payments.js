/**
 * @fileoverview Платежи: вебхуки провайдеров (ЮKassa, CryptoBot),
 * промокоды, ручное подтверждение оплаты администратором.
 * @module routes/payments
 */

const express = require('express');
const crypto = require('crypto');
const { z } = require('zod');
const db = require('../db');
const telemt = require('../services/telemtApi');
const { requireAuth } = require('../middleware/auth');
const { httpError } = require('../middleware/errorHandler');
const { fireWebhook } = require('../services/webhooks');
const { getAll } = require('./settings');
const logger = require('../utils/logger');

const router = express.Router();

/**
 * Помечает платёж успешным и выдаёт/продлевает доступ покупателю.
 * @param {number} paymentId - id платежа в БД
 */
async function completePayment(paymentId) {
    // Атомарный захват: помечаем успех ДО ветвления — исключает двойную
    // выдачу/начисление при параллельных вебхуке и ручном подтверждении
    const claim = db.prepare(
        "UPDATE payments SET status = 'success', paid_at = datetime('now') WHERE id = ? AND status = 'pending'"
    ).run(paymentId);
    if (claim.changes === 0) {
        const existing = db.prepare('SELECT * FROM payments WHERE id = ?').get(paymentId);
        if (!existing) throw httpError(404, 'Платёж не найден');
        return existing; // уже обработан — идемпотентность
    }
    const payment = db.prepare('SELECT * FROM payments WHERE id = ?').get(paymentId);

    const tariff = db.prepare('SELECT * FROM tariffs WHERE id = ?').get(payment.tariff_id);

    // Продление конкретного прокси (покупка продления из кабинета)
    if (tariff && payment.client_id) {
        const client = db.prepare('SELECT * FROM clients WHERE id = ?').get(payment.client_id);
        if (client) {
            const base = client.expires_at && new Date(client.expires_at) > new Date()
                ? new Date(client.expires_at) : new Date();
            const newExpiry = new Date(base.getTime() + tariff.days * 86400000).toISOString();
            const patch = { expiration_rfc3339: newExpiry };
            if (tariff.max_ips) patch.max_unique_ips = tariff.max_ips;
            if (tariff.quota_gb) patch.data_quota_bytes = Math.round(tariff.quota_gb * 1024 ** 3);
            await telemt.patchUser(client.username, patch).catch(() => {});
            db.prepare("UPDATE clients SET expires_at = ?, status = 'active' WHERE id = ?").run(newExpiry, client.id);
            // Выбранный при продлении набор протоколов ('web'|'mtproto'|'both')
            const mode = payment.renew_protocols;
            const modeFlags = { web: [1, 0], mtproto: [0, 1], both: [1, 1] };
            if (mode && modeFlags[mode]) {
                db.prepare('UPDATE clients SET web_enabled = ?, mtproto_enabled = ? WHERE id = ?')
                    .run(...modeFlags[mode], client.id);
            }
            db.prepare("UPDATE payments SET status = 'success', paid_at = datetime('now') WHERE id = ?").run(paymentId);

            const bot = require('../services/bot');
            if (payment.telegram_id && bot.isRunning()) {
                const fmt = (d) => new Date(d).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' }) + ' МСК';
                const modeText = mode === 'web' ? '\n🔌 Протоколы: только Web Proxy'
                    : mode === 'mtproto' ? '\n🔌 Протоколы: только MTProto'
                    : mode === 'both' ? '\n🔌 Протоколы: Web Proxy + MTProto' : '';
                await bot.sendMessageTo(
                    payment.telegram_id,
                    `✅ <b>Продление оплачено!</b>\n\n📦 ${client.username} — до <b>${fmt(newExpiry)}</b>${modeText}`
                );
            }
            logger.info('Прокси продлён', { paymentId, username: client.username });
            return payment;
        }
    }

    // Пополнение баланса (платёж без тарифа): начисляем сумму на счёт клиента
    if (!tariff && payment.telegram_id) {
        const client = db.prepare('SELECT * FROM clients WHERE telegram_id = ?').get(payment.telegram_id);
        if (client) {
            db.prepare('UPDATE clients SET balance = balance + ? WHERE id = ?')
                .run(payment.amount, client.id);
            db.prepare("UPDATE payments SET status = 'success', paid_at = datetime('now') WHERE id = ?").run(paymentId);
            const bot = require('../services/bot');
            await bot.notifyDeposit(payment.telegram_id, payment.amount).catch(() => {});
        } else {
            db.prepare("UPDATE payments SET status = 'success', paid_at = datetime('now') WHERE id = ?").run(paymentId);
        }
        fireWebhook('payment.success', { payment_id: paymentId, amount: payment.amount, currency: payment.currency, kind: 'deposit' });
        logger.info('Баланс пополнен', { paymentId, amount: payment.amount });
        return payment;
    }

    // Если платёж из бота — выдаём доступ и отправляем ссылки покупателю
    if (payment.telegram_id && tariff) {
        const bot = require('../services/bot');
        await bot.issueAccessFor(payment.telegram_id, tariff, paymentId);
    } else {
        db.prepare("UPDATE payments SET status = 'success', paid_at = datetime('now') WHERE id = ?").run(paymentId);
    }

    fireWebhook('payment.success', { payment_id: paymentId, amount: payment.amount, currency: payment.currency });
    logger.info('Платёж подтверждён', { paymentId, provider: payment.provider });
    return payment;
}

// ===========================================================================
// Вебхуки провайдеров (публичные, без JWT — проверка подписи провайдера)
// ===========================================================================

// --- ЮKassa: верификация через API + обработка payment.succeeded ---
// БЕЗ проверки нельзя: кто угодно может POST-нуть "оплату" и получить прокси.
router.post('/webhook/yookassa', async (req, res) => {
    try {
        const event = req.body;
        if (event?.event !== 'payment.succeeded') return res.json({ ok: true });

        const ykPaymentId = event?.object?.id;
        const localPaymentId = Number(event?.object?.metadata?.tggate_payment_id);
        if (!ykPaymentId || !localPaymentId) return res.json({ ok: true });

        // Верифицируем платёж напрямую в ЮKassa (авторитетный источник)
        const bs = (getAll().bot_settings) || {};
        if (!bs.yookassa_shop_id || !bs.yookassa_secret_key) {
            logger.error('ЮKassa вебхук: ключи магазина не настроены — игнорирую');
            return res.status(400).json({ error: 'ЮKassa не настроена' });
        }
        const vres = await fetch(`https://api.yookassa.ru/v3/payments/${encodeURIComponent(ykPaymentId)}`, {
            headers: { Authorization: 'Basic ' + Buffer.from(`${bs.yookassa_shop_id}:${bs.yookassa_secret_key}`).toString('base64') },
            signal: AbortSignal.timeout(10000),
        });
        if (!vres.ok) {
            logger.error('ЮKassa верификация: платёж не получен', { ykPaymentId, status: vres.status });
            return res.status(400).json({ error: 'verification failed' });
        }
        const vp = await vres.json();
        if (vp.status !== 'succeeded' || Number(vp.metadata?.tggate_payment_id) !== localPaymentId) {
            logger.error('ЮKassa верификация провалена', { ykPaymentId, status: vp.status });
            return res.status(400).json({ error: 'verification failed' });
        }

        await completePayment(localPaymentId);
        res.json({ ok: true });
    } catch (err) {
        logger.error('Ошибка вебхука ЮKassa', { error: err.message });
        res.status(500).json({ error: 'Ошибка обработки' });
    }
});

// --- CryptoBot: проверка HMAC-подписи ---
router.post('/webhook/cryptobot', async (req, res) => {
    try {
        const botSettings = require('../services/bot').getBotSettings();
        const token = botSettings.cryptobot_token;
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

// --- Список платежей (с username покупателя) ---
router.get('/', requireAuth, (req, res) => {
    const payments = db.prepare(
        `SELECT p.*, t.name AS tariff_name,
                (SELECT c.username FROM clients c WHERE c.telegram_id = p.telegram_id LIMIT 1) AS username
         FROM payments p
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

// --- Отмена платежа (покупатель не оплатил) ---
router.post('/:id/cancel', requireAuth, (req, res, next) => {
    try {
        const result = db.prepare(
            "UPDATE payments SET status = 'cancelled' WHERE id = ? AND status = 'pending'"
        ).run(Number(req.params.id));
        if (result.changes === 0) throw httpError(404, 'Платёж не найден или уже обработан');
        logger.info('Платёж отменён администратором', { paymentId: req.params.id });
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

module.exports = { router, completePayment };
