/**
 * @fileoverview Расширенная телеметрия движка Telemt: ME-качество, пул,
 * NAT/STUN, самопроверка, гейты, апстримы. Каждый раздел опрашивается
 * независимо — недоступное возвращает null (зависит от флагов telemt
 * и его версии).
 * @module services/engine
 */

const telemt = require('./telemtApi');

/**
 * Собрать все разделы телеметрии + флаги расширенной телеметрии из конфига.
 * @param {object} [deps] - клиент Telemt (для тестов — стаб)
 * @returns {Promise<object>} { quality, pool, natStun, selftest, gates, upstreams, ready, flags, errors }
 */
async function getEngineStatus(deps = telemt) {
    const jobs = {
        quality: () => deps.getMeQuality(),
        pool: () => deps.getMePoolState(),
        natStun: () => deps.getNatStun(),
        selftest: () => deps.getMeSelftest(),
        gates: () => deps.getRuntimeGates(),
        upstreams: () => deps.getUpstreams(),
        ready: () => deps.getHealthReady(),
    };
    const out = {};
    out.errors = {};
    for (const [key, fn] of Object.entries(jobs)) {
        try {
            const v = await fn();
            // Часть эндпоинтов при выключенной фиче отдаёт HTTP 200 с конвертом
            // {enabled, reason?, generated_at_epoch_secs?, data: null} — разворачиваем
            if (v && typeof v === 'object' && !Array.isArray(v) && 'data' in v
                && (v.enabled !== undefined || v.reason !== undefined)) {
                out[key] = v.data ?? null;
                if (!out[key]) {
                    out.errors[key] = v.reason || 'нет данных';
                }
            } else {
                out[key] = v ?? null;
                if (out[key] == null) out.errors[key] = 'нет данных';
            }
        } catch (e) {
            out[key] = null;
            out.errors[key] = String(e?.message || e).slice(0, 200);
        }
    }
    // Флаги расширенной телеметрии из конфига (фронт решает, показывать ли кнопку включения)
    out.flags = { minimal_runtime_enabled: null, runtime_edge_enabled: null };
    try {
        const cfg = await deps.getConfig();
        const api = cfg?.server?.api || {};
        out.flags = {
            minimal_runtime_enabled: api.minimal_runtime_enabled ?? null,
            runtime_edge_enabled: api.runtime_edge_enabled ?? null,
        };
    } catch (e) {
        out.errors.config = String(e?.message || e).slice(0, 200);
    }
    // Версия движка — чтобы отличать «флаги выключены» от «telemt старый, эндпоинтов нет»
    try {
        out.system = await deps.getSystemInfo();
    } catch {
        out.system = null;
    }
    return out;
}

module.exports = { getEngineStatus };
