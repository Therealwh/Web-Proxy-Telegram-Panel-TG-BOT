/**
 * @fileoverview Коллектор логов подключений.
 * Опрашивает Telemt Control API (/v1/runtime/events/recent) каждую секунду,
 * сохраняет новые события в БД и рассылает по WebSocket.
 * @module services/logCollector
 */

const db = require('../db');
const telemt = require('./telemtApi');
const wsHub = require('./wsHub');
const logger = require('../utils/logger');

let running = false;
let lastSeenId = null;

/** Маппинг типа события Telemt на статус лога панели. */
function mapStatus(kind) {
    if (!kind) return 'ok';
    if (kind.includes('fail') || kind.includes('reject') || kind.includes('deny')) return 'blocked';
    if (kind.includes('suspect') || kind.includes('fingerprint')) return 'suspicious';
    return 'ok';
}

/** Определяет протокол по типу события. */
function mapProtocol(kind) {
    if (!kind) return 'mtproto';
    return kind.includes('web') ? 'web' : 'mtproto';
}

/**
 * Один цикл опроса Telemt. Не бросает исключений наружу —
 * временная недоступность Telemt не должна влиять на панель.
 */
async function pollOnce() {
    try {
        const events = await telemt.getRecentEvents(100);
        const list = Array.isArray(events) ? events : events?.events || [];

        const insert = db.prepare(
            `INSERT INTO connection_logs (username, ip, protocol, status, user_agent, created_at)
             VALUES (?, ?, ?, ?, ?, ?)`
        );

        for (const ev of list) {
            // Пропускаем уже виденные события (по id, если есть)
            const evId = ev.id ?? ev.seq ?? null;
            if (evId !== null && lastSeenId !== null && evId <= lastSeenId) continue;
            if (evId !== null) lastSeenId = Math.max(lastSeenId ?? 0, evId);

            const record = {
                username: ev.user || ev.username || null,
                ip: ev.ip || ev.source_ip || null,
                protocol: mapProtocol(ev.kind || ev.type),
                status: mapStatus(ev.kind || ev.type),
                user_agent: ev.user_agent || null,
                created_at: ev.ts || ev.timestamp || new Date().toISOString(),
            };

            insert.run(
                record.username, record.ip, record.protocol,
                record.status, record.user_agent, record.created_at
            );
            wsHub.broadcast('log', record);
        }
    } catch {
        // Telemt недоступен — пропускаем цикл
    }
}

/** Запускает периодический опрос (1 раз в секунду). */
function start() {
    if (running) return;
    running = true;
    logger.info('Коллектор логов запущен');
    setInterval(pollOnce, 1000).unref();
}

module.exports = { start };
