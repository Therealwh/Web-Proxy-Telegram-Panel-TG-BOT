/**
 * @fileoverview Одноразовые тикеты для WebSocket-подключений.
 * Заменяет JWT в query WebSocket (C1): тикет — короткоживущий JWT типа 'ws'
 * с jti, который можно использовать ОДИН раз (synchronised in-memory set).
 * OWASP-паттерн для браузерного WS, который не умеет заголовки.
 * @module utils/wsTicket
 */

const jwt = require('jsonwebtoken');
const config = require('../config');

const TICKET_TTL = 30; // секунд

/** @type {Set<string>} использованные jti */
const usedJti = new Set();

/**
 * Выдаёт одноразовый тикет для установления WS-соединения.
 * @param {{id: number|string, login: string}} admin - администратор из requireAuth
 * @returns {string} JWT-тикет (30 сек, одно использование)
 */
function issueTicket(admin) {
    return jwt.sign(
        { sub: admin.id, login: admin.login, type: 'ws', jti: require('crypto').randomBytes(16).toString('hex') },
        config.jwtSecret,
        { expiresIn: `${TICKET_TTL}s` }
    );
}

/**
 * Проверяет тикет: подпись, TTL, тип и одноразовость jti.
 * @param {string} ticket
 * @returns {{id: number|string, login: string}|null} admin или null
 */
function verifyTicket(ticket) {
    if (typeof ticket !== 'string' || ticket.length === 0 || ticket.length > 1024) return null;
    let payload;
    try {
        payload = jwt.verify(ticket, config.jwtSecret);
    } catch {
        return null;
    }
    if (payload.type !== 'ws' || !payload.jti) return null;
    if (usedJti.has(payload.jti)) return null; // повторное использование
    usedJti.add(payload.jti);
    return { id: payload.sub, login: payload.login };
}

/**
 * Периодическая очистка использованных jti (защита от роста памяти).
 * Храним максимум 10 000 последних; вызывать из scheduler.
 */
function cleanupTickets() {
    if (usedJti.size > 10000) {
        // Set сохраняет порядок вставки — удаляем самые старые
        const excess = usedJti.size - 10000;
        let i = 0;
        for (const jti of usedJti) {
            if (i++ >= excess) break;
            usedJti.delete(jti);
        }
    }
}

module.exports = { issueTicket, verifyTicket, cleanupTickets, TICKET_TTL };
