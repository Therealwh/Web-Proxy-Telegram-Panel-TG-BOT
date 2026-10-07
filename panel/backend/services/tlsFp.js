/**
 * @fileoverview TLS-отпечатки клиентов: периодический снимок
 * GET /v1/runtime/tls-fingerprints с накоплением в БД поверх рестартов
 * движка (его счётчики cumulative и сбрасываются при рестарте).
 * @module services/tlsFp
 */

const db = require('../db');
const logger = require('../utils/logger');
const telemt = require('./telemtApi');

/**
 * Чистый мерж накопленной и свежей записи (покрыт тестами).
 * Сброс счётчика движка (рестарт) детектим по уменьшению total.
 */
function mergeFp(existing, incoming) {
    if (!existing) return { ...incoming };
    const reset = (incoming.total || 0) < (existing.total || 0);
    return {
        fp: incoming.fp,
        ja3: incoming.ja3 || existing.ja3,
        ja4: incoming.ja4 || existing.ja4,
        total: reset ? existing.total + incoming.total : Math.max(existing.total, incoming.total),
        auth_success: reset
            ? existing.auth_success + incoming.auth_success
            : Math.max(existing.auth_success, incoming.auth_success),
        bad_or_probe: reset
            ? existing.bad_or_probe + incoming.bad_or_probe
            : Math.max(existing.bad_or_probe, incoming.bad_or_probe),
        first_seen: [existing.first_seen, incoming.first_seen].filter(Boolean).sort()[0] || null,
        last_seen: [existing.last_seen, incoming.last_seen].filter(Boolean).sort().slice(-1)[0] || null,
    };
}

/** Один цикл синхронизации: снимок из Telemt → мерж в БД. */
async function syncOnce() {
    let snap = null;
    try {
        snap = await telemt.getTlsFingerprints(1000);
    } catch (err) {
        logger.error('TLS-отпечатки: Telemt недоступен', { error: err.message });
        return;
    }
    const list = (snap && (snap.by_fingerprint || snap.fingerprints)) || [];
    if (!Array.isArray(list) || list.length === 0) return;
    const get = db.prepare('SELECT * FROM tls_fingerprints WHERE fp = ?');
    const upsert = db.prepare(
        `INSERT INTO tls_fingerprints (fp, ja3, ja4, total, auth_success, bad_or_probe, first_seen, last_seen, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
         ON CONFLICT(fp) DO UPDATE SET
           ja3 = excluded.ja3, ja4 = excluded.ja4, total = excluded.total,
           auth_success = excluded.auth_success, bad_or_probe = excluded.bad_or_probe,
           first_seen = excluded.first_seen, last_seen = excluded.last_seen,
           updated_at = datetime('now')`
    );
    db.transaction(() => {
        for (const e of list) {
            const fp = e.ja4 || e.ja3;
            if (!fp) continue;
            const incoming = {
                fp,
                ja3: e.ja3 || null,
                ja4: e.ja4 || null,
                total: Number(e.total) || 0,
                auth_success: Number(e.auth_success) || 0,
                bad_or_probe: Number(e.bad_or_probe) || 0,
                first_seen: e.first_seen || null,
                last_seen: e.last_seen || null,
            };
            const merged = mergeFp(get.get(fp) || null, incoming);
            upsert.run(merged.fp, merged.ja3, merged.ja4, merged.total,
                merged.auth_success, merged.bad_or_probe, merged.first_seen, merged.last_seen);
        }
    })();
}

/** Все накопленные отпечатки для API. */
function getAll() {
    return db.prepare(
        'SELECT * FROM tls_fingerprints ORDER BY bad_or_probe DESC, total DESC LIMIT 500'
    ).all();
}

module.exports = { mergeFp, syncOnce, getAll };
