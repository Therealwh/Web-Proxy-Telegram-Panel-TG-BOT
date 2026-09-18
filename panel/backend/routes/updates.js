/**
 * @fileoverview Управление вебхуками из панели + система обновлений
 * (статус версий, запуск скриптов обновления, история).
 * @module routes/updates
 */

const express = require('express');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { z } = require('zod');
const db = require('../db');
const config = require('../config');
const { httpError } = require('../middleware/errorHandler');
const { getAll } = require('./settings');
const logger = require('../utils/logger');

const router = express.Router();

const VERSIONS_FILE = '/etc/tggate/versions.json';
const SCRIPTS_DIR = path.join(__dirname, '..', '..', '..', 'scripts');

/** Читает /etc/tggate/versions.json, если есть. */
function readVersions() {
    try {
        return JSON.parse(fs.readFileSync(VERSIONS_FILE, 'utf8'));
    } catch {
        return { panel: { current: null, latest: null }, telemt: { current: null, latest: null }, ssl: {} };
    }
}

// --- Статус обновлений ---
router.get('/status', (req, res) => {
    const versions = readVersions();
    const settings = getAll();
    res.json({
        panel: versions.panel || {},
        telemt: versions.telemt || {},
        ssl: versions.ssl || {},
        last_check: versions.panel?.last_check || null,
        settings: {
            auto_check: settings.updates_auto_check,
            frequency: settings.updates_frequency,
            channel: settings.updates_channel,
            auto_install: settings.updates_auto_install,
        },
    });
});

// --- История обновлений ---
router.get('/history', (req, res) => {
    const history = db.prepare('SELECT * FROM updates_log ORDER BY created_at DESC LIMIT 50').all();
    res.json({ history });
});

/**
 * Запускает bash-скрипт обновления и пишет результат в updates_log.
 * @param {string} script - имя скрипта в scripts/
 * @param {string} component - panel | telemt
 * @param {import('express').Response} res
 */
function runUpdateScript(script, component, res) {
    const scriptPath = path.join(SCRIPTS_DIR, script);
    if (!fs.existsSync(scriptPath)) throw httpError(404, `Скрипт ${script} не найден`);

    const proc = execFile('bash', [scriptPath], { timeout: 600000 }, (error, stdout, stderr) => {
        const status = error ? 'failed' : 'success';
        db.prepare(
            'INSERT INTO updates_log (component, from_version, to_version, status, log) VALUES (?, ?, ?, ?, ?)'
        ).run(component, null, null, status, (stdout + '\n' + stderr).slice(0, 10000));
        logger.info(`Обновление ${component}: ${status}`);
    });

    res.json({ ok: true, message: 'Обновление запущено. Это займёт 1-2 минуты.' });
}

// --- Запустить обновления ---
router.post('/check', (req, res, next) => {
    try {
        runUpdateScript('check-updates.sh', 'check', res);
    } catch (err) { next(err); }
});

router.post('/panel', (req, res, next) => {
    try {
        runUpdateScript('update-panel.sh', 'panel', res);
    } catch (err) { next(err); }
});

router.post('/telemt', (req, res, next) => {
    try {
        runUpdateScript('update-telemt.sh', 'telemt', res);
    } catch (err) { next(err); }
});

// --- Настройки обновлений ---
router.put('/settings', (req, res, next) => {
    try {
        const schema = z.object({
            auto_check: z.boolean(),
            frequency: z.enum(['hourly', 'daily', 'weekly', 'monthly']),
            channel: z.enum(['stable', 'beta', 'latest']),
            auto_install: z.boolean(),
        });
        const data = schema.parse(req.body);

        const upsert = db.prepare(
            'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
        );
        db.transaction(() => {
            upsert.run('updates_auto_check', JSON.stringify(data.auto_check));
            upsert.run('updates_frequency', JSON.stringify(data.frequency));
            upsert.run('updates_channel', JSON.stringify(data.channel));
            upsert.run('updates_auto_install', JSON.stringify(data.auto_install));
        })();

        // Обновляем cron-задачу под новую частоту
        const cronMap = {
            hourly: '0 * * * *',
            daily: '0 4 * * *',
            weekly: '0 4 * * 1',
            monthly: '0 4 1 * *',
        };
        try {
            if (data.auto_check) {
                fs.writeFileSync('/etc/cron.d/tggate-updates',
                    `${cronMap[data.frequency]} root /usr/local/bin/tggate-check-updates >/dev/null 2>&1\n`);
            } else {
                fs.rmSync('/etc/cron.d/tggate-updates', { force: true });
            }
        } catch (err) {
            logger.warn('Не удалось обновить cron-задачу', { error: err.message });
        }

        res.json({ ok: true });
    } catch (err) { next(err); }
});

module.exports = router;
