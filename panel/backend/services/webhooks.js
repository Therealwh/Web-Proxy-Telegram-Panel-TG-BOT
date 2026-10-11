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
        markDelivered(hook.id, null);
    } catch (err) {
        logger.warn('Ошибка доставки вебхука', { event, url: hook.url, attempt, error: err.message });
        markDelivered(hook.id, err.message);
        if (attempt < MAX_RETRIES) {
            // Экспоненциальная задержка: 5с, 25с, 125с
            setTimeout(() => deliverWithRetry(hook, event, payload, attempt + 1).catch(() => {}),
                5000 * 5 ** (attempt - 1)).unref();
        }
    }
}

/**
 * Фиксирует результат последней доставки в самой записи вебхука,
 * чтобы состояние видно было в панели, а не только в логах сервера.
 * @param {number} id - id вебхука
 * @param {string|null} error - текст ошибки или null при успехе
 */
function markDelivered(id, error) {
    try {
        if (error) {
            db.prepare('UPDATE webhooks SET last_status = 0, last_error = ? WHERE id = ?')
                .run(String(error).slice(0, 500), id);
        } else {
            db.prepare(
                "UPDATE webhooks SET last_status = 1, last_error = NULL, last_ok_at = datetime('now') WHERE id = ?"
            ).run(id);
        }
    } catch {
        // Статус доставки — справочная информация, ошибка записи не должна ломать доставку
    }
}

/**
 * Отправляет одно событие конкретному вебхуку (используется кнопкой «Тест»).
 * @param {object} hook - запись вебхука
 * @param {string} event
 * @param {object} payload
 * @returns {Promise<{ok: boolean, error?: string}>}
 */
function deliverTo(hook, event, payload) {
    return new Promise((resolve) => {
        deliverWithRetry(hook, event, payload).then(() => {
            const row = db.prepare('SELECT last_status, last_error FROM webhooks WHERE id = ?').get(hook.id);
            resolve(row?.last_status ? { ok: true } : { ok: false, error: row?.last_error || 'неизвестная ошибка' });
        });
    });
}

module.exports = { fireWebhook, deliverTo };
