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

/**
 * Атомарно списывает сумму, распределяя её по строкам клиента (от большего
 * остатка). Каждый UPDATE требует достаточного остатка на конкретной строке —
 * гонка двойного списания и уход в минус исключены. Работает и когда баланс
 * размазан по нескольким прокси (сумма ≥ любого отдельного остатка).
 * @param {number} telegramId
 * @param {number} amount - положительная сумма
 * @returns {{ ok: boolean, touched: Array<{id: number, amount: number}>, left: number }}
 *          touched — затронутые строки для точного возврата при сбое выдачи.
 */
function deductBalanceSpread(telegramId, amount) {
    if (!(amount > 0)) return { ok: false, touched: [], left: amount };
    let left = amount;
    const touched = [];
    // Транзакция: если суммы не хватает на все строки — полный откат,
    // частичное списание без выдачи доступа исключено.
    const spread = db.transaction(() => {
        const upd = db.prepare('UPDATE clients SET balance = balance - ? WHERE id = ? AND balance >= ?');
        for (let pass = 0; pass < 2 && left > 0; pass++) {
            const rows = db.prepare(
                'SELECT id, balance FROM clients WHERE telegram_id = ? AND balance > 0 ORDER BY balance DESC'
            ).all(telegramId);
            for (const row of rows) {
                if (left <= 0) break;
                const take = Math.min(row.balance, left);
                const result = upd.run(take, row.id, take);
                if (result.changes === 0) continue; // строка изменилась — повторный проход подхватит
                touched.push({ id: row.id, amount: take });
                left -= take;
            }
        }
        if (left > 0) throw new Error('INSUFFICIENT_TOTAL_BALANCE');
    });
    try {
        spread();
    } catch (e) {
        if (e.message !== 'INSUFFICIENT_TOTAL_BALANCE') throw e;
        return { ok: false, touched: [], left: amount };
    }
    return { ok: true, touched, left: 0 };
}

module.exports = { deductBalanceAtomic, deductBalanceSpread, totalBalance, creditBalance };
