/**
 * @fileoverview Токены публичных QR-страниц клиентов.
 * Публичная ссылка вида /qr/<token> — случайный 16-символьный hex,
 * перебор невозможен (в отличие от порядковых id).
 * @module services/qrTokens
 */

const crypto = require('crypto');
const db = require('../db');

/**
 * Возвращает токен клиента, создавая при первом обращении.
 * @param {number} clientId
 * @returns {string|null} токен или null, если клиент не найден
 */
function ensureQrToken(clientId) {
    const row = db.prepare('SELECT qr_token FROM clients WHERE id = ?').get(clientId);
    if (!row) return null;
    if (row.qr_token) return row.qr_token;

    const token = crypto.randomBytes(8).toString('hex'); // 16 символов
    try {
        db.prepare('UPDATE clients SET qr_token = ? WHERE id = ? AND qr_token IS NULL')
            .run(token, clientId);
        return db.prepare('SELECT qr_token FROM clients WHERE id = ?').get(clientId).qr_token;
    } catch {
        // Коллизия (практически исключена) — пробуем ещё раз
        return ensureQrToken(clientId);
    }
}

/** Клиент по токену (для публичных страниц). */
function getClientByToken(token) {
    return db.prepare('SELECT * FROM clients WHERE qr_token = ?').get(token) || null;
}

module.exports = { ensureQrToken, getClientByToken };
