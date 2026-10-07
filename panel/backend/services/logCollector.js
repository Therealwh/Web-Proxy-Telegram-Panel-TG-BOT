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
const { getAll } = require('../routes/settings');

let running = false;
let lastPrune = 0;
/** @type {Set<string>} ключи "username|ip|protocol" из прошлого опроса */
let prevKeys = new Set();

/**
 * Один цикл: слепок активных подключений → дельта → логи.
 * Ошибки Telemt тихо пропускаются (временная недоступность не влияет).
 */
async function pollOnce() {
    const snapshot = new Map(); // key -> record

    // WEB: активные сессии (поле клиента в Telemt — client_ip)
    try {
        const sessions = await telemt.getWebSessions({ limit: 200 });
        const list = Array.isArray(sessions) ? sessions : sessions?.sessions || [];
        for (const s of list) {
            const ip = s.client_ip || s.ip;
            if (!ip || !s.user) continue;
            snapshot.set(`${s.user}|${ip}|web`, {
                username: s.user, ip, protocol: 'web',
                status: 'ok', user_agent: s.user_agent || null,
                created_at: new Date().toISOString(),
            });
        }
    } catch { /* WEB-рантайм недоступен */ }

    // MTProto: активные source-IP по пользователям. Эндпоинт не различает
    // транспорт и агрегирует все устройства за NAT: строки mtproto НЕ
    // подавляем, даже если тот же user|ip виден как web-сессия.
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
    // Полный провал опроса — не сбрасываем prevKeys, чтобы после
    // восстановления Telemt не задублировать все подключения
    if (snapshot.size === 0 && prevKeys.size > 0) return;
    prevKeys = new Set(snapshot.keys());

    // Ретеншн: чистим старые логи не чаще раза в час
    if (Date.now() - lastPrune > 60 * 60 * 1000) {
        lastPrune = Date.now();
        try {
            const days = Math.max(1, Number(getAll().logs_keep_days ?? 30));
            db.prepare(`DELETE FROM connection_logs WHERE created_at < datetime('now','-${days} days')`).run();
        } catch { /* ignore */ }
    }
}

/** Запускает периодический опрос. */
function start() {
    if (running) return;
    running = true;
    logger.info('Коллектор логов запущен (слепки активных подключений каждые 5 сек)');
    setInterval(() => pollOnce(), 5000).unref();
}

module.exports = { start };
