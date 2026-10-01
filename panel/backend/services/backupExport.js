/**
 * @fileoverview Экспорт базы панели в переносимый JSON (используется
 * и кнопкой «Скачать бэкап», и бэкапом в Telegram — форматы совпадают,
 * восстановление в один клик через /api/backup/restore).
 * @module services/backupExport
 */

const db = require('../db');

// Порядок важен: сначала независимые таблицы (для FK при восстановлении)
const TABLES = [
    'ticket_messages', 'tickets', 'payments', 'referral_pending', 'clients',
    'api_keys', 'webhooks', 'promo_codes', 'tariffs', 'admins', 'settings',
];

/** Полный дамп базы в переносимом JSON-формате. */
function buildDump() {
    const dump = { _tggate_backup: true, exported_at: new Date().toISOString(), data: {} };
    for (const table of TABLES) {
        dump.data[table] = db.prepare(`SELECT * FROM ${table}`).all();
    }
    return dump;
}

module.exports = { TABLES, buildDump };
