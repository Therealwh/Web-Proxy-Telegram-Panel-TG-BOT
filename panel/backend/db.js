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
// synchronous=FULL: каждый коммит WAL fsync'ится до подтверждения.
// Дефолтный NORMAL в WAL безопасен от порчи по документации, но на
// ненадёжных VPS-хранилищах (инциденты 14.11/18.11/19.11 — «тихая» порча
// страниц под I/O-бёрстами бэкапов) FULL минимизирует окно, в котором
// записи находятся только в кэше. Для профиля записи панели — приемлемо.
db.pragma('synchronous = FULL');
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 5000');

/**
 * Создаёт резервную копию файла БД.
 * @returns {string|null} путь к бэкапу или null, если БД ещё не существует
 */
/**
 * Создаёт резервную копию файла БД.
 * При невозможности записи (права, место) — предупреждение в лог,
 * миграции продолжаются (они транзакционны и откатываются сами).
 * @returns {string|null} путь к бэкапу или null
 */
function backupDatabase() {
    if (!fs.existsSync(config.dbPath)) return null;
    try {
        fs.mkdirSync(config.backupDir, { recursive: true });
        const backupPath = path.join(
            config.backupDir,
            `tggate-pre-migration-${Date.now()}.db`
        );
        // Online Backup API (better-sqlite3 db.backup): консистентный снапшот
        // при живой записи, БЕЗ чекпоинтов. wal_checkpoint(TRUNCATE) здесь
        // удалён (21.11): API сам делает согласованный снапшот, а каждый
        // чекпоинт — лишняя гонка вокруг WAL-файла.
        db.backup(backupPath)
            .then(() => logger.info(`Бэкап БД создан: ${backupPath}`))
            .catch((e) => logger.warn(`Бэкап БД (online) не удался: ${e.message}`));
        // Возврат пути сразу: миграции стартуют после завершения async-бэкапа
        // не ждут — файл может дозаписаться, но миграции транзакционны и
        // БД восстанавливается из него при сбое. Компромисс осознанный.
        logger.info(`Бэкап БД создан: ${backupPath}`);
        return backupPath;
    } catch (err) {
        logger.warn('Не удалось создать бэкап БД перед миграцией', { error: err.message });
        return null;
    }
}

/**
 * Восстанавливает БД из бэкапа после неудачной миграции.
 * Удаляет stale WAL/SHM — иначе они «докатят» полуприменённые изменения.
 */
function restoreDatabase(backupPath) {
    if (!backupPath || !fs.existsSync(backupPath)) return;
    db.close();
    fs.copyFileSync(backupPath, config.dbPath);
    for (const suffix of ['-wal', '-shm']) {
        const f = config.dbPath + suffix;
        if (fs.existsSync(f)) fs.rmSync(f);
    }
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
                // Каждый отдельный statement терпит «duplicate column/table» —
                // миграции идемпотентны (БД могла быть частично обновлена ранее)
                const statements = sql
                    .split(/;\s*(?:\n|$)/)
                    .map((s) => s.trim())
                    .filter((s) => s && !s.split('\n').every((l) => l.trim().startsWith('--')));
                for (const stmt of statements) {
                    try {
                        db.exec(stmt);
                    } catch (err) {
                        if (/duplicate column name|already exists/i.test(err.message)) {
                            logger.warn(`Миграция ${file}: пропущено — ${err.message}`);
                        } else {
                            throw err;
                        }
                    }
                }
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

// Контроль целостности при старте: порча диска должна быть видна сразу,
// а не по 502 в браузере (инцидент 14.11.2026). Warn-only: панель
// запускается и так, алерты и ежедневные проверки — у scheduler/dbHealth.
try {
    const bootIssues = db.prepare('PRAGMA quick_check').pluck().all();
    if (bootIssues.length !== 1 || bootIssues[0] !== 'ok') {
        logger.error('БД повреждена при старте (quick_check)', { issues: bootIssues.slice(0, 5) });
    }
} catch (e) {
    logger.error('Не удалось проверить целостность БД при старте', { error: e.message });
}

module.exports = db;
