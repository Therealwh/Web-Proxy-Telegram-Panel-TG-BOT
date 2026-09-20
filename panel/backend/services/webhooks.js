/**
 * @fileoverview Отправка вебхуков внешним сервисам.
 * События подписываются HMAC-SHA256 (заголовок X-TGGATE-Signature),
 * при ошибке — повторные попытки с экспоненциальной задержкой.
 * @module services/webhooks
 */

const crypto = require('crypto');
const db = require('../db');
const logger = require('../utils/logger');

const MAX_RETRIES = 3;

/**
 * Отправляет событие всем подписанным вебхукам (асинхронно, с ретраями).
 * @param {string} event - имя события (client.created, payment.success и т.д.)
 * @param {object} payload - данные события
 */
async function fireWebhook(event, payload) {
    const hooks = db.prepare('SELECT * FROM webhooks WHERE event = ? AND enabled = 1').all(event);
    for (const hook of hooks) {
        deliverWithRetry(hook, event, payload).catch(() => {});
    }
}

/**
 * Доставка одного вебхука с повторными попытками.
 * @param {object} hook - запись вебхука из БД
 * @param {string} event
 * @param {object} payload
 * @param {number} [attempt=1]
 */
async function deliverWithRetry(hook, event, payload, attempt = 1) {
    const body = JSON.stringify({ event, data: payload, ts: new Date().toISOString() });
    const signature = crypto.createHmac('sha256', hook.secret).update(body).digest('hex');

    try {
        const res = await fetch(hook.url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-TGGATE-Event': event,
                'X-TGGATE-Signature': `sha256=${signature}`,
            },
            body,
            signal: AbortSignal.timeout(10000),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        logger.info('Вебхук доставлен', { event, url: hook.url });
    } catch (err) {
        logger.warn('Ошибка доставки вебхука', { event, url: hook.url, attempt, error: err.message });
        if (attempt < MAX_RETRIES) {
            // Экспоненциальная задержка: 5с, 25с, 125с
            setTimeout(() => deliverWithRetry(hook, event, payload, attempt + 1).catch(() => {}),
                5000 * 5 ** (attempt - 1)).unref();
        }
    }
}

module.exports = { fireWebhook };
