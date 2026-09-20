/**
 * @fileoverview Создание платежей через провайдеров: CryptoBot (CryptoCloud)
 * и ЮKassa. Провайдер и ключи настраиваются в панели (Telegram-бот → Платежи).
 * @module services/payments
 */

const logger = require('../utils/logger');

/**
 * Создаёт платёж у провайдера и возвращает ссылку на оплату.
 * @param {object} opts
 * @param {number} opts.paymentId - id платежа в БД (передаётся провайдеру для вебхука)
 * @param {object} opts.tariff - { name, price, currency }
 * @param {object} opts.settings - настройки бота (bot_settings из панели)
 * @returns {Promise<{url: string, provider: string}|null>} null — если провайдер не настроен
 */
async function createPaymentUrl({ paymentId, tariff, settings }) {
    if (settings.cryptobot_token) {
        return createCryptoBotInvoice({ paymentId, tariff, token: settings.cryptobot_token });
    }
    if (settings.yookassa_shop_id && settings.yookassa_secret_key) {
        return createYooKassaPayment({
            paymentId, tariff,
            shopId: settings.yookassa_shop_id,
            secretKey: settings.yookassa_secret_key,
        });
    }
    return null;
}

/**
 * CryptoBot: createInvoice. payload = paymentId, вебхук подтверждает оплату.
 */
async function createCryptoBotInvoice({ paymentId, tariff, token }) {
    try {
        const res = await fetch('https://pay.crypt.bot/api/createInvoice', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Crypto-Pay-API-Token': token },
            body: JSON.stringify({
                currency_type: 'fiat',
                fiat_type: tariff.currency === 'USD' ? 'USD' : tariff.currency === 'EUR' ? 'EUR' : 'RUB',
                amount: String(tariff.price),
                description: `TGGATE: тариф «${tariff.name}»`,
                payload: String(paymentId),
                expires_in: 3600,
            }),
            signal: AbortSignal.timeout(6000), // быстрый фолбэк — пользователь не ждёт
        });
        const data = await res.json();
        if (!data.ok) throw new Error(data.error?.name || 'CryptoBot error');
        const url = data.result.pay_url || data.result.bot_invoice_url;
        logger.info('CryptoBot инвойс создан', { paymentId, url });
        return { url, provider: 'cryptobot' };
    } catch (err) {
        logger.error('Ошибка создания инвойса CryptoBot', { paymentId, error: err.message });
        return null;
    }
}

/**
 * ЮKassa: создание платежа с redirect-подтверждением.
 * metadata.tggate_payment_id используется вебхуком.
 */
async function createYooKassaPayment({ paymentId, tariff, shopId, secretKey }) {
    try {
        const idempotenceKey = require('crypto').randomBytes(16).toString('hex');
        const res = await fetch('https://api.yookassa.ru/v3/payments', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Idempotence-Key': idempotenceKey,
                Authorization: 'Basic ' + Buffer.from(`${shopId}:${secretKey}`).toString('base64'),
            },
            body: JSON.stringify({
                amount: { value: Number(tariff.price).toFixed(2), currency: tariff.currency || 'RUB' },
                capture: true,
                confirmation: { type: 'redirect', return_url: 'https://t.me/' },
                description: `TGGATE: тариф «${tariff.name}» (#${paymentId})`,
                metadata: { tggate_payment_id: String(paymentId) },
            }),
            signal: AbortSignal.timeout(6000), // быстрый фолбэк
        });
        if (!res.ok) throw new Error(`ЮKassa HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
        const data = await res.json();
        const url = data.confirmation?.confirmation_url;
        if (!url) throw new Error('Нет confirmation_url в ответе');
        logger.info('Платёж ЮKassa создан', { paymentId, url });
        return { url, provider: 'yookassa' };
    } catch (err) {
        logger.error('Ошибка создания платежа ЮKassa', { paymentId, error: err.message });
        return null;
    }
}

module.exports = { createPaymentUrl };
