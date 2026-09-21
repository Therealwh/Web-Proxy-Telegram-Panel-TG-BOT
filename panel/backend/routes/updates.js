/**
 * @fileoverview Система обновлений: статус версий (всегда живой), список
 * доступных релизов, обновление панели/Telemt на выбранную версию, история.
 * Root-скрипты запускаются через TGGATE Helper (127.0.0.1:9443, секрет) —
 * без sudo и sudoers.
 * @module routes/updates
 */

const express = require('express');
const fs = require('fs');
const { z } = require('zod');
const db = require('../db');
const config = require('../config');
const { httpError } = require('../middleware/errorHandler');
const { getAll } = require('./settings');
const versionInfo = require('../services/versionInfo');
const logger = require('../utils/logger');

const router = express.Router();

// Обновления выполняются root-скриптами через TGGATE Helper —
// привилегированный помощник (127.0.0.1:9443, секрет из install.env).
// Ставится автоматически install.sh / scripts/install-helper.sh.
const SCRIPTS = {
    check: '/opt/tggate/scripts/check-updates.sh',
    panel: '/opt/tggate/scripts/update-panel.sh',
    telemt: '/opt/tggate/scripts/update-telemt.sh',
};

/**
 * Запуск скрипта через хелпер.
 * @returns {Promise<void>} ошибка с понятным текстом при проблемах
 */
async function runViaHelper(key, targetVersion) {
    if (!config.helperUrl || !config.helperSecret) {
        throw new Error(
            'Хелпер обновлений не настроен. Выполните на сервере от root: ' +
            'bash /opt/tggate/scripts/install-helper.sh && systemctl restart tggate-panel'
        );
    }
    try {
        const res = await fetch(`${config.helperUrl}/run`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ secret: config.helperSecret, key, version: targetVersion }),
            signal: AbortSignal.timeout(10000),
        });
        if (!res.ok) {
            const text = await res.text();
            if (res.status === 403) {
                throw new Error('Хелпер отклонил секрет. Перезапустите: bash /opt/tggate/scripts/install-helper.sh');
            }
            throw new Error(`Хелпер: HTTP ${res.status} ${text.slice(0, 100)}`);
        }
    } catch (err) {
        if (err.name === 'AbortError' || err.cause?.code === 'ECONNREFUSED') {
            throw new Error(
                'Хелпер обновлений не запущен. Выполните на сервере от root: ' +
                'bash /opt/tggate/scripts/install-helper.sh && systemctl restart tggate-panel'
            );
        }
        throw err;
    }
}

/**
 * Запускает обновление через хелпер.
 * @param {'check'|'panel'|'telemt'} key
 * @param {string|null} targetVersion - конкретная версия (null = последняя)
 * @param {import('express').Response} res
 */
async function runUpdateScript(key, targetVersion, res) {
    const script = SCRIPTS[key];
    if (!fs.existsSync(script)) {
        throw httpError(404, `Скрипт ${script} не найден. Перезапустите установку панели.`);
    }

    try {
        await runViaHelper(key, targetVersion);
    } catch (err) {
        logger.error('Обновление не запущено', { key, error: err.message });
        throw httpError(500, err.message);
    }

    // Статус в историю пишет сам root-скрипт (перезапуск панели убьёт
    // запущенный скрипт — это ожидаемо, всё важное он делает до рестарта)
    res.json({
        ok: true,
        message: targetVersion
            ? `Обновление до версии ${targetVersion} запущено. Это займёт 1-2 минуты.`
            : 'Обновление запущено. Это займёт 1-2 минуты.',
    });
}

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
router.put('/settings', async (req, res, next) => {
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

        try {
            if (config.helperUrl && config.helperSecret) {
                await fetch(`${config.helperUrl}/cron`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ secret: config.helperSecret, frequency: data.auto_check ? data.frequency : 'off' }),
                    signal: AbortSignal.timeout(5000),
                });
            }
        } catch (err) {
            logger.warn('Не удалось обновить cron через хелпер', { error: err.message });
        }

        res.json({ ok: true });
    } catch (err) { next(err); }
});

module.exports = router;
