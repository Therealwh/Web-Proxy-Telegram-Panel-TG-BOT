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
        connections = {
            total: summary?.connections_total ?? 0,
            active: summary?.connections_active ?? 0,
        };
    } catch (err) {
        logger.warn('Telemt недоступен для статистики', { error: err.message });
    }

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
