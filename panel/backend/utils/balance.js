/**
 * @fileoverview Атомарные операции с балансом клиентов.
 * Вынесено из services/bot.js для тестируемости (скилл grammy-bot-audit §3).
 * @module utils/balance
 */

const db = require('../db');

/**
 * Атомарно списывает сумму с баланса клиента, только если денег хватает.
 * Устраняет race condition двойного списания (M5): условие в самом UPDATE.
 * @param {number} telegramId - telegram_id клиента
 * @param {number} amount - сумма списания (положительная)
 * @returns {boolean} true — списано; false — недостаточно средств / клиент не найден
 */
function deductBalanceAtomic(telegramId, amount) {
    if (!(amount > 0)) return false;
    const result = db.prepare(
        'UPDATE clients SET balance = balance - ? WHERE telegram_id = ? AND balance >= ?'
    ).run(amount, telegramId, amount);
    return result.changes === 1;
}

/**
 * Возвращает суммарный баланс клиента по всем его прокси.
 * @param {number} telegramId
 * @returns {number}
 */
function totalBalance(telegramId) {
    const row = db.prepare(
        'SELECT COALESCE(SUM(balance), 0) AS total FROM clients WHERE telegram_id = ?'
    ).get(telegramId);
    return row ? row.total : 0;
}

/**
 * Начисляет сумму на баланс первого клиента с данным telegram_id.
 * @param {number} telegramId
 * @param {number} amount
 * @returns {boolean} true — начислено
 */
function creditBalance(telegramId, amount) {
    if (!(amount > 0)) return false;
    const result = db.prepare(
        'UPDATE clients SET balance = balance + ? WHERE id = (SELECT id FROM clients WHERE telegram_id = ? LIMIT 1)'
    ).run(amount, telegramId);
    return result.changes === 1;
}

module.exports = { deductBalanceAtomic, totalBalance, creditBalance };
