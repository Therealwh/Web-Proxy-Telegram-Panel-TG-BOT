/**
 * @fileoverview Защита БД: проверка целостности живой базы и автобэкапов,
 * алерты админу. Родился из инцидента 14.11.2026: страница SQLite повредилась
 * на диске, крэш-луп панели дал 502 на всё, а автобэкапы той ночью копировали
 * уже повреждённый файл. Теперь: ежедневный integrity_check живой БД (04:10),
 * верификация свежего автобэкапа сразу после копирования, алерты в Telegram
 * и ленту событий при первых признаках порчи.
 * @module services/dbHealth
 */

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const db = require('../db');
const config = require('../config');
const logger = require('../utils/logger');

/**
 * quick_check на переданном соединении.
 * Через pragma() (не prepare): не оставляет JS-обёрток Statement — их
 * отложенный GC-деструктор на Windows может абортнуть процесс.
 * @param {import('better-sqlite3').Database} database
 * @returns {{ok: boolean, issues: string[]}} issues — ['ok'] или список проблем
 */
function checkDatabase(database) {
    const rows = database.pragma('quick_check');
    const issues = rows.map((r) => String(Object.values(r)[0]));
    return { ok: issues.length === 1 && issues[0] === 'ok', issues };
}

/**
 * Проверяет файл бэкапа отдельным read-only соединением (живую БД не трогает).
 * Битый/чужой файл не должен бросать — возвращаем { ok:false, error }.
 * @param {string} filePath
 * @returns {{ok: boolean, file: string, issues?: string[], error?: string}}
 */
function verifyBackupFile(filePath) {
    let database = null;
    try {
        // Быстрый фейл ДО открытия нативного коннекта: у SQLite-файла
        // обязателен магический заголовок. Открытие better-sqlite3 на мусоре
        // оставляет полусозданный нативный объект — известно, что это роняет
        // процесс при завершении (Windows teardown).
        let header = Buffer.alloc(0);
        try {
            const fd = fs.openSync(filePath, 'r');
            header = Buffer.alloc(16);
            const read = fs.readSync(fd, header, 0, 16, 0);
            fs.closeSync(fd);
            header = header.subarray(0, read);
        } catch { /* ошибка чтения обработается ниже как error */ }
        if (!header.toString('latin1').startsWith('SQLite format 3')) {
            return { ok: false, file: filePath, error: 'not a SQLite database (bad header)' };
        }
        database = new Database(filePath, { readonly: true, fileMustExist: true });
        const { ok, issues } = checkDatabase(database);
        return { ok, file: filePath, issues };
    } catch (e) {
        return { ok: false, file: filePath, error: e.message };
    } finally {
        try { database?.close(); } catch { /* уже закрыт */ }
    }
}

/**
 * Самый свежий автобэкап в каталоге (auto-YYYY-MM-DD.db).
 * @param {string} [dir] - по умолчанию config.backupDir
 * @returns {string|null} путь или null, если автобэкапов нет
 */
function findLatestBackup(dir = config.backupDir) {
    try {
        const files = fs.readdirSync(dir)
            .filter((f) => /^auto-\d{4}-\d{2}-\d{2}\.db$/.test(f))
            .sort()
            .reverse();
        return files.length ? path.join(dir, files[0]) : null;
    } catch {
        return null; // каталога нет — автобэкапы не включены
    }
}

/**
 * Ежедневная проверка: integrity_check живой БД + верификация свежего
 * автобэкапа. НИКОГДА не бросает и не роняет панель — сбой самой проверки
 * пишется в лог. Алерты: TG админу + лента событий только при проблемах;
 * раз в день — информационное событие «всё чисто» (видно, что контроль жив).
 * @returns {Promise<{ok: boolean, issues?: string[], backup?: object}>}
 */
async function runDailyCheck() {
    try {
        const started = Date.now();
        // integrity_check на живой БД блокирует event loop на время проверки —
        // поэтому запуск один раз в сутки ночью (04:10), не на каждый чих.
        // pragma() — без JS-обёрток Statement (см. checkDatabase).
        const issues = db.pragma('integrity_check').map((r) => String(Object.values(r)[0]));
        const liveOk = issues.length === 1 && issues[0] === 'ok';
        const durationMs = Date.now() - started;

        const backup = verifyLatestBackup();

        if (!liveOk) {
            const detail = issues.slice(0, 5).join('\n');
            logger.error('Проверка целостности БД: ПОВРЕЖДЕНИЯ', { issues: issues.length, durationMs });
            eventAlert(`🚨 <b>Проверка БД: обнаружены повреждения!</b>\n\n` +
                `<code>${escapeHtml(detail)}</code>\n\n` +
                `Не выключайте сервер. Панель может работать частично.\n` +
                `Восстановление: последний чистый автобэкап или <code>sqlite3 .recover</code>.\n` +
                `Проверка заняла ${durationMs} мс.`);
            return { ok: false, issues, backup };
        }

        logger.info('Проверка целостности БД: ok', { durationMs, backup: backup.ok });
        const backupLine = backup.file
            ? `бэкап: ${path.basename(backup.file)} — ${backup.ok ? 'цел' : 'ПОВРЕЖДЁН'}`
            : 'автобэкапы не найдены — включите «Бэкап БД» в настройках';
        eventLogSafe('dbcheck', '🩺 Проверка БД: всё чисто',
            `integrity_check ok (${durationMs} мс) · ${backupLine}`);
        return { ok: true, issues, backup };
    } catch (e) {
        // Сам контроль не должен становиться источником инцидента,
        // но сбой проверки — тоже повод для тревоги (worst-case I/O)
        logger.error('Проверка БД не удалась', { error: e.message });
        try {
            eventAlert(`⚠️ <b>Проверка БД не смогла выполниться</b>: ${escapeHtml(e.message)}`);
        } catch { /* алерт не критичен */ }
        return { ok: false, issues: [`check failed: ${e.message}`] };
    }
}

/**
 * Верифицирует самый свежий автобэкап. TG-алерт — ТОЛЬКО если файл есть,
 * но повреждён (нет бэкапов — не спамим, это видно в дневном событии).
 * @returns {{ok: boolean, file?: string, issues?: string[], error?: string}}
 */
function verifyLatestBackup() {
    try {
        const file = findLatestBackup();
        if (!file) return { ok: false, error: 'no backups' };
        const result = verifyBackupFile(file);
        if (!result.ok) {
            logger.error('Свежий автобэкап повреждён', { file, error: result.error || result.issues });
            eventAlert(`⚠️ <b>Свежий автобэкап повреждён!</b>\n\n` +
                `Файл: <code>${escapeHtml(path.basename(file))}</code>\n` +
                `${escapeHtml(result.error || (result.issues || []).slice(0, 3).join('; '))}\n\n` +
                `Не удаляйте его. Проверьте предыдущие автобэкапы и диск сервера.`);
        }
        return result;
    } catch (e) {
        logger.warn('Верификация бэкапа не удалась', { error: e.message });
        return { ok: false, error: e.message };
    }
}

/** Алерт админу (тихо, если TG не настроен) + запись в ленту событий. */
function eventAlert(text) {
    try {
        eventLogSafe('error', '⚠️ Проблема с базой данных', text.replace(/<[^>]*>/g, ''), 'error');
    } catch { /* события не критичны */ }
    try {
        const { notifyAdmin } = require('./notifier');
        const { getAll } = require('../routes/settings');
        notifyAdmin(getAll(), text).catch(() => {});
    } catch { /* уведомления не критичны */ }
}

// ═══ Канарка: быстрый quick_check каждые 15 минут на отдельном readonly-соединении ═══
// Задача — поймать МОМЕНТ порчи с точностью до минут (инциденты 14.11 и 18.11
// были известны только с точностью до суток). Читатель WAL не блокирует запись.
let canaryTimer = null;
let canaryAlerted = false; // алерт — один раз на эпизод порчи, не спамим

function canaryTick() {
    try {
        const ro = new Database(config.dbPath, { readonly: true, fileMustExist: true });
        const issues = ro.pragma('quick_check').map((r) => String(Object.values(r)[0]));
        ro.close();
        const ok = issues.length === 1 && issues[0] === 'ok';
        if (ok) {
            if (canaryAlerted) {
                logger.info('Канарка: БД снова чиста (после восстановления)');
                canaryAlerted = false;
            }
            return;
        }
        const at = new Date().toISOString();
        logger.error('Канарка: БД повреждена', { at, issues: issues.slice(0, 3) });
        if (!canaryAlerted) {
            canaryAlerted = true;
            eventAlert(`🚨 <b>Канарка: БД повреждена!</b>\n\nМомент фиксации: <code>${escapeHtml(at)}</code>\n` +
                `<code>${escapeHtml(issues.slice(0, 3).join('\n'))}</code>\n\n` +
                `Проверь логи панели за это время и события хоста.`);
        }
    } catch (e) {
        logger.warn('Канарка: проверка не удалась', { error: e.message });
    }
}

/**
 * Запускает канарку (раз в 15 минут). Вызывается из scheduler.start().
 */
function startCanary() {
    if (canaryTimer) return;
    canaryTimer = setInterval(canaryTick, 15 * 60 * 1000);
    canaryTimer.unref();
    logger.info('Канарка БД запущена (quick_check каждые 15 мин)');
}

/** Событие в ленту (падение не критично). */
function eventLogSafe(event, title, details, level = 'info') {
    try {
        require('./eventLog').logEvent(event, title, details, level);
    } catch { /* не критично */ }
}

/** EscapeHtml для вставки пользовательских/системных строк в HTML-алерты. */
function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, (ch) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[ch]));
}

module.exports = {
    checkDatabase,
    verifyBackupFile,
    findLatestBackup,
    verifyLatestBackup,
    runDailyCheck,
    startCanary,
};
