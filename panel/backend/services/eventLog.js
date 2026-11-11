/**
 * @fileoverview Понятные события панели: покупки, продления, пополнения,
 * ошибки — короткая лента для админа. Хранятся СУТКИ и чистятся автоматически
 * (раз в час планировщиком), чтобы не забивать память.
 * @module services/eventLog
 */

const db = require('../db');
const logger = require('../utils/logger');

/** TTL событий: ровно сутки. */
const TTL_SQL = "datetime('now', '-1 day')";

/**
 * Пишет событие в ленту. Не бросает исключений — события не должны
 * ломать основной поток (покупку/платёж).
 * @param {string} event - тип: purchase | renewal | deposit | error | cleanup | issue
 * @param {string} title - понятный заголовок
 * @param {string} [details] - детали одной строкой
 * @param {'info'|'error'} [level]
 * @param {number|null} [telegramId] - чьё событие
 */
function logEvent(event, title, details = null, level = 'info', telegramId = null) {
    try {
        db.prepare(
            'INSERT INTO event_logs (event, title, details, level, telegram_id) VALUES (?, ?, ?, ?, ?)'
        ).run(event, title, details, level, telegramId);
    } catch (e) {
        logger.warn('Событие: не удалось записать', { event, error: e.message });
    }
}

/** Последние события (новые сверху). @param {number} [limit=200] */
function listEvents(limit = 200) {
    return db.prepare(
        'SELECT * FROM event_logs ORDER BY id DESC LIMIT ?'
    ).all(Math.min(500, Math.max(1, limit)));
}

/** Чистит события старше суток. @returns {number} удалено строк */
function cleanupOld() {
    try {
        return db.prepare(`DELETE FROM event_logs WHERE created_at < ${TTL_SQL}`).run().changes;
    } catch (e) {
        logger.warn('События: не удалось почистить', { error: e.message });
        return 0;
    }
}

module.exports = { logEvent, listEvents, cleanupOld, TTL_SQL };
