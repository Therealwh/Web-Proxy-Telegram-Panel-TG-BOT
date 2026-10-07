/**
 * @fileoverview Расширенная телеметрия движка Telemt: ME-качество, пул,
 * NAT/STUN, самопроверка, гейты, апстримы. Каждый раздел опрашивается
 * независимо — недоступное возвращает null (зависит от флагов telemt
 * и его версии).
 * @module services/engine
 */

const telemt = require('./telemtApi');

/**
 * Собрать все разделы телеметрии.
 * @param {object} [deps] - клиент Telemt (для тестов — стаб)
 * @returns {Promise<object>} { quality, pool, natStun, selftest, gates, upstreams, ready }
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
    return out;
}

module.exports = { getEngineStatus };
