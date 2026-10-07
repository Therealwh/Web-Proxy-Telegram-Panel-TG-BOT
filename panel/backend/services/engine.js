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
 * @returns {Promise<object>} { quality, pool, natStun, selftest, gates, upstreams, ready, flags }
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
    for (const [key, fn] of Object.entries(jobs)) {
        try {
            out[key] = await fn();
        } catch {
            out[key] = null;
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
    } catch {
        /* конфиг недоступен — флаги неизвестны */
    }
    return out;
}

module.exports = { getEngineStatus };
