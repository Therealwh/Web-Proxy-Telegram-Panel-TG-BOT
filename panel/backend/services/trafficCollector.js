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

let running = false;
/** total_octets из прошлого опроса: username -> байты */
let prevOctets = new Map();

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

    // Чистим записи старше 35 дней
    db.prepare("DELETE FROM traffic_daily WHERE date < date('now','-35 days')").run();
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
