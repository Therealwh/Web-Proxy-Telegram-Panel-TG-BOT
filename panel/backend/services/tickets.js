/**
 * @fileoverview Тикеты поддержки: клиент пишет в бота, админ отвечает из
 * панели или из бота. Уведомления в обе стороны, статусы open/answered/closed.
 *
 * Статусная модель (unread-семантика без лишних колонок):
 *   'open'     — последнее сообщение от клиента (ждёт ответа админа)
 *   'answered' — последнее сообщение от админа (ждёт клиента)
 *   'closed'   — обращение закрыто (админом или клиентом)
 * @module services/tickets
 */

const db = require('../db');
const logger = require('../utils/logger');

/** Экранирование HTML для пользовательских текстов в HTML-сообщениях. */
function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

/** Автоответ клиенту при создании обращения. */
const FIRST_RESPONSE_NOTE = 'Администрация отвечает в течение 24 часов — обычно гораздо быстрее.';

/**
 * Создаёт обращение от пользователя бота.
 * @param {number} telegramId
 * @param {string} text - первое сообщение
 * @returns {{id: number}}
 */
function createTicket(telegramId, text) {
    const clean = String(text || '').trim().slice(0, 4000);
    const client = db.prepare('SELECT id FROM clients WHERE telegram_id = ? LIMIT 1').get(telegramId);
    const info = db.prepare(
        `INSERT INTO tickets (telegram_id, client_id, subject, status, updated_at, last_message, last_sender)
         VALUES (?, ?, ?, 'open', datetime('now'), ?, 'client')`
    ).run(telegramId, client?.id ?? null, clean.slice(0, 80), clean);
    const ticketId = info.lastInsertRowid;
    db.prepare('INSERT INTO ticket_messages (ticket_id, sender, text) VALUES (?, ?, ?)')
        .run(ticketId, 'client', clean);
    logger.info('Тикет создан', { ticketId, tgId: telegramId });
    return { id: ticketId };
}

/** Сообщение клиента в существующий открытый тикет. @returns {number|null} id тикета */
function addUserMessage(telegramId, text) {
    const clean = String(text || '').trim().slice(0, 4000);
    if (!clean) return null;
    const ticket = db.prepare(
        "SELECT id FROM tickets WHERE telegram_id = ? AND status IN ('open', 'answered') ORDER BY id DESC LIMIT 1"
    ).get(telegramId);
    if (!ticket) return null;
    db.prepare('INSERT INTO ticket_messages (ticket_id, sender, text) VALUES (?, ?, ?)')
        .run(ticket.id, 'client', clean);
    db.prepare(
        "UPDATE tickets SET status = 'open', updated_at = datetime('now'), last_message = ?, last_sender = 'client' WHERE id = ?"
    ).run(clean, ticket.id);
    return ticket.id;
}

/** Медиа от клиента (фото/PDF) в открытый тикет. @returns {number|null} id тикета */
function addMediaMessage(telegramId, media) {
    const ticket = db.prepare(
        "SELECT id FROM tickets WHERE telegram_id = ? AND status IN ('open', 'answered') ORDER BY id DESC LIMIT 1"
    ).get(telegramId);
    if (!ticket) return null;
    db.prepare(
        `INSERT INTO ticket_messages (ticket_id, sender, text, media_type, file_id, file_name)
         VALUES (?, 'client', ?, ?, ?, ?)`
    ).run(ticket.id, media.caption || '', media.media_type, media.file_id, media.file_name || null);
    const preview = media.file_type === 'photo' ? '📷 Фото' : `📄 ${media.file_name || 'Файл'}`;
    db.prepare(
        "UPDATE tickets SET status = 'open', updated_at = datetime('now'), last_message = ?, last_sender = 'client' WHERE id = ?"
    ).run(preview, ticket.id);
    logger.info('Тикет: медиа от клиента', { ticketId: ticket.id, type: media.media_type });
    return ticket.id;
}

/** Сообщение админа (из панели или из бота). @returns {number|null} id тикета */
function addAdminMessage(ticketId, text, notifyUser = true) {
    const clean = String(text || '').trim().slice(0, 4000);
    if (!clean) return null;
    const ticket = db.prepare('SELECT * FROM tickets WHERE id = ?').get(ticketId);
    if (!ticket || ticket.status === 'closed') return null;
    db.prepare('INSERT INTO ticket_messages (ticket_id, sender, text) VALUES (?, ?, ?)')
        .run(ticketId, 'admin', clean);
    db.prepare(
        "UPDATE tickets SET status = 'answered', updated_at = datetime('now'), last_message = ?, last_sender = 'admin' WHERE id = ?"
    ).run(clean, ticketId);
    logger.info('Тикет: ответ админа', { ticketId });

    // Уведомление клиенту в бот
    if (notifyUser && ticket.telegram_id) {
        const bot = require('./bot');
        if (bot.isRunning()) {
            bot.sendMessageTo(ticket.telegram_id,
                `💬 <b>Ответ поддержки</b> по обращению #${ticketId}:\n\n${escapeHtml(clean)}\n\n` +
                `Ответить можно в этом же диалоге — «🛟 Поддержка» → «✍️ Написать в поддержку».`
            ).catch((e) => logger.warn('Тикет: уведомление клиенту не отправлено', { ticketId, error: e.message }));
        }
    }
    return ticketId;
}

/** Закрыть обращение (админом или клиентом). @returns {boolean} */
function closeTicket(ticketId, byAdmin) {
    const ticket = db.prepare('SELECT * FROM tickets WHERE id = ?').get(ticketId);
    if (!ticket || ticket.status === 'closed') return false;
    db.prepare("UPDATE tickets SET status = 'closed', closed_at = datetime('now'), updated_at = datetime('now') WHERE id = ?")
        .run(ticketId);

    // Уведомляем вторую сторону
    if (ticket.telegram_id) {
        const bot = require('./bot');
        if (bot.isRunning()) {
            if (byAdmin) {
                bot.sendMessageTo(ticket.telegram_id,
                    `✅ Обращение #${ticketId} закрыто. Если вопрос остался — создайте новое: «🛟 Поддержка» → «✍️ Написать в поддержку».`)
                    .catch(() => {});
            } else if (isAdminNotified()) {
                // Клиент закрыл сам — сообщим админу
                const { notifyAdmin } = require('./notifier');
                const { getAll } = require('../routes/settings');
                notifyAdmin(getAll(), `✅ Клиент закрыл обращение #${ticketId}`).catch(() => {});
            }
        }
    }
    return true;
}

function isAdminNotified() {
    try {
        const { getAll } = require('../routes/settings');
        return !!getAll().tg_admin_chat_id;
    } catch { return false; }
}

/**
 * Список тикетов для панели: открытые сверху (по последнему сообщению),
 * метки «ждёт ответа» / «ожидает клиента».
 */
function listTickets({ search = '', status = '' } = {}) {
    let rows = db.prepare(
        `SELECT t.*, bu.username, bu.first_name, bu.last_name,
                (SELECT COUNT(*) FROM ticket_messages m WHERE m.ticket_id = t.id) AS messages_count
         FROM tickets t
         LEFT JOIN bot_users bu ON bu.telegram_id = t.telegram_id
         ORDER BY t.updated_at DESC`
    ).all();

    if (search) {
        const q = String(search).toLowerCase().replace(/^#/, '');
        rows = rows.filter((t) =>
            String(t.id).includes(q) ||
            String(t.telegram_id).includes(q) ||
            (t.username || '').toLowerCase().includes(q) ||
            (t.first_name || '').toLowerCase().includes(q) ||
            (t.last_message || '').toLowerCase().includes(q));
    }
    if (status === 'open') rows = rows.filter((t) => t.status === 'open');
    else if (status === 'answered') rows = rows.filter((t) => t.status === 'answered');
    else if (status === 'closed') rows = rows.filter((t) => t.status === 'closed');

    return rows.map((t) => ({
        ...t,
        waiting: t.status === 'open',          // ждёт ответа админа
        user_waiting: t.status === 'answered', // админ ответил — ждём клиента
    }));
}

/** Сообщения тикета (по возрастанию). */
function ticketMessages(ticketId) {
    return db.prepare(
        'SELECT * FROM ticket_messages WHERE ticket_id = ? ORDER BY id ASC'
    ).all(ticketId);
}

module.exports = {
    createTicket, addUserMessage, addAdminMessage, closeTicket,
    listTickets, ticketMessages, addMediaMessage, FIRST_RESPONSE_NOTE,
};
