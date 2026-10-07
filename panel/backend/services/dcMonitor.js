/**
 * @fileoverview DC-монитор: следит за доступностью дата-центров Telegram
 * через Telemt Control API (GET /v1/stats/dcs), пишет историю в dc_checks,
 * уведомляет админа о падениях и (опционально) перезапускает Telemt через
 * root-хелпер при тотальной деградации с кулдауном.
 * @module services/dcMonitor
 */

const db = require('../db');
const config = require('../config');
const { getAll } = require('../routes/settings');
const notifier = require('./notifier');
const logger = require('../utils/logger');
const telemt = require('./telemtApi');

// Сколько подряд тотально-красных проверок перед авторестартом
const RESTART_STREAK = 3;

let degradedStreak = 0;
let lastOverall = 'unknown';

/**
 * Чистая функция оценки состояния DC (покрыта тестами).
 * @param {object|null} payload - ответ /v1/stats/dcs ({ dcs: [...] })
 * @param {number} threshold - порог coverage_pct, ниже — деградация
 * @returns {{ perDc: Array, degraded: Array<number>, overall: string, shouldRestart: boolean }}
 * overall: ok | partial | degraded | unknown
 */
function evaluateDc(payload, threshold) {
    const list = (payload && Array.isArray(payload.dcs)) ? payload.dcs : [];
    const perDc = list.map((d) => {
        const coverage = Number(d.coverage_pct ?? d.available_pct ?? 0);
        const alive = Number(d.alive_writers ?? 0);
        const required = Number(d.required_writers ?? 0);
        const degraded = coverage < threshold || (required > 0 && alive < required);
        return {
            dc: d.dc,
            coverage_pct: Number.isFinite(coverage) ? coverage : 0,
            rtt_ms: d.rtt_ms ?? null,
            alive_writers: alive,
            required_writers: required,
            degraded,
        };
    });
    const degraded = perDc.filter((d) => d.degraded).map((d) => d.dc);
    let overall = 'unknown';
    if (perDc.length > 0) {
        overall = degraded.length === 0 ? 'ok'
            : degraded.length >= perDc.length ? 'degraded' : 'partial';
    }
    return { perDc, degraded, overall, shouldRestart: overall === 'degraded' };
}

/** Последний авторестарт (для кулдауна). @returns {string|null} ISO created_at */
function lastRestartAt() {
    const row = db.prepare(
        "SELECT created_at FROM dc_events WHERE type = 'restart' ORDER BY id DESC LIMIT 1"
    ).get();
    return row ? row.created_at : null;
}

/** Перезапуск Telemt через root-хелпер (ключ restart-telemt). */
async function restartTelemt() {
    if (!config.helperUrl || !config.helperSecret) {
        throw new Error('Helper не настроен (нет HELPER_URL/SECRET)');
    }
    const res = await fetch(`${config.helperUrl}/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ secret: config.helperSecret, key: 'restart-telemt' }),
        signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) throw new Error(`Helper ответил HTTP ${res.status}`);
}

/** Одна проверка DC: опрос, запись истории, алерты, авторестарт. */
async function checkDc() {
    try {
        const settings = getAll();
        if (!settings.dc_monitor_enabled) return;

        const threshold = Number(settings.dc_coverage_threshold ?? 50);
        let payload = null;
        try {
            payload = await telemt.getStatsDcs();
        } catch (err) {
            logger.error('DC-монитор: Telemt API недоступен', { error: err.message });
            return;
        }

        const evalRes = evaluateDc(payload, threshold);
        const now = new Date().toISOString();

        const insert = db.prepare(
            'INSERT INTO dc_checks (dc, coverage_pct, rtt_ms, alive_writers, required_writers, degraded) VALUES (?, ?, ?, ?, ?, ?)'
        );
        for (const d of evalRes.perDc) {
            insert.run(d.dc, d.coverage_pct, d.rtt_ms, d.alive_writers, d.required_writers, d.degraded ? 1 : 0);
        }
        db.prepare("DELETE FROM dc_checks WHERE created_at < datetime('now','-7 days')").run();

        const event = (type, details) =>
            db.prepare('INSERT INTO dc_events (type, details) VALUES (?, ?)').run(type, details);

        // Переходы состояний → уведомления (без спама: только на смене)
        if (lastOverall !== evalRes.overall) {
            if (evalRes.overall !== 'ok' && evalRes.overall !== 'unknown') {
                event('down', `DC degraded: ${evalRes.degraded.join(',')}`);
                if (settings.notify_services) {
                    notifier.notifyAdmin(settings,
                        `🛰 <b>Деградация DC Telegram</b>\nПокрытие ниже порога ${threshold}%: DC ${evalRes.degraded.join(', ')}`);
                }
            } else if (lastOverall !== 'ok' && lastOverall !== 'unknown' && evalRes.overall === 'ok') {
                event('recovered', 'coverage ok');
                if (settings.notify_services) {
                    notifier.notifyAdmin(settings, '🛰 <b>DC Telegram восстановлены</b> — покрытие в норме.');
                }
            }
            lastOverall = evalRes.overall;
        }

        // Тотальная деградация N раз подряд → авторестарт с кулдауном
        if (evalRes.shouldRestart) {
            degradedStreak += 1;
        } else {
            degradedStreak = 0;
        }
        if (degradedStreak >= RESTART_STREAK && settings.dc_auto_restart) {
            const cooldownMs = Number(settings.dc_cooldown_min ?? 30) * 60 * 1000;
            const last = lastRestartAt();
            if (!last || Date.now() - new Date(last).getTime() >= cooldownMs) {
                try {
                    await restartTelemt();
                    event('restart', `auto after ${degradedStreak} bad checks`);
                    degradedStreak = 0;
                    if (settings.notify_services) {
                        notifier.notifyAdmin(settings,
                            '🔄 <b>Telemt перезапущен автоматически</b> — все DC были деградированы.');
                    }
                } catch (err) {
                    logger.error('DC-монитор: авторестарт не удался', { error: err.message });
                }
            } else {
                logger.error('DC-монитор: пропуск авторестарта (кулдаун)');
            }
        }
    } catch (err) {
        logger.error('Ошибка DC-монитора', { error: err.message });
    }
}

/** Свежий срез для API: последнее состояние каждого DC + overall + рестарт. */
function getStatus() {
    const rows = db.prepare(
        `SELECT dc, coverage_pct, rtt_ms, alive_writers, required_writers, degraded, created_at
         FROM dc_checks WHERE id IN (SELECT MAX(id) FROM dc_checks GROUP BY dc)`
    ).all();
    const settings = getAll();
    const threshold = Number(settings.dc_coverage_threshold ?? 50);
    const perDc = rows.map((r) => ({ ...r, degraded: !!r.degraded }));
    const bad = perDc.filter((d) => d.degraded).map((d) => d.dc);
    const overall = perDc.length === 0 ? 'unknown'
        : bad.length === 0 ? 'ok' : bad.length >= perDc.length ? 'degraded' : 'partial';
    const lastRestart = db.prepare(
        "SELECT created_at, details FROM dc_events WHERE type = 'restart' ORDER BY id DESC LIMIT 1"
    ).get() || null;
    return {
        perDc, degraded: bad, overall, lastRestart,
        checkedAt: rows.length ? rows[0].created_at : null,
        enabled: !!settings.dc_monitor_enabled,
        threshold,
    };
}

module.exports = { evaluateDc, checkDc, getStatus, restartTelemt };
