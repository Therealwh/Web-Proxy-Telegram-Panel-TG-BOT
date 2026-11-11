/**
 * @fileoverview Автоочистка при нехватке места на диске: если свободного места
 * меньше порога (настройка), панель удаляет старые бэкапы (кроме последнего)
 * и старые логи, затем дергает root-хелпер «cleanup» (journal + VACUUM —
 * самое жирное). Запускается планировщиком раз в 10 минут, не чаще раза в час.
 * @module services/autoCleanup
 */

const fs = require('fs');
const path = require('path');
const db = require('../db');
const config = require('../config');
const logger = require('../utils/logger');

let lastRunAt = 0; // не чаще раза в час
const MIN_INTERVAL_MS = 60 * 60 * 1000;

/** Свободно байт на разделе с данными панели. */
function freeBytes() {
    const st = fs.statfsSync(config.dataDir);
    return st.bavail * st.bsize;
}

/**
 * Панельная часть очистки: старые бэкапы (кроме последнего) + старые логи.
 * @returns {{files: number, rows: number}} что удалено
 */
function panelSideCleanup() {
    let files = 0;

    // Бэкапы: auto-*.db — оставляем самый свежий; pre-update-* — тоже самый свежий
    const groups = { 'auto-': [], 'pre-update-': [] };
    try {
        for (const f of fs.readdirSync(config.backupDir)) {
            for (const prefix of Object.keys(groups)) {
                if (f.startsWith(prefix)) {
                    const full = path.join(config.backupDir, f);
                    groups[prefix].push({ full, mtime: fs.statSync(full).mtimeMs });
                }
            }
        }
        for (const prefix of Object.keys(groups)) {
            const items = groups[prefix].sort((a, b) => b.mtime - a.mtime); // свежие сверху
            for (let i = 1; i < items.length; i++) {
                // i=0 — свежий, остальное удаляем
                const isDir = (() => { try { return fs.statSync(items[i].full).isDirectory(); } catch { return false; } })();
                try {
                    if (isDir) fs.rmSync(items[i].full, { recursive: true, force: true });
                    else fs.rmSync(items[i].full, { force: true });
                    files += 1;
                } catch { /* занят — пропускаем */ }
            }
        }
    } catch (e) {
        logger.warn('Автоочистка: бэкапы', { error: e.message });
    }

    // Старые логи подключений (старше 7 суток) — диагностика, не деньги
    let rows = 0;
    try {
        rows = db.prepare(
            "DELETE FROM connection_logs WHERE created_at < datetime('now', '-7 days')"
        ).run().changes;
        rows += db.prepare(
            "DELETE FROM uptime_checks WHERE created_at < datetime('now', '-7 days')"
        ).run().changes;
    } catch (e) {
        logger.warn('Автоочистка: логи БД', { error: e.message });
    }
    return { files, rows };
}

/**
 * Проверяет свободное место и при нехватке чистит.
 * Вызывается планировщиком; вручную можно из настроек.
 * @returns {Promise<{triggered: boolean, freedBytes: number, freeBefore: number}|null>}
 */
async function checkAndCleanup() {
    const { getAll } = require('../routes/settings');
    const settings = getAll();
    if (!settings.auto_cleanup_enabled) return null;

    const thresholdBytes = Math.max(0.1, Number(settings.auto_cleanup_threshold_gb) || 1.5) * 1024 ** 3;

    let freeBefore;
    try {
        freeBefore = freeBytes();
    } catch (e) {
        logger.warn('Автоочистка: не удалось определить свободное место', { error: e.message });
        return null;
    }
    if (freeBefore >= thresholdBytes) return null;
    if (Date.now() - lastRunAt < MIN_INTERVAL_MS) return null;
    lastRunAt = Date.now();

    logger.warn('Автоочистка: свободно меньше порога — начинаю очистку', {
        freeGB: (freeBefore / 1024 ** 3).toFixed(2),
        thresholdGB: Number(settings.auto_cleanup_threshold_gb),
    });

    const { files, rows } = panelSideCleanup();

    // Root-хелпер: journal vacuum + VACUUM БД + кеш apt — самый жирный выигрыш
    let helperOk = false;
    try {
        const helperRun = require('../routes/engineTuning').helperRun;
        const r = await helperRun('cleanup');
        helperOk = !!r?.ok;
    } catch (e) {
        logger.warn('Автоочистка: хелпер cleanup недоступен', { error: e.message });
    }

    let freeAfter = freeBefore;
    try { freeAfter = freeBytes(); } catch { /* игнорируем */ }
    const freedBytes = Math.max(0, freeAfter - freeBefore);

    const details = `Удалено бэкапов: ${files} · строк логов: ${rows}` +
        (helperOk ? ' · journal+VACUUM выполнены' : '') +
        ` · свободно теперь: ${(freeAfter / 1024 ** 3).toFixed(2)} ГБ`;
    logger.warn('Автоочистка завершена', { freedMB: Math.round(freedBytes / 1024 / 1024), details });

    const eventLog = require('./eventLog');
    eventLog.logEvent('cleanup', '🧹 Автоочистка диска', details, 'info', null);

    try {
        const { notifyAdmin } = require('./notifier');
        notifyAdmin(getAll(),
            `🧹 <b>Автоочистка диска</b>\\nСвободно было: <b>${(freeBefore / 1024 ** 3).toFixed(2)} ГБ</b> — ниже порога ${Number(settings.auto_cleanup_threshold_gb)} ГБ.\\nУдалены старые бэкапы (кроме последнего) и логи${helperOk ? ', выполнены journal+VACUUM' : ''}.\\nСвободно теперь: <b>${(freeAfter / 1024 ** 3).toFixed(2)} ГБ</b>`);
    } catch { /* уведомление не критично */ }

    return { triggered: true, freedBytes, freeBefore };
}

module.exports = { checkAndCleanup, freeBytes, panelSideCleanup };
