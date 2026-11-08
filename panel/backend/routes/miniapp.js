/**
 * @fileoverview Telegram Mini App: авторизация через подписанный initData,
 * личный кабинет клиента — прокси, подключение, покупка/продление
 * (карта админа или баланс), пополнение, рефералка.
 * @module routes/miniapp
 */

const express = require('express');
const rateLimit = require('express-rate-limit');
const jwt = require('jsonwebtoken');
const { z } = require('zod');
const db = require('../db');
const config = require('../config');
const logger = require('../utils/logger');
const { httpError } = require('../middleware/errorHandler');
const { validateInitData } = require('../utils/telegramWebApp');
const { getAll } = require('./settings');
const { deductBalanceSpread, totalBalance } = require('../utils/balance');
const { clientLinks } = require('../services/links');
const { userStats, ensureReferralCode } = require('../utils/referral');

const router = express.Router();

const SUPPORT_USERNAME = '@tggatetopsupport';
const TOKEN_TTL_SEC = 6 * 60 * 60; // сессия мини-аппа: 6 часов

const authLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 15,
    standardHeaders: true,
    legacyHeaders: false,
    message: 'Слишком много попыток входа',
});

/** Настройки бота (валюта, реквизиты, токен для проверки подписи). */
function botSettings() {
    return { enabled: false, currency: 'RUB', ...(getAll().bot_settings || {}) };
}

/** Знак валюты. */
function currencySign(currency) {
    return currency === 'RUB' ? '₽' : currency === 'USD' ? '$' : currency === 'EUR' ? '€' : currency === 'STAR' ? '⭐' : currency || '';
}

// ===========================================================================
// Авторизация: initData → JWT мини-аппа
// ===========================================================================

/**
 * Разовый код входа: для клиентов, где Telegram не передаёт initData.
 * Код выдаёт бот командой /appcode, живёт 10 минут, сгорает при входе.
 */
function consumeLoginCode(code) {
    const row = db.prepare('SELECT telegram_id, expires_at FROM miniapp_login_codes WHERE code = ?').get(code);
    if (!row) return null;
    db.prepare('DELETE FROM miniapp_login_codes WHERE code = ?').run(code);
    if (new Date(row.expires_at + 'Z') < new Date()) return null;
    return row.telegram_id;
}

router.post('/auth', authLimiter, (req, res) => {
    const bs = botSettings();
    if (!bs.bot_token) {
        return res.status(503).json({ error: 'Бот не настроен — мини-апп недоступен' });
    }
    const initData = String(req.body?.initData || '');
    const code = String(req.body?.code || '').trim();

    let tgId = null;
    let firstName = '';
    if (initData) {
        const user = validateInitData(initData, bs.bot_token);
        if (!user) {
            return res.status(401).json({ error: 'Подпись Telegram не сошлась. Откройте приложение через бота.' });
        }
        tgId = user.id;
        firstName = user.first_name || '';
    } else if (/^\d{6}$/.test(code)) {
        tgId = consumeLoginCode(code);
        if (!tgId) {
            return res.status(401).json({ error: 'Код не найден или истёк — запросите новый командой /appcode в боте' });
        }
        firstName = (db.prepare('SELECT first_name FROM bot_users WHERE telegram_id = ?').get(tgId) || {}).first_name || '';
    } else {
        return res.status(401).json({ error: 'Откройте приложение через бота или войдите по коду из /appcode' });
    }

    const token = jwt.sign(
        { tg: tgId, scope: 'miniapp' },
        config.jwtSecret,
        { expiresIn: TOKEN_TTL_SEC }
    );
    res.json({
        token,
        user: { id: tgId, first_name: firstName, username: '' },
    });
});

// --- Всё ниже — только с токеном мини-аппа ---
router.use((req, res, next) => {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) return res.status(401).json({ error: 'Требуется авторизация' });
    try {
        const payload = jwt.verify(token, config.jwtSecret);
        if (payload.scope !== 'miniapp' || !Number.isInteger(payload.tg)) {
            return res.status(401).json({ error: 'Недействительный токен' });
        }
        req.tgId = payload.tg;
        next();
    } catch {
        return res.status(401).json({ error: 'Сессия истекла — переоткройте приложение' });
    }
});

// ===========================================================================
// Данные кабинета
// ===========================================================================

router.get('/overview', async (req, res, next) => {
    try {
        const tgId = req.tgId;
        const s = getAll();
        const bs = botSettings();

        const clients = db.prepare(
            'SELECT * FROM clients WHERE telegram_id = ? ORDER BY (expires_at IS NULL), expires_at DESC'
        ).all(tgId);

        let botUsername = '';
        try {
            const api = require('../services/bot').getApi();
            botUsername = api ? (await api.getMe()).username : '';
        } catch { /* бот выключен */ }

        const proxies = clients.map((c) => {
            const links = clientLinks(c);
            const daysLeft = c.expires_at
                ? Math.max(0, Math.ceil((new Date(c.expires_at) - Date.now()) / 86400000))
                : null;
            return {
                id: c.id,
                username: c.username,
                status: c.status,
                expires_at: c.expires_at,
                days_left: daysLeft,
                balance: c.balance,
                web_enabled: !!c.web_enabled,
                mtproto_enabled: !!c.mtproto_enabled,
                web_link: links.web_https || null,
                mtproto_link: links.mtproto_https || null,
                faketls_link: links.mtproto_faketls_https || null,
                qr_token: c.qr_token || null,
            };
        });

        // Рефералка: код живёт на первой прокси-строке клиента
        let referral = null;
        const primary = clients.find((c) => c.status === 'active') || clients[0];
        if (primary && botUsername) {
            const code = ensureReferralCode(primary.id);
            if (code) {
                const st = userStats(primary.id);
                referral = {
                    link: `https://t.me/${botUsername}?start=ref_${code}`,
                    invited: st.invited + st.pending,
                    earned: st.earned,
                };
            }
        }

        res.json({
            user: { first_name: (db.prepare('SELECT first_name FROM bot_users WHERE telegram_id = ?').get(tgId) || {}).first_name || '' },
            balance: totalBalance(tgId),
            currency: bs.currency,
            currency_sign: currencySign(bs.currency),
            proxies,
            referral,
            requisites: {
                card: bs.pay_card || null,
                phone: bs.pay_phone || null,
                bank: bs.bank || null,
            },
            has_requisites: !!(bs.pay_card || bs.pay_phone),
            support: SUPPORT_USERNAME,
            status_url: s.status_url || null,
        });
    } catch (err) { next(err); }
});

router.get('/tariffs', (req, res) => {
    const bs = botSettings();
    const tariffs = db.prepare('SELECT * FROM tariffs WHERE enabled = 1 ORDER BY days').all()
        .map((t) => ({
            id: t.id, name: t.name, days: t.days, price: t.price,
            protocols: t.protocols, quota_gb: t.quota_gb, max_ips: t.max_ips,
            price_text: `${t.price} ${currencySign(bs.currency)}`,
        }));
    res.json({ tariffs, currency_sign: currencySign(bs.currency), balance: totalBalance(req.tgId) });
});

// ===========================================================================
// Покупка / продление / пополнение
// ===========================================================================

const paySchema = z.object({
    method: z.enum(['manual', 'balance']),
    tariffId: z.number().int().positive().optional(),
    clientId: z.number().int().positive().optional(),
    amount: z.number().positive().max(1_000_000).optional(),
});

/** Счёт «картой админа»: pending-платёж, админ подтвердит в панели. */
function createManualPayment({ tgId, tariff = null, clientId = null, amount = null }) {
    return db.prepare(
        `INSERT INTO payments (tariff_id, amount, currency, provider, status, telegram_id, client_id)
         VALUES (?, ?, ?, 'manual', 'pending', ?, ?)`
    ).run(tariff?.id ?? null, amount ?? tariff?.price ?? null,
          tariff?.currency ?? botSettings().currency, tgId, clientId).lastInsertRowid;
}

router.post('/purchase', async (req, res, next) => {
    try {
        const { method, tariffId } = paySchema.parse({ ...req.body, tariffId: Number(req.body?.tariffId) });
        const tariff = db.prepare('SELECT * FROM tariffs WHERE id = ? AND enabled = 1').get(tariffId);
        if (!tariff) throw httpError(400, 'Тариф недоступен');

        if (method === 'balance') {
            const bought = await buyWithBalance(req.tgId, tariff);
            return res.json({ ok: true, method, ...bought });
        }
        const paymentId = createManualPayment({ tgId: req.tgId, tariff });
        logger.info('Мини-апп: заказ карты админа', { paymentId, tariffId, tgId: req.tgId });
        res.json({ ok: true, method, payment_id: paymentId });
    } catch (err) { next(err); }
});

router.post('/renew', async (req, res, next) => {
    try {
        const { method, tariffId, clientId } = paySchema.parse({
            ...req.body,
            tariffId: Number(req.body?.tariffId),
            clientId: Number(req.body?.clientId),
        });
        const tariff = db.prepare('SELECT * FROM tariffs WHERE id = ? AND enabled = 1').get(tariffId);
        const client = db.prepare('SELECT * FROM clients WHERE id = ?').get(clientId);
        if (!tariff) throw httpError(400, 'Тариф недоступен');
        if (!client || client.telegram_id !== req.tgId) throw httpError(404, 'Прокси не найден');

        if (method === 'balance') {
            const { touched } = deductBalanceSpread(req.tgId, tariff.price);
            if (!touched.length) throw httpError(400, 'Недостаточно средств на балансе');
            const paymentId = db.prepare(
                `INSERT INTO payments (tariff_id, amount, currency, provider, status, telegram_id, client_id)
                 VALUES (?, ?, ?, 'balance', 'pending', ?, ?)`
            ).run(tariff.id, tariff.price, tariff.currency, req.tgId, client.id).lastInsertRowid;
            try {
                await require('./payments').completePayment(paymentId);
            } catch (e) {
                // Продление не прошло — возвращаем ровно списанное
                db.transaction(() => {
                    for (const t of touched) {
                        db.prepare('UPDATE clients SET balance = balance + ? WHERE id = ?').run(t.amount, t.id);
                    }
                })();
                db.prepare("UPDATE payments SET status = 'failed' WHERE id = ?").run(paymentId);
                logger.error('Мини-апп: продление с баланса не удалось, средства возвращены', { error: e.message });
                throw httpError(502, 'Не удалось продлить — средства возвращены на баланс');
            }
            const updated = db.prepare('SELECT * FROM clients WHERE id = ?').get(client.id);
            return res.json({
                ok: true, method,
                proxy: { id: updated.id, expires_at: updated.expires_at, username: updated.username },
            });
        }

        const paymentId = createManualPayment({ tgId: req.tgId, tariff, clientId: client.id });
        logger.info('Мини-апп: продление картой админа', { paymentId, clientId, tgId: req.tgId });
        res.json({ ok: true, method, payment_id: paymentId });
    } catch (err) { next(err); }
});

router.post('/deposit', (req, res, next) => {
    try {
        const schema = z.object({ amount: z.number().positive().max(1_000_000) });
        const amount = schema.parse({ amount: Number(req.body?.amount) }).amount;
        const paymentId = createManualPayment({ tgId: req.tgId, amount });
        logger.info('Мини-апп: пополнение картой админа', { paymentId, amount, tgId: req.tgId });
        res.json({ ok: true, method: 'manual', payment_id: paymentId, amount });
    } catch (err) { next(err); }
});

/** «Я оплатил» по счёту карты админа → уведомление админу. */
router.post('/paid', async (req, res, next) => {
    try {
        const paymentId = Number(req.body?.paymentId);
        const payment = db.prepare("SELECT * FROM payments WHERE id = ? AND status = 'pending'").get(paymentId);
        if (!payment || payment.telegram_id !== req.tgId) throw httpError(404, 'Счёт не найден');
        require('../services/notifier').notifyAdmin(getAll(),
            `🧾 <b>Клиент говорит, что оплатил</b>\n🧾 Счёт #${paymentId} — ${payment.amount} ${payment.currency}\n👤 tg${payment.tgId}\n\nПодтвердить: раздел «Продажи» → «Платежи к подтверждению»`
        ).catch(() => {});
        res.json({ ok: true });
    } catch (err) { next(err); }
});

/**
 * Покупка с внутреннего баланса: списание + выдача нового прокси.
 * Логика зеркалит paybal в боте (атомарное списание, возврат при сбое).
 */
async function buyWithBalance(tgId, tariff) {
    const balance = totalBalance(tgId);
    if (balance < tariff.price) throw httpError(400, 'Недостаточно средств на балансе');

    const { touched } = deductBalanceSpread(tgId, tariff.price);
    if (!touched.length) throw httpError(400, 'Недостаточно средств на балансе');

    const paymentId = db.prepare(
        `INSERT INTO payments (tariff_id, amount, currency, provider, status, telegram_id)
         VALUES (?, ?, ?, 'balance', 'pending', ?)`
    ).run(tariff.id, tariff.price, tariff.currency, tgId).lastInsertRowid;

    try {
        const client = await require('../services/bot').issueAccessFor(tgId, tariff, paymentId, { moneyIn: false });
        const links = clientLinks(client);
        return {
            proxy: {
                id: client.id,
                username: client.username,
                expires_at: client.expires_at,
                web_link: links.web_https || null,
                mtproto_link: links.mtproto_https || null,
            },
        };
    } catch (e) {
        db.transaction(() => {
            for (const t of touched) {
                db.prepare('UPDATE clients SET balance = balance + ? WHERE id = ?').run(t.amount, t.id);
            }
        })();
        db.prepare("UPDATE payments SET status = 'failed' WHERE id = ?").run(paymentId);
        logger.error('Мини-апп: покупка с баланса не удалась, средства возвращены', { error: e.message });
        throw httpError(502, 'Не удалось выдать прокси — средства возвращены на баланс');
    }
}

module.exports = router;
