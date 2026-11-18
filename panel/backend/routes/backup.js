/**
 * @fileoverview Резервное копирование и восстановление данных панели.
 * Экспорт: JSON со всеми данными (админы, клиенты, тарифы, платежи,
 * настройки, промо, API-ключи, вебхуки, тикеты, рефералы).
 * Импорт: загрузка файла, замена данных в транзакции.
 * @module routes/backup
 */

const express = require('express');
const fs = require('fs');
const path = require('path');
const db = require('../db');
const logger = require('../utils/logger');
const { requireAuth } = require('../middleware/auth');
const { TABLES, buildDump } = require('../services/backupExport');
const config = require('../config');

const router = express.Router();

// Каталог полных бэкапов (создаётся root-скриптом full-backup.sh)
const FULL_DIR = '/var/backups/tggate/full';
// Строгий шаблон имени: защита от path traversal
const FULL_NAME_RE = /^full-\d{4}-\d{2}-\d{2}-\d{6}\.tar\.gz$/;

/**
 * Список полных бэкапов из /var/backups/tggate/full (+ метаданные из .json).
 */
router.get('/full', requireAuth, (req, res) => {
    try {
        let entries = [];
        if (fs.existsSync(FULL_DIR)) {
            entries = fs.readdirSync(FULL_DIR)
                .filter((f) => FULL_NAME_RE.test(f))
                .map((f) => {
                    const full = path.join(FULL_DIR, f);
                    const st = fs.statSync(full);
                    let verified = false;
                    let date = st.mtime.toISOString();
                    try {
                        const meta = JSON.parse(fs.readFileSync(full + '.json', 'utf8'));
                        verified = meta.verified === true;
                        if (meta.date) date = meta.date;
                    } catch { /* метаданных нет — берём mtime */ }
                    return { file: f, size: st.size, verified, date };
                })
                .sort((a, b) => (a.date < b.date ? 1 : -1));
        }
        res.json({ backups: entries });
    } catch (err) {
        logger.error('Список полных бэкапов не удался', { error: err.message });
        res.status(500).json({ error: 'Не удалось получить список' });
    }
});

// Флаг выполняющегося полного бэкапа: защита от двойного запуска
// (два админа/вкладки) — два параллельных tar недопустимы
let fullBackupInFlight = false;

/**
 * Создать полный бэкап сейчас: через root-хелпер запускает
 * scripts/full-backup.sh (сборка + верификация + ротация).
 */
router.post('/full/create', requireAuth, async (req, res, next) => {
    if (!config.helperUrl || !config.helperSecret) {
        return res.status(503).json({ error: 'Хелпер не настроен на этом сервере' });
    }
    if (fullBackupInFlight) {
        return res.status(409).json({ error: 'Полный бэкап уже выполняется — подождите' });
    }
    fullBackupInFlight = true;
    try {
        const response = await fetch(`${config.helperUrl}/run`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ secret: config.helperSecret, key: 'full-backup' }),
            signal: AbortSignal.timeout(150000),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || !data.ok) {
            logger.error('Полный бэкап не удался', { status: response.status, error: data.error });
            return res.status(500).json({ error: data.error || 'Полный бэкап не удался' });
        }
        logger.info('Полный бэкап создан', { file: data.file, size: data.size, by: req.admin?.login });
        res.json(data);
    } catch (err) {
        if (err.name === 'AbortError') {
            return res.status(504).json({ error: 'Хелпер не ответил за 150 секунд' });
        }
        logger.error('Полный бэкап: ошибка вызова хелпера', { error: err.message });
        next(err);
    } finally {
        fullBackupInFlight = false;
    }
});

/**
 * Скачивание полного бэкапа. Имя файла строго по шаблону — path traversal исключён.
 */
router.get('/full/:file/download', requireAuth, (req, res) => {
    const name = String(req.params.file);
    if (!FULL_NAME_RE.test(name)) {
        return res.status(400).json({ error: 'Некорректное имя файла' });
    }
    const full = path.join(FULL_DIR, name);
    if (!fs.existsSync(full)) {
        return res.status(404).json({ error: 'Файл не найден' });
    }
    logger.info('Полный бэкап скачан', { file: name, by: req.admin?.login });
    res.setHeader('Content-Type', 'application/gzip');
    res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
    // При ошибке чтения (файл удалён ротацией на середине) — обрываем ответ
    // корректно, чтобы клиент получил понятную ошибку, а не зависание
    const stream = fs.createReadStream(full);
    stream.on('error', (e) => {
        logger.error('Ошибка чтения полного бэкапа', { file: name, error: e.message });
        if (!res.headersSent) res.status(500).json({ error: 'Ошибка чтения файла' });
        else res.destroy();
    });
    stream.pipe(res);
});

/**
 * Экспорт: JSON-дамп всех данных панели.
 */
router.get('/export', requireAuth, (req, res) => {
    const dump = buildDump();
    const filename = `tggate-backup-${new Date().toISOString().slice(0, 10)}.json`;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    logger.info('Экспорт базы выполнен', { tables: TABLES.length, by: req.admin?.login });
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
