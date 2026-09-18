/**
 * @fileoverview Подключение к SQLite (better-sqlite3) и система миграций.
 *
 * Миграции — SQL-файлы вида NNN_name.sql в каталоге migrations/.
 * Применённые версии хранятся в таблице schema_version.
 * Перед применением новых миграций автоматически создаётся бэкап БД;
 * при ошибке миграции БД восстанавливается из бэкапа.
 * @module db
 */

const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');
const config = require('./config');
const logger = require('./utils/logger');

// Создаём каталог данных
fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });

/** @type {Database.Database} */
const db = new Database(config.dbPath);

// Прагмы для надёжности и производительности
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 5000');

/**
 * Создаёт резервную копию файла БД.
 * @returns {string|null} путь к бэкапу или null, если БД ещё не существует
 */
function backupDatabase() {
    if (!fs.existsSync(config.dbPath)) return null;
    fs.mkdirSync(config.backupDir, { recursive: true });
    const backupPath = path.join(
        config.backupDir,
        `tggate-pre-migration-${Date.now()}.db`
    );
    // Сбрасываем WAL в основной файл и копируем синхронно
    db.pragma('wal_checkpoint(TRUNCATE)');
    fs.copyFileSync(config.dbPath, backupPath);
    logger.info(`Бэкап БД создан: ${backupPath}`);
    return backupPath;
}

/**
 * Восстанавливает БД из бэкапа после неудачной миграции.
 * @param {string|null} backupPath - путь к бэкапу
 */
function restoreDatabase(backupPath) {
    if (!backupPath || !fs.existsSync(backupPath)) return;
    db.close();
    fs.copyFileSync(backupPath, config.dbPath);
    logger.error(`БД восстановлена из бэкапа ${backupPath} после ошибки миграции`);
}

/**
 * Применяет все неприменённые миграции из каталога migrations/.
 * Каждая миграция выполняется в транзакции. При любой ошибке —
 * восстановление БД из предварительного бэкапа и остановка приложения.
 */
function runMigrations() {
    const migrationsDir = path.join(__dirname, 'migrations');
    if (!fs.existsSync(migrationsDir)) {
        logger.warn('Каталог миграций не найден, пропускаю');
        return;
    }

    // Таблица версий схемы
    db.exec(`CREATE TABLE IF NOT EXISTS schema_version (
        version INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`);

    const currentVersion =
        db.prepare('SELECT COALESCE(MAX(version), 0) AS v FROM schema_version').get().v;

    const files = fs
        .readdirSync(migrationsDir)
        .filter((f) => /^\d+_.+\.sql$/.test(f))
        .sort();

    const pending = files.filter((f) => parseInt(f.split('_')[0], 10) > currentVersion);
    if (pending.length === 0) {
        logger.info(`Схема БД актуальна (версия ${currentVersion})`);
        return;
    }

    logger.info(`Найдено новых миграций: ${pending.length}. Создаю бэкап...`);
    const backupPath = backupDatabase();

    try {
        for (const file of pending) {
            const version = parseInt(file.split('_')[0], 10);
            const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
            logger.info(`Применяю миграцию ${file}...`);
            db.transaction(() => {
                db.exec(sql);
                db.prepare('INSERT INTO schema_version (version) VALUES (?)').run(version);
            })();
            logger.info(`Миграция ${file} применена`);
        }
        logger.info(`Схема БД обновлена до версии ${pending.length ? parseInt(pending[pending.length - 1], 10) : currentVersion}`);
    } catch (err) {
        logger.error('Ошибка миграции БД', { error: err.message });
        restoreDatabase(backupPath);
        throw new Error(`Миграция БД не удалась: ${err.message}. БД восстановлена из бэкапа.`);
    }
}

runMigrations();

module.exports = db;
