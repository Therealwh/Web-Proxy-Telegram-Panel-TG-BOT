/**
 * @fileoverview Система обновлений: статус версий (всегда живой), список
 * доступных релизов, обновление панели/Telemt на выбранную версию, история.
 * @module routes/updates
 */

const express = require('express');
const fs = require('fs');
const { execFile } = require('child_process');
const { z } = require('zod');
const db = require('../db');
const { httpError } = require('../middleware/errorHandler');
const { getAll } = require('./settings');
const versionInfo = require('../services/versionInfo');
const logger = require('../utils/logger');

const router = express.Router();

// Обновления выполняются root-скриптами через sudo (NOPASSWD правило
// из install.sh). Скрипты запускаются ПРЯМО из репозитория — копии не устаревают.
const SCRIPTS = {
    check: '/opt/tggate/scripts/check-updates.sh',
    panel: '/opt/tggate/scripts/update-panel.sh',
    telemt: '/opt/tggate/scripts/update-telemt.sh',
};

// --- Статус версий (всегда собирается на месте, versions.json как кэш) ---
router.get('/status', async (req, res, next) => {
    try {
        const status = await versionInfo.getStatus();
        const settings = getAll();
        res.json({
            ...status,
            settings: {
                auto_check: settings.updates_auto_check,
                frequency: settings.updates_frequency,
                channel: settings.updates_channel,
                auto_install: settings.updates_auto_install,
            },
        });
    } catch (err) {
        next(err);
    }
});

// --- Список доступных версий (для выбора в UI) ---
router.get('/available', async (req, res, next) => {
    try {
        const schema = z.object({ component: z.enum(['panel', 'telemt']) });
        const { component } = schema.parse(req.query);
        const releases = await versionInfo.getAvailableReleases(component);
        res.json({ releases });
    } catch (err) {
        next(err);
    }
});

// --- История обновлений ---
router.get('/history', (req, res) => {
    const history = db.prepare('SELECT * FROM updates_log ORDER BY created_at DESC LIMIT 50').all();
    res.json({ history });
});

/**
 * Проверяет, что панель может запустить root-скрипт через sudo.
 */
function assertSudoAccess(script) {
    return new Promise((resolve, reject) => {
        // -n: не спрашивать пароль; -l <script>: проверить право
        execFile('sudo', ['-n', '-l', script], { timeout: 10000 }, (err, stdout) => {
            const out = String(stdout);
            if (!err && out.includes(script) && (out.includes('NOPASSWD') || !/password/i.test(out))) {
                return resolve();
            }
            reject(new Error(
                'sudo-правило не настроено. Выполните на сервере от root: ' +
                "printf 'tggate ALL=(root) NOPASSWD: /opt/tggate/scripts/update-panel.sh\\ntggate ALL=(root) NOPASSWD: /opt/tggate/scripts/update-telemt.sh\\ntggate ALL=(root) NOPASSWD: /opt/tggate/scripts/check-updates.sh\\n' > /etc/sudoers.d/tggate && chmod 440 /etc/sudoers.d/tggate"
            ));
        });
    });
}

/**
 * Запускает root-скрипт обновления через sudo и пишет результат в updates_log.
 * @param {'check'|'panel'|'telemt'} key
 * @param {string|null} targetVersion - конкретная версия (null = последняя)
 * @param {import('express').Response} res
 */
async function runUpdateScript(key, targetVersion, res) {
    const script = SCRIPTS[key];
    if (!fs.existsSync(script)) {
        throw httpError(404, `Скрипт ${script} не найден. Перезапустите установку панели.`);
    }

    // Префлайт: сразу понятная ошибка вместо крестика в истории
    try {
        await assertSudoAccess(script);
    } catch (err) {
        logger.error('Sudo недоступен для обновлений', { error: err.message });
        throw httpError(500, err.message);
    }

    const args = targetVersion ? [targetVersion] : [];
    // Скрипты могут работать до 10 минут (сборка фронтенда)
    execFile('sudo', [script, ...args], { timeout: 600000 }, (error, stdout, stderr) => {
        const status = error ? 'failed' : 'success';
        db.prepare(
            'INSERT INTO updates_log (component, from_version, to_version, status, log) VALUES (?, ?, ?, ?, ?)'
        ).run(key, null, targetVersion || null, status, (stdout + '\n' + stderr).slice(0, 10000));
        logger.info(`Обновление (${key})${targetVersion ? ' до ' + targetVersion : ''}: ${status}`);
    });

    res.json({
        ok: true,
        message: targetVersion
            ? `Обновление до версии ${targetVersion} запущено. Это займёт 1-2 минуты.`
            : 'Обновление запущено. Это займёт 1-2 минуты.',
    });
}

// --- Запустить обновление (опционально на конкретную версию) ---
router.post('/check', async (req, res, next) => {
    try {
        await runUpdateScript('check', null, res);
    } catch (err) { next(err); }
});

router.post('/panel', async (req, res, next) => {
    try {
        const schema = z.object({ version: z.string().regex(/^[0-9a-zA-Z.\-]+$/).max(32).optional() });
        const { version } = schema.parse(req.body || {});
        await runUpdateScript('panel', version || null, res);
    } catch (err) { next(err); }
});

router.post('/telemt', async (req, res, next) => {
    try {
        const schema = z.object({ version: z.string().regex(/^[0-9a-zA-Z.\-]+$/).max(32).optional() });
        const { version } = schema.parse(req.body || {});
        await runUpdateScript('telemt', version || null, res);
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
                    `${cronMap[data.frequency]} root /opt/tggate/scripts/check-updates.sh >/dev/null 2>&1\n`);
            } else {
                fs.rmSync('/etc/cron.d/tggate-updates', { force: true });
            }
        } catch (err) {
            // /etc/cron.d пишет root — от пользователя панели может не выйти (не критично)
            logger.warn('Не удалось обновить cron-задачу', { error: err.message });
        }

        res.json({ ok: true });
    } catch (err) { next(err); }
});

module.exports = router;
