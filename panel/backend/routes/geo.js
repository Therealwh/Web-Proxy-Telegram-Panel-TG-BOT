/**
 * @fileoverview География подключений: агрегация по странам из журнала
 * подключений с использованием гео-кэша (services/geo). Неопределённые IP
 * догеолоцируются в фоне (лимит ip-api 45/мин) — страница опрашивает
 * эндпоинт и данные дозаполняются постепенно.
 * @module routes/geo
 */

const express = require('express');
const db = require('../db');
const geo = require('../services/geo');

const router = express.Router();

// Центроиды стран (ISO2 -> [lat, lng]) для карты — приблизительные
const CENTROIDS = {
    RU: [61, 90], UA: [49, 32], BY: [53.7, 28], KZ: [48, 68], UZ: [41.4, 64.6],
    KG: [41.2, 74.8], TJ: [38.9, 71.3], AM: [40.3, 45], GE: [42.2, 43.5],
    AZ: [40.3, 47.6], MD: [47.2, 28.5], DE: [51.2, 10.4], FR: [46.6, 2.4],
    GB: [54.1, -2.9], IE: [53.2, -8.2], IT: [42.8, 12.6], ES: [40.2, -3.6],
    PT: [39.6, -8], NL: [52.2, 5.6], BE: [50.6, 4.7], CH: [46.8, 8.2],
    AT: [47.6, 14.1], CZ: [49.8, 15.5], SK: [48.7, 19.7], PL: [52.1, 19.4],
    SE: [62.8, 16.7], NO: [64.6, 12.6], FI: [64.5, 26], DK: [56, 10],
    EE: [58.7, 25], LV: [56.9, 24.9], LT: [55.3, 23.9], RO: [45.9, 25],
    BG: [42.7, 25.5], RS: [44, 21], HR: [45.1, 15.2], SI: [46.1, 14.8],
    GR: [39.1, 21.9], TR: [39, 35.2], IL: [31.4, 34.9], AE: [24, 54],
    SA: [24, 45], IR: [32.4, 53.7], IQ: [33.2, 43.7], EG: [26.8, 30.8],
    MA: [31.8, -7.1], DZ: [28, 2.6], TN: [33.9, 9.5], ZA: [-28.5, 24.7],
    US: [39.8, -98.6], CA: [56.1, -106.3], MX: [23.6, -102.5],
    BR: [-10.8, -52.9], AR: [-35.4, -65.2], CL: [-33.4, -70.7],
    CO: [4.6, -74.1], PE: [-9.2, -75], VE: [6.4, -66.6],
    CN: [35.9, 104.2], JP: [36.2, 138.3], KR: [36.5, 127.9],
    IN: [21.1, 79.1], PK: [30.4, 69.3], BD: [23.7, 90.4],
    TH: [15.1, 101], VN: [14.1, 108.3], ID: [-2.5, 118], MY: [4.2, 109.5],
    SG: [1.35, 103.8], PH: [12.9, 121.8], AU: [-25.3, 133.8],
    NZ: [-41.8, 172.8], TW: [23.7, 121], HK: [22.4, 114.1], MN: [46.9, 103.8],
};

const RANGES = { '24h': 1, '7d': 7, '30d': 30 };

// --- Сводка по странам за период ---
router.get('/summary', async (req, res, next) => {
    try {
        const days = RANGES[req.query.range] || 1;
        const rows = db.prepare(
            `SELECT ip, COUNT(*) AS conns, COUNT(DISTINCT username) AS users,
                    GROUP_CONCAT(DISTINCT username) AS usernames
             FROM connection_logs
             WHERE created_at >= datetime('now', '-' || ? || ' days') AND ip IS NOT NULL
             GROUP BY ip`
        ).all(days);

        const byCode = new Map();
        const unresolved = [];
        for (const r of rows) {
            let geoInfo = { country: 'Неизвестно', code: '—' };
            const cached = db.prepare('SELECT value FROM settings WHERE key = ?').get('geo:' + r.ip);
            if (cached) {
                try { geoInfo = JSON.parse(cached.value); } catch { /* битый кэш */ }
            } else if (r.ip) {
                unresolved.push(r.ip);
            }
            const code = geoInfo.code || '—';
            if (!byCode.has(code)) {
                byCode.set(code, {
                    code,
                    country: geoInfo.country,
                    ips: 0, conns: 0, users: 0,
                    usernames: new Set(),
                    lat: CENTROIDS[code]?.[0] ?? null,
                    lng: CENTROIDS[code]?.[1] ?? null,
                });
            }
            const entry = byCode.get(code);
            entry.ips += 1;
            entry.conns += r.conns;
            for (const u of String(r.usernames || '').split(',')) {
                if (u) entry.usernames.add(u);
            }
            entry.users = entry.usernames.size;
        }

        // Неопределённые IP догеолоцируем в фоне (лимит ip-api), страница дозаполнится
        if (unresolved.length > 0) {
            geo.lookupMany(unresolved).catch(() => {});
        }

        const countries = [...byCode.values()]
            .map((e) => ({ ...e, usernames: [...e.usernames].slice(0, 20) }))
            .sort((a, b) => b.conns - a.conns);

        res.json({
            range: req.query.range || '24h',
            countries,
            totals: {
                countries: countries.filter((c) => c.code !== '—').length,
                ips: rows.length,
                conns: rows.reduce((a, r) => a + r.conns, 0),
                unresolved: unresolved.length,
            },
        });
    } catch (err) {
        next(err);
    }
});

module.exports = router;
