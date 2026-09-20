/**
 * @fileoverview Резервное копирование и восстановление данных панели.
 * Экспорт: JSON со всеми данными (админы, клиенты, тарифы, платежи,
 * настройки, промо, API-ключи, вебхуки, тикеты, рефералы).
 * Импорт: загрузка файла, замена данных в транзакции.
 * @module routes/backup
 */

const express = require('express');
const db = require('../db');
const logger = require('../utils/logger');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

// Таблицы для переноса (порядок важен для FK при удалении/вставке)
const TABLES = [
    'ticket_messages', 'tickets', 'payments', 'referral_pending', 'clients',
    'api_keys', 'webhooks', 'promo_codes', 'tariffs', 'admins', 'settings',
];

/**
 * Экспорт: JSON-файл со всеми данными.
 */
router.get('/export', requireAuth, (req, res) => {
    const dump = { _tggate_backup: true, exported_at: new Date().toISOString(), data: {} };
    for (const table of TABLES) {
        dump.data[table] = db.prepare(`SELECT * FROM ${table}`).all();
    }
    const filename = `tggate-backup-${new Date().toISOString().slice(0, 10)}.json`;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    logger.info('Экспорт бэкапа', { tables: TABLES.length, by: req.admin?.login });
    res.send(JSON.stringify(dump));
});

/**
 * Восстановление из JSON-бэкапа. Заменяет ВСЕ данные перечисленных таблиц.
 */
router.post('/restore', requireAuth, (req, res, next) => {
    try {
        const body = req.body;
        if (!body || body._tggate_backup !== true || typeof body.data !== 'object') {
            return res.status(400).json({ error: 'Это не файл бэкапа TGGATE' });
        }
        const data = body.data;

        db.pragma('foreign_keys = OFF');
        db.transaction(() => {
            // Очищаем в порядке зависимостей (дети → родители)
            for (const table of [...TABLES].reverse()) {
                db.prepare(`DELETE FROM ${table}`).run();
            }
            // Вставляем данные
            for (const table of TABLES) {
                const rows = data[table];
                if (!Array.isArray(rows) || rows.length === 0) continue;
                const cols = Object.keys(rows[0]);
                const placeholders = cols.map(() => '?').join(', ');
                const insert = db.prepare(
                    `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${placeholders})`
                );
                for (const row of rows) {
                    insert.run(...cols.map((c) => row[c] ?? null));
                }
            }
        })();
        db.pragma('foreign_keys = ON');

        logger.info('Бэкап восстановлен', { by: req.admin?.login, tables: TABLES.length });
        res.json({ ok: true, message: 'Данные восстановлены. Обновите страницу (F5).' });
    } catch (err) {
        logger.error('Ошибка восстановления бэкапа', { error: err.message });
        next(err);
    }
});

module.exports = router;
