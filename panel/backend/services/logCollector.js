/**
 * @fileoverview Коллектор живых логов подключений.
 * Каждые 5 секунд снимает «слепок» активных подключений из Telemt
 * (WEB-сессии + активные IP пользователей MTProto) и фиксирует
 * НОВЫЕ появления IP как события подключений в БД и WebSocket.
 * Это надёжнее парсинга журнала событий: источники — авторитетные.
 * @module services/logCollector
 */

const db = require('../db');
const telemt = require('./telemtApi');
const wsHub = require('./wsHub');
const logger = require('../utils/logger');

let running = false;
/** @type {Set<string>} ключи "username|ip|protocol" из прошлого опроса */
let prevKeys = new Set();

/**
 * Один цикл: слепок активных подключений → дельта → логи.
 * Ошибки Telemt тихо пропускаются (временная недоступность не влияет).
 */
async function pollOnce() {
    const snapshot = new Map(); // key -> record

    // MTProto: активные source-IP по пользователям
    try {
        const users = await telemt.getUsersActiveIps().catch(() => []);
        const list = Array.isArray(users) ? users : users?.users || [];
        for (const u of list) {
            for (const ip of u.active_ips || []) {
                snapshot.set(`${u.username}|${ip}|mtproto`, {
                    username: u.username, ip, protocol: 'mtproto',
                    status: 'ok', user_agent: null,
                    created_at: new Date().toISOString(),
                });
            }
        }
    } catch { /* Telemt недоступен */ }

    // WEB: активные сессии
    try {
        const sessions = await telemt.getWebSessions({ limit: 200 });
        const list = Array.isArray(sessions) ? sessions : sessions?.sessions || [];
        for (const s of list) {
            if (!s.ip || !s.user) continue;
            snapshot.set(`${s.user}|${s.ip}|web`, {
                username: s.user, ip: s.ip, protocol: 'web',
                status: 'ok', user_agent: s.user_agent || null,
                created_at: new Date().toISOString(),
            });
        }
    } catch { /* WEB-рантайм недоступен */ }

    // Дельта: новые ключи = новые подключения
    const insert = db.prepare(
        `INSERT INTO connection_logs (username, ip, protocol, status, user_agent, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`
    );
    for (const [key, rec] of snapshot) {
        if (prevKeys.has(key)) continue;
        try {
            insert.run(rec.username, rec.ip, rec.protocol, rec.status, rec.user_agent, rec.created_at);
            wsHub.broadcast('log', rec);
        } catch { /* БД не должна падать */ }
    }
    // Полный провал опроса — не сбрасываем prevKeys, чтобы после\n    // восстановления Telemt не задублировать все подключения\n    if (snapshot.size === 0 && prevKeys.size > 0) return;\n    prevKeys = new Set(snapshot.keys());
}

/** Запускает периодический опрос. */
function start() {
    if (running) return;
    running = true;
    logger.info('Коллектор логов запущен (слепки активных подключений каждые 5 сек)');
    setInterval(() => pollOnce(), 5000).unref();
}

module.exports = { start };
