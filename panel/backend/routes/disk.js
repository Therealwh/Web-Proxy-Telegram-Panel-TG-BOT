/**
 * Диск: занято/свободно и очистка мусора.
 *
 * Панель работает от пользователя tggate и не может ни читать системные
 * логи, ни запускать journalctl — обе операции идут через root-хелпер.
 * Статистика файла БД читается напрямую, панель его владелец.
 * @module routes/disk
 */

const express = require('express');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const config = require('../config');
const logger = require('../utils/logger');
const { httpError } = require('../middleware/errorHandler');

const router = express.Router();

/** Размер каталога рекурсивно (быстрая оценка: без захода в симлинки). */
function dirSize(dir, depth = 0) {
    if (depth > 6) return 0;
    let total = 0;
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return 0; }
    for (const e of entries) {
        const full = path.join(dir, e.name);
        try {
            if (e.isDirectory()) total += dirSize(full, depth + 1);
            else if (e.isFile()) total += fs.statSync(full).size;
        } catch { /* нет доступа — пропускаем */ }
    }
    return total;
}

/** Человекочитаемый размер. */
function human(bytes) {
    const units = ['Б', 'КБ', 'МБ', 'ГБ', 'ТБ'];
    let v = bytes, u = 0;
    while (v >= 1024 && u < units.length - 1) { v /= 1024; u += 1; }
    return `${v.toFixed(v >= 100 || u === 0 ? 0 : 1)} ${units[u]}`;
}

/** Обёртка над хелпером: запуск root-скрипта по ключу. */
async function runHelper(key, timeoutMs = 300000) {
    if (!config.helperUrl || !config.helperSecret) {
        throw httpError(500, 'Хелпер не настроен. Выполните на сервере: bash /opt/tggate/scripts/install-helper.sh');
    }
    const r = await fetch(`${config.helperUrl}/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ secret: config.helperSecret, key }),
        signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await r.text();
    if (!r.ok) {
        let msg = `Хелпер: HTTP ${r.status}`;
        try { msg = JSON.parse(text).error || msg; } catch { /* текст не JSON */ }
        throw httpError(r.status === 403 ? 502 : r.status, msg);
    }
    return text;
}

// --- Статистика диска ---
router.get('/stats', async (req, res, next) => {
    try {
        const out = { db: {}, website: {}, backups: {}, logs: {}, system: null };

        // БД и сайт — прямым доступом
        try {
            const dbPath = config.dbPath || path.join(config.dataDir, 'tggate.db');
            if (fs.existsSync(dbPath)) {
                let bytes = fs.statSync(dbPath).size;
                for (const suf of ['-wal', '-shm']) {
                    const f = dbPath + suf;
                    if (fs.existsSync(f)) bytes += fs.statSync(f).size;
                }
                out.db = { path: dbPath, bytes, human: human(bytes) };
            }
        } catch { /* нет доступа */ }

        if (config.websiteDir) {
            const bytes = dirSize(config.websiteDir);
            out.website = { path: config.websiteDir, bytes, human: human(bytes) };
        }

        const backupsDir = '/var/backups/tggate';
        if (fs.existsSync(backupsDir)) {
            const bytes = dirSize(backupsDir);
            let count = 0;
            try { count = fs.readdirSync(backupsDir).length; } catch { /* пусто */ }
            out.backups = { path: backupsDir, bytes, human: human(bytes), count };
        }

        const logsDir = '/var/log';
        // journalctl требует root — статистику системного журнала отдаёт хелпер
        try {
            const r = await fetch(`${config.helperUrl}/run`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ secret: config.helperSecret, key: 'disk-stats' }),
                signal: AbortSignal.timeout(15000),
            });
            if (r.ok) {
                const data = await r.json();
                out.system = data.system || null;
                out.logs = data.logs || out.logs;
            }
        } catch { /* хелпер недоступен — отдаём что есть */ }

        // Сводка: суммарно панельными данными занято
        const own = (out.db.bytes || 0) + (out.website.bytes || 0) + (out.backups.bytes || 0);
        out.own = { bytes: own, human: human(own) };

        res.json(out);
    } catch (err) {
        next(err);
    }
});

// --- Очистка места ---
router.post('/cleanup', async (req, res, next) => {
    try {
        logger.info('Очистка диска запущена из панели');
        const output = await runHelper('cleanup', 300000);
        const dfLine = (output.match(/\/dev\/\S+\s+\S+\s+\S+\s+\S+\s+\d+%\s+\/\s*$/m) || [''])[0];
        res.json({
            ok: true,
            message: 'Очистка выполнена: журнал, старые логи подключений, бэкапы, кеш.',
            disk: dfLine || null,
            output: output.split('\n').slice(-8).join('\n'),
        });
    } catch (err) {
        logger.warn('Очистка диска не удалась', { error: err.message });
        next(err);
    }
});

module.exports = router;