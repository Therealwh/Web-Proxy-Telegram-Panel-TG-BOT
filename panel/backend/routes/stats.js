/**
 * @fileoverview Роуты статистики для дашборда: нагрузка сервера,
 * счётчики пользователей/подключений, трафик, статусы сервисов, SSL.
 * @module routes/stats
 */

const express = require('express');
const { execSync } = require('child_process');
const db = require('../db');
const config = require('../config');
const telemt = require('../services/telemtApi');
const { getServerLoad } = require('../services/stats');
const logger = require('../utils/logger');

const router = express.Router();

/**
 * Проверяет статус systemd-сервиса.
 * @param {string} name - имя сервиса
 * @returns {boolean} true, если сервис активен
 */
function serviceActive(name) {
    try {
        execSync(`systemctl is-active --quiet ${name}`);
        return true;
    } catch {
        return false;
    }
}

/** Счётчики клиентов из БД. */
function clientCounters() {
    const total = db.prepare('SELECT COUNT(*) AS c FROM clients').get().c;
    const activeToday = db.prepare(
        "SELECT COUNT(DISTINCT username) AS c FROM connection_logs WHERE created_at >= date('now')"
    ).get().c;
    const newWeek = db.prepare(
        "SELECT COUNT(*) AS c FROM clients WHERE created_at >= datetime('now', '-7 days')"
    ).get().c;
    const active = db.prepare("SELECT COUNT(*) AS c FROM clients WHERE status = 'active'").get().c;
    const expired = db.prepare(
        "SELECT COUNT(*) AS c FROM clients WHERE expires_at IS NOT NULL AND expires_at < datetime('now')"
    ).get().c;
    return { total, activeToday, newWeek, active, expired };
}

/** Трафик за день/неделю/месяц из таблицы traffic_daily. */
function trafficStats() {
    const day = db.prepare(
        "SELECT COALESCE(SUM(bytes),0) AS b FROM traffic_daily WHERE date = date('now')"
    ).get().b;
    const week = db.prepare(
        "SELECT COALESCE(SUM(bytes),0) AS b FROM traffic_daily WHERE date >= date('now','-7 days')"
    ).get().b;
    const month = db.prepare(
        "SELECT COALESCE(SUM(bytes),0) AS b FROM traffic_daily WHERE date >= date('now','-30 days')"
    ).get().b;
    // По дням за последние 30 дней — для линейного графика
    const daily = db.prepare(
        `SELECT date, SUM(bytes) AS bytes FROM traffic_daily
         WHERE date >= date('now','-30 days') GROUP BY date ORDER BY date`
    ).all();
    // Топ клиентов — для кругового графика
    const byClient = db.prepare(
        `SELECT username, SUM(bytes) AS bytes FROM traffic_daily
         WHERE date >= date('now','-30 days') GROUP BY username ORDER BY bytes DESC LIMIT 10`
    ).all();
    return { day, week, month, daily, byClient };
}

/** Срок действия SSL-сертификата домена. */
async function sslExpiry() {
    try {
        const out = execSync(
            `echo | openssl s_client -servername ${config.domain} -connect ${config.domain}:443 2>/dev/null | openssl x509 -noout -enddate`,
            { timeout: 10000 }
        ).toString();
        const dateStr = out.split('=')[1]?.trim();
        if (!dateStr) return null;
        const expires = new Date(dateStr);
        const daysLeft = Math.round((expires - Date.now()) / 86400000);
        return { expires: expires.toISOString(), daysLeft };
    } catch {
        return null;
    }
}

/**
 * Аптайм systemd-сервиса (секунд с последнего запуска) или null.
 */
function serviceUptime(name) {
    try {
        const out = execSync(
            `systemctl show ${name} -p ActiveEnterTimestamp --value`,
            { timeout: 5000 }
        ).toString().trim();
        if (!out) return null;
        const start = new Date(out).getTime();
        if (Number.isNaN(start)) return null;
        return Math.max(0, Math.floor((Date.now() - start) / 1000));
    } catch {
        return null;
    }
}

// --- Живой график скорости трафика (1ч / 6ч / 24ч) ---
router.get('/traffic-live', (req, res) => {
    const trafficLive = require('../services/trafficLive');
    const rangeMap = { '1h': 3600e3, '6h': 6 * 3600e3, '24h': 24 * 3600e3 };
    const range = rangeMap[req.query.range] || rangeMap['1h'];
    res.json({
        points: trafficLive.getSeries(range),
        current: trafficLive.getCurrent(),
    });
});

// --- Активные подключения: кто сейчас онлайн, с каких IP и стран ---
router.get('/active', async (req, res, next) => {
    try {
        const geo = require('../services/geo');
        const rows = [];

        // MTProto: активные source-IP из Telemt
        try {
            const users = await telemt.getUsersActiveIps(); // [{username, active_ips:[]}]
            for (const u of users || []) {
                for (const ip of u.active_ips || []) {
                    rows.push({ username: u.username, ip, protocol: 'mtproto' });
                }
            }
        } catch { /* Telemt недоступен — покажем только WEB */ }

        // WEB: активные сессии
        let webSessionCount = 0;
        try {
            const sessions = await telemt.getWebSessions({ limit: 200 });
            const list = Array.isArray(sessions) ? sessions : sessions?.sessions || [];
            webSessionCount = list.length;
            for (const s of list) {
                if (s.ip) {
                    rows.push({
                        username: s.user || '—',
                        ip: s.ip,
                        protocol: 'web',
                        carrier: s.carrier || null,
                        user_agent: s.user_agent || null,
                    });
                }
            }
        } catch { /* WEB-рантайм недоступен */ }

        // Страны по уникальным IP (с кэшем)
        const geoMap = await geo.lookupMany(rows.map((r) => r.ip));
        for (const r of rows) r.country = geoMap[r.ip]?.country || '—';

        res.json({
            active_total: rows.length,
            web_sessions: webSessionCount,
            connections: rows,
        });
    } catch (err) {
        next(err);
    }
});

// --- Полная сводка для дашборда ---
router.get('/dashboard', async (req, res) => {
    const [serverLoad, ssl] = await Promise.all([getServerLoad(), sslExpiry()]);

    let telemtStatus = { ok: false };
    let connections = { total: 0, active: 0 };
    try {
        const [health, summary] = await Promise.all([
            telemt.getHealth(),
            telemt.getStatsSummary(),
        ]);
        telemtStatus = { ok: true, health };
        // connections_total — счётчик принятых соединений за аптайм.
        // Активных подключений в summary НЕТ — считаем по активным IP + WEB-сессиям.
        connections = { total: summary?.connections_total ?? 0, active: 0 };
    } catch (err) {
        logger.warn('Telemt недоступен для статистики', { error: err.message });
    }

    // Активные подключения сейчас: пользователи с активными IP + WEB-сессии
    try {
        const [activeIps, webSessions] = await Promise.all([
            telemt.getUsersActiveIps().catch(() => []),
            telemt.getWebSessions({ limit: 200 }).catch(() => []),
        ]);
        const usersWithIp = (Array.isArray(activeIps) ? activeIps : activeIps?.users || [])
            .filter((u) => (u.active_ips || []).length > 0).length;
        const webList = Array.isArray(webSessions) ? webSessions : webSessions?.sessions || [];
        connections.active = usersWithIp + webList.length;
    } catch { /* оставляем 0 */ }

    // Настройки протоколов из Telemt-конфига
    let protocols = { web: true, mtproto: true };
    try {
        const cfg = await telemt.getConfig();
        protocols = {
            web: cfg?.web?.enabled !== false,
            mtproto: true, // MTProto-listener всегда на MTPROTO_PORT
        };
    } catch { /* Telemt недоступен — оставляем дефолт */ }

    res.json({
        server: serverLoad,
        clients: clientCounters(),
        connections,
        traffic: trafficStats(),
        services: {
            telemt: serviceActive('telemt'),
            panel: true, // раз ответили — работает
            nginx: serviceActive('nginx'),
            caddy: serviceActive('caddy'),
        },
        // Аптайм: сколько каждый сервис работает без падений
        uptimes: {
            telemt: serviceUptime('telemt'),
            panel: Math.floor(process.uptime()),
            nginx: serviceUptime('nginx'),
            caddy: serviceUptime('caddy'),
        },
        ssl,
        protocols,
    });
});

// --- Трафик по дням (для графиков на отдельных страницах) ---
router.get('/traffic', (req, res) => {
    res.json(trafficStats());
});

// --- Аптайм (проверки доступности прокси) ---
router.get('/uptime', (req, res) => {
    const rows = db.prepare(
        `SELECT service,
                COUNT(*) AS total,
                SUM(ok) AS ok_count,
                AVG(latency_ms) AS avg_latency
         FROM uptime_checks
         WHERE created_at >= datetime('now', '-30 days')
         GROUP BY service`
    ).all();
    res.json({ uptime: rows });
});

module.exports = router;
