/**
 * @fileoverview Аналитика продаж и клиентов: выручка по дням, топ тарифов,
 * новые клиенты, конверсия теста в покупку. Только для авторизованных.
 * @module routes/sales
 */

const express = require('express');
const { z } = require('zod');
const db = require('../db');

const router = express.Router();

/**
 * Округляет дату до N дней назад (для корректного «с нуля» графика).
 * @param {number} days
 */
const since = (days) => `datetime('now', '-${Number(days)} days')`;

// --- Сводка продаж и клиентов ---
router.get('/summary', async (req, res, next) => {
    try {
        const schema = z.object({ days: z.coerce.number().int().min(1).max(365).default(30) });
        const { days } = schema.parse(req.query);

        // Выручка и продажи по дням (только покупки с тарифом, без пополнений)
        const revenue = db.prepare(
            `SELECT date(paid_at) AS day, ROUND(SUM(amount), 2) AS total, COUNT(*) AS sales
             FROM payments
             WHERE status = 'success' AND tariff_id IS NOT NULL
               AND paid_at >= ${since(days)}
             GROUP BY day ORDER BY day`
        ).all();

        // Топ тарифов
        const topTariffs = db.prepare(
            `SELECT COALESCE(t.name, '—') AS name, COUNT(*) AS sales, ROUND(SUM(p.amount), 2) AS revenue
             FROM payments p LEFT JOIN tariffs t ON t.id = p.tariff_id
             WHERE p.status = 'success' AND p.tariff_id IS NOT NULL
               AND p.paid_at >= ${since(days)}
             GROUP BY p.tariff_id ORDER BY revenue DESC LIMIT 5`
        ).all();

        // Новые клиенты по дням
        const newClients = db.prepare(
            `SELECT date(created_at) AS day, COUNT(*) AS count
             FROM clients WHERE created_at >= ${since(days)}
             GROUP BY day ORDER BY day`
        ).all();

        // Конверсия бесплатного теста в покупку:
        // у скольких telegram_id есть тестовый прокси и (у того же tg id) платный
        const trials = db.prepare(
            "SELECT COUNT(DISTINCT telegram_id) AS c FROM clients WHERE username GLOB 'test[0-9]*' AND telegram_id IS NOT NULL"
        ).get().c;
        const converted = db.prepare(
            `SELECT COUNT(DISTINCT c1.telegram_id) AS c
             FROM clients c1
             WHERE c1.username GLOB 'test[0-9]*' AND c1.telegram_id IS NOT NULL
               AND EXISTS (SELECT 1 FROM clients c2
                           WHERE c2.telegram_id = c1.telegram_id
                             AND c2.username NOT GLOB 'test[0-9]*')`
        ).get().c;

        // Итоги
        const totals = db.prepare(
            `SELECT ROUND(COALESCE(SUM(amount), 0), 2) AS revenue, COUNT(*) AS sales
             FROM payments WHERE status = 'success' AND tariff_id IS NOT NULL
               AND paid_at >= ${since(days)}`
        ).get();
        const activeClients = db.prepare("SELECT COUNT(*) AS c FROM clients WHERE status = 'active'").get().c;
        const paidUsers = db.prepare(
            'SELECT COUNT(DISTINCT telegram_id) AS c FROM payments WHERE status = \'success\' AND telegram_id IS NOT NULL'
        ).get().c;

        res.json({
            days,
            totals: {
                revenue: totals.revenue || 0,
                sales: totals.sales || 0,
                active_clients: activeClients,
                paying_users: paidUsers,
                trials,
                trial_converted: converted,
                trial_conversion_pct: trials > 0 ? Math.round((converted / trials) * 100) : 0,
            },
            revenue_by_day: revenue,
            new_clients_by_day: newClients,
            top_tariffs: topTariffs,
        });
    } catch (err) {
        next(err);
    }
});

module.exports = router;
