/**
 * @fileoverview Сборщик трафика по клиентам.
 * Раз в минуту опрашивает Telemt (/v1/users → total_octets у каждого
 * пользователя), считает дельту с прошлым опросом и пишет её в
 * traffic_daily (для графиков) + обновляет clients.traffic_used
 * (для квот и прогресс-баров).
 * @module services/trafficCollector
 */

const db = require('../db');
const telemt = require('./telemtApi');
const logger = require('../utils/logger');
const { fireWebhook } = require('./webhooks');

let running = false;
/** total_octets из прошлого опроса: username -> байты */
let prevOctets = new Map();
/** id клиентов, о превышении квоты которых уже сообщили (чтобы не слать событие каждую минуту) */
const quotaNotified = new Set();

/** Один цикл сбора. */
async function pollOnce() {
    const users = await telemt.listUsers(); // UserInfo[] с total_octets
    if (!Array.isArray(users)) return;

    const nowOctets = new Map();
    for (const u of users) {
        if (!u.username) continue;
        nowOctets.set(u.username, Number(u.total_octets) || 0);
    }

    const upsertTraffic = db.prepare(
        `INSERT INTO traffic_daily (date, username, bytes) VALUES (?, ?, ?)
         ON CONFLICT(date, username) DO UPDATE SET bytes = bytes + excluded.bytes`
    );
    const setUsed = db.prepare('UPDATE clients SET traffic_used = ? WHERE username = ?');

    const today = new Date().toISOString().slice(0, 10);
    db.transaction(() => {
        for (const [username, total] of nowOctets) {
            const prev = prevOctets.has(username) ? prevOctets.get(username) : null;
            // prev=null → первый опрос: пропускаем (иначе зачтётся вся история)
            // total < prev → квота сброшена (reset-quota) → начинаем с нуля
            const delta = prev === null ? 0 : Math.max(0, total - prev);
            if (delta > 0) {
                upsertTraffic.run(today, username, delta);
            }
            setUsed.run(total, username);
        }
    })();

    prevOctets = nowOctets;

    checkQuotaEvents();

    // Чистим записи старше 35 дней
    db.prepare("DELETE FROM traffic_daily WHERE date < date('now','-35 days')").run();
}

/**
 * Событие quota.exceeded — один раз на каждый факт пересечения квоты.
 * При сбросе квоты (reset-quota или автосброс) флаг снимается,
 * поэтому следующее пересечение снова породит событие.
 */
function checkQuotaEvents() {
    const rows = db.prepare(
        `SELECT id, username, quota_bytes, traffic_used, expires_at, max_ips, owner
         FROM clients WHERE quota_bytes IS NOT NULL AND quota_bytes > 0`
    ).all();
    for (const r of rows) {
        const key = String(r.id);
        const over = Number(r.traffic_used) >= Number(r.quota_bytes);
        if (over && !quotaNotified.has(key)) {
            quotaNotified.add(key);
            fireWebhook('quota.exceeded', {
                id: r.id,
                username: r.username,
                quota_bytes: r.quota_bytes,
                traffic_used: r.traffic_used,
                expires_at: r.expires_at,
                max_ips: r.max_ips,
                owner: r.owner ?? null,
            }).catch(() => {});
        } else if (!over) {
            quotaNotified.delete(key);
        }
    }
}

/** Запускает периодический сбор (раз в минуту). */
function start() {
    if (running) return;
    running = true;
    logger.info('Сборщик трафика запущен (опрос раз в минуту)');
    // Первый опрос с задержкой — даём Telemt подняться
    setTimeout(() => {
        pollOnce().catch((e) => logger.warn('Сбор трафика: первый опрос не удался', { error: e.message }));
        setInterval(() => {
            pollOnce().catch((e) => logger.warn('Ошибка сбора трафика', { error: e.message }));
        }, 60000).unref();
    }, 15000).unref();
}

module.exports = { start };
