/**
 * @fileoverview Внешняя доступность прокси глазами зондов Globalping.
 * Создаёт http-замер до MTProto-порта (FakeTLS отдаёт TLS-handshake как
 * настоящему клиенту Telegram), опрашивает результат, считает долю успеха
 * и хранит историю в availability_checks. Успех = result.status success.
 * @module services/availability
 */

const db = require('../db');
const config = require('../config');
const { getAll } = require('../routes/settings');
const notifier = require('./notifier');
const logger = require('../utils/logger');

const API = 'https://api.globalping.io/v1/measurements';
const POLL_MS = 5000;
const POLL_TRIES = 18; // ~90 секунд ожидания результата

/**
 * Успех одного проба: Globalping отдаёт итог в rawOutput, а не в статусе
 * (статус проба = finished/in-progress). Для ping/TCP успех — «Reply from»,
 * неудача — «No reply», таймаут, DNS-ошибка.
 */
function probeOk(r) {
    const raw = String(r?.result?.rawOutput || '');
    if (!raw) return false;
    if (/no reply|timed out|could not|unknown host|name or service|resolve/i.test(raw)) return false;
    return /reply from/i.test(raw);
}

/**
 * Чистая функция подсчёта: сколько пробов успешно дошли.
 * @param {Array} results - results[] замера Globalping
 * @returns {{ ok: number, total: number, pct: number|null }}
 */
function scoreResults(results) {
    const list = Array.isArray(results) ? results : [];
    const ok = list.filter(probeOk).length;
    return { ok, total: list.length, pct: list.length ? Math.round((ok / list.length) * 100) : null };
}

/**
 * Создать замер: TCP-рукопожатие с портом прокси из РФ-зондов.
 * HTTP не используем — MTProto FakeTLS не отвечает по HTTP, всё было бы 0/10.
 * @returns {Promise<string>} measurement id
 */
async function createMeasurement({ target, port, probes, token }) {
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await fetch(API, {
        method: 'POST',
        headers,
        body: JSON.stringify({
            type: 'ping',
            target,
            limit: probes,
            locations: [{ country: 'RU' }],
            measurementOptions: { protocol: 'TCP', port },
        }),
        signal: AbortSignal.timeout(20000),
    });
    if (res.status === 429) throw new Error('Globalping: исчерпана квота (429)');
    if (!res.ok && res.status !== 202) throw new Error(`Globalping: HTTP ${res.status}`);
    const data = await res.json().catch(() => ({}));
    if (!data.id) throw new Error('Globalping: нет id замера');
    return data.id;
}

/** Дождаться готовности замера. @returns {Promise<object>} полный результат */
async function waitResult(id, token) {
    const headers = token ? { Authorization: `Bearer ${token}` } : {};
    for (let i = 0; i < POLL_TRIES; i++) {
        await new Promise((r) => setTimeout(r, POLL_MS));
        const res = await fetch(`${API}/${id}`, { headers, signal: AbortSignal.timeout(15000) });
        if (!res.ok) continue;
        const data = await res.json().catch(() => null);
        if (data && data.status === 'finished') return data;
    }
    throw new Error('Globalping: замер не завершился за 90 секунд');
}

/** Один замер доступности с сохранением в историю. @returns {Promise<object|null>} score */
async function runCheck({ manual = false } = {}) {
    const settings = getAll();
    if (!settings.avail_enabled && !manual) return null;
    const target = settings.avail_target || config.domain;
    const port = Number(settings.avail_port || config.mtprotoPort || 8443);
    const probes = Math.min(50, Math.max(1, Number(settings.avail_probes || 10)));
    const token = settings.avail_token || null;
    try {
        const id = await createMeasurement({ target, port, probes, token });
        const data = await waitResult(id, token);
        const score = scoreResults(data.results);
        db.prepare(
            'INSERT INTO availability_checks (target, port, probes_ok, probes_total, pct, measurement_id) VALUES (?, ?, ?, ?, ?, ?)'
        ).run(target, port, score.ok, score.total, score.pct, id);
        db.prepare(
            'DELETE FROM availability_checks WHERE id NOT IN (SELECT id FROM availability_checks ORDER BY id DESC LIMIT 1000)'
        ).run();

        // Переходы через порог → уведомления (без спама)
        const prev = db.prepare(
            'SELECT pct FROM availability_checks WHERE id < (SELECT MAX(id) FROM availability_checks) ORDER BY id DESC LIMIT 1'
        ).get();
        const threshold = Number(settings.avail_threshold ?? 50);
        const wasOk = !prev || prev.pct == null || prev.pct >= threshold;
        const isOk = score.pct == null || score.pct >= threshold;
        if (wasOk && !isOk && settings.notify_services) {
            notifier.notifyAdmin(settings,
                `🌍 <b>TCP-порт прокси недоступен из России</b>\nОтвечают ${score.ok} из ${score.total} зондов (порог ${threshold}%).`);
        } else if (!wasOk && isOk && settings.notify_services) {
            notifier.notifyAdmin(settings, '🌍 <b>Доступность из России восстановлена</b>.');
        }
        return { ...score, measurementId: id };
    } catch (err) {
        logger.error('Проверка доступности не удалась', { error: err.message });
        if (manual) throw err;
        return null;
    }
}

/** История для API: последние точки + последний результат. */
function getStatus() {
    const rows = db.prepare(
        'SELECT created_at, probes_ok, probes_total, pct FROM availability_checks ORDER BY id DESC LIMIT 100'
    ).all();
    const settings = getAll();
    return {
        enabled: !!settings.avail_enabled,
        last: rows[0] || null,
        history: rows.reverse(),
    };
}

module.exports = { scoreResults, runCheck, getStatus };
