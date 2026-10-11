/**
 * @fileoverview Просмотр журнала действий администраторов.
 * Сама запись ведётся middleware audit() на каждом изменяющем запросе,
 * раньше её можно было увидеть только как последние 20 строк на дашборде.
 * @module routes/audit
 */

const express = require('express');
const { z } = require('zod');
const db = require('../db');
const { csvCell, csvRow } = require('../utils/csv');

const router = express.Router();

/** Собирает условие WHERE по фильтрам. Значения всегда параметризуются. */
function buildFilter(q) {
    const schema = z.object({
        admin: z.string().max(64).optional(),
        action: z.string().max(32).optional(),
        search: z.string().max(200).optional(),
        from: z.string().max(32).optional(),
        to: z.string().max(32).optional(),
    });
    const data = schema.parse(q);

    const where = ['1=1'];
    const params = [];
    if (data.admin) { where.push('admin = ?'); params.push(data.admin); }
    if (data.action) { where.push('action LIKE ?'); params.push(`${data.action}%`); }
    if (data.search) {
        where.push('(action LIKE ? OR details LIKE ? OR ip LIKE ?)');
        const like = `%${data.search}%`;
        params.push(like, like, like);
    }
    if (data.from) { where.push('created_at >= ?'); params.push(data.from); }
    if (data.to) { where.push('created_at <= ?'); params.push(data.to); }
    return { sql: where.join(' AND '), params };
}

// --- Список записей с фильтрами и пагинацией ---
router.get('/', (req, res, next) => {
    try {
        const page = Math.max(1, parseInt(req.query.page, 10) || 1);
        const limit = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 50));
        const { sql, params } = buildFilter(req.query);

        const total = db.prepare(`SELECT COUNT(*) AS n FROM audit_log WHERE ${sql}`).get(...params).n;
        const entries = db.prepare(
            `SELECT id, admin, action, details, ip, created_at
             FROM audit_log WHERE ${sql} ORDER BY id DESC LIMIT ? OFFSET ?`
        ).all(...params, limit, (page - 1) * limit);

        // Список админов — для выпадающего фильтра
        const admins = db.prepare('SELECT DISTINCT admin FROM audit_log ORDER BY admin').all().map((r) => r.admin);

        res.json({ entries, total, page, limit, admins });
    } catch (err) {
        next(err);
    }
});

// --- Экспорт в CSV по тем же фильтрам ---
router.get('/export', (req, res, next) => {
    try {
        const { sql, params } = buildFilter(req.query);
        const rows = db.prepare(
            `SELECT created_at, admin, action, details, ip
             FROM audit_log WHERE ${sql} ORDER BY id DESC LIMIT 100000`
        ).all(...params);

        const lines = [csvRow(['created_at', 'admin', 'action', 'details', 'ip'])];
        for (const r of rows) {
            lines.push(csvRow([r.created_at, r.admin, r.action, r.details, r.ip]));
        }

        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="audit-${Date.now()}.csv"`);
        res.send('\uFEFF' + lines.join('\n'));
    } catch (err) {
        next(err);
    }
});

module.exports = router;
module.exports.buildFilter = buildFilter;