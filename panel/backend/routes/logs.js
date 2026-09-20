/**
 * @fileoverview Роуты живых логов подключений.
 * Данные собираются сервисом logCollector из Telemt и хранятся в SQLite.
 * @module routes/logs
 */

const express = require('express');
const db = require('../db');

const router = express.Router();

// --- Список логов с фильтрами ---
router.get('/', (req, res) => {
    const { username, ip, protocol, status, from, to, search, page = '1', limit = '100' } = req.query;
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(500, Math.max(1, parseInt(limit, 10) || 100));

    let where = '1=1';
    const params = [];

    if (username) { where += ' AND username = ?'; params.push(String(username).slice(0, 64)); }
    if (ip) { where += ' AND ip = ?'; params.push(String(ip).slice(0, 45)); }
    if (protocol && ['web', 'mtproto'].includes(protocol)) { where += ' AND protocol = ?'; params.push(protocol); }
    if (status && ['ok', 'blocked', 'suspicious'].includes(status)) { where += ' AND status = ?'; params.push(status); }
    if (from) { where += ' AND created_at >= ?'; params.push(String(from)); }
    if (to) { where += ' AND created_at <= ?'; params.push(String(to)); }
    if (search) {
        where += ' AND (ip LIKE ? OR user_agent LIKE ?)';
        const s = `%${String(search).slice(0, 100)}%`;
        params.push(s, s);
    }

    const total = db.prepare(`SELECT COUNT(*) AS c FROM connection_logs WHERE ${where}`).get(...params).c;
    const logs = db.prepare(
        `SELECT * FROM connection_logs WHERE ${where}
         ORDER BY created_at DESC LIMIT ? OFFSET ?`
    ).all(...params, limitNum, (pageNum - 1) * limitNum);

    res.json({ logs, total, page: pageNum, pages: Math.ceil(total / limitNum) });
});

// --- История уникальных IP (для справки) ---
router.get('/ips', (req, res) => {
    const rows = db.prepare(
        `SELECT ip, COUNT(*) AS connections, MAX(created_at) AS last_seen
         FROM connection_logs WHERE ip IS NOT NULL
         GROUP BY ip ORDER BY last_seen DESC LIMIT 200`
    ).all();
    res.json({ ips: rows });
});

// --- Экспорт логов за период в CSV ---
router.get('/export', (req, res) => {
    const { from, to } = req.query;
    let where = '1=1';
    const params = [];
    if (from) { where += ' AND created_at >= ?'; params.push(String(from)); }
    if (to) { where += ' AND created_at <= ?'; params.push(String(to)); }

    const rows = db.prepare(
        `SELECT created_at, username, ip, protocol, status, user_agent
         FROM connection_logs WHERE ${where} ORDER BY created_at DESC LIMIT 100000`
    ).all(...params);

    const header = 'created_at,username,ip,protocol,status,user_agent';
    const escape = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const lines = rows.map((r) =>
        [r.created_at, r.username, r.ip, r.protocol, r.status, r.user_agent].map(escape).join(',')
    );
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="tggate-logs.csv"');
    res.send([header, ...lines].join('\n'));
});

module.exports = router;
