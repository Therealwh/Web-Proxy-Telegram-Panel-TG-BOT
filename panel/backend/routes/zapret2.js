/**
 * @fileoverview Управление zapret2 (nfqws2) — опциональный обход DPI для MTProto.
 * Установка/удаление идут через root-хелпер (ключ zapret2); статус читается
 * локально: бинарь на диске + процесс nfqws2 + привязка очереди в ядре.
 * @module routes/zapret2
 */

const express = require('express');
const fs = require('fs');
const { execSync } = require('child_process');
const config = require('../config');
const logger = require('../utils/logger');
const { httpError } = require('../middleware/errorHandler');

const router = express.Router();

const BIN = '/opt/tggate-zapret2/bin/nfqws2';
const CONF = '/etc/tggate-zapret2/mtproto.conf';
const QUEUE_PROC = '/proc/net/netfilter/nfnetlink_queue';

/**
 * Чистая: привязана ли очередь к nfqws2 (вывод /proc/net/netfilter/nfnetlink_queue).
 * Строки вида "200 0 262144 20 65535 262144" — первое поле qnum.
 * @param {string} text - содержимое файла очередей
 * @param {number} qnum - номер очереди из конфига
 * @returns {boolean}
 */
function queueBound(text, qnum) {
    return String(text || '').split('\n')
        .some((l) => l.trim().startsWith(`${qnum} `));
}

/**
 * Чистая: значение опции из конфига nfqws2 (вида --qnum 200 или --filter-tcp=8443).
 * @param {string} text - содержимое конфига
 * @param {string} key - имя опции без дефисов
 * @returns {string|null}
 */
function parseConf(text, key) {
    const m = String(text || '').match(new RegExp(`--${key}[= ]([^\\s]+)`));
    return m ? m[1] : null;
}

function isProcRunning() {
    try {
        execSync('pgrep -x nfqws2', { stdio: 'ignore' });
        return true;
    } catch {
        return false;
    }
}

// --- Статус: установлен ли, работает ли, какой порт/очередь ---
router.get('/', async (req, res, next) => {
    const installed = fs.existsSync(BIN);
    let conf = '';
    try { conf = fs.readFileSync(CONF, 'utf8'); } catch { /* не установлен */ }
    const queue = Number(parseConf(conf, 'qnum') || 200);
    let queueText = '';
    try { queueText = fs.readFileSync(QUEUE_PROC, 'utf8'); } catch { /* модуль не загружен */ }
    let service = null;   // 'active' | 'inactive' | 'failed' | null (не определено)
    let proc = false;
    if (config.helperUrl && config.helperSecret) {
        try {
            const hr = await fetch(`${config.helperUrl}/run`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ secret: config.helperSecret, key: 'zapret2-status' }),
                signal: AbortSignal.timeout(5000),
            });
            const hd = await hr.json().catch(() => ({}));
            service = hd.active ? 'active' : (hd.failed ? 'failed' : 'inactive');
            proc = !!hd.proc;
        } catch {
            /* хелпер недоступен — статус ниже через локальные проверки */
        }
    }
    const localProc = isProcRunning();
    const running = installed
        && (service === 'active' ? proc : (proc || localProc))
        && queueBound(queueText, queue);
    res.json({
        installed,
        running,
        service,
        proc,
        port: config.mtprotoPort,
        queue,
        table: 'TGGATE',
    });
});

// --- Хвост лога хелпера: что делалась/почему упала установка (диагностика из панели) ---
router.get('/log', (req, res) => {
    let text = '';
    try {
        text = fs.readFileSync('/var/log/tggate/helper.log', 'utf8');
    } catch { /* файла нет или нет доступа */ }
    const lines = text.split('\n')
        .filter((l) => l.includes('zapret2'))
        .slice(-30);
    res.json({ lines });
});

async function runHelper(action) {
    if (!config.helperUrl || !config.helperSecret) {
        throw httpError(500, 'Хелпер не настроен. Выполните на сервере: bash /opt/tggate/scripts/install-helper.sh');
    }
    const r = await fetch(`${config.helperUrl}/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ secret: config.helperSecret, key: 'zapret2', action }),
        signal: AbortSignal.timeout(15000),
    });
    if (!r.ok) {
        const text = await r.text().catch(() => '');
        throw httpError(502, `Хелпер отклонил запрос: HTTP ${r.status} ${text.slice(0, 100)}`);
    }
}

// Действия (асинхронные: статус — по кнопке обновить на странице)
for (const action of ['install', 'remove', 'start', 'stop', 'restart']) {
    router.post(`/${action}`, async (req, res, next) => {
        try {
            await runHelper(action);
            logger.info(`zapret2: действие ${action} запущено`);
            res.json({ ok: true, started: true });
        } catch (err) {
            next(err);
        }
    });
}

module.exports = { router, queueBound, parseConf };
