const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-engine-0123456789';

const { getEngineStatus } = require('../services/engine');

describe('engine.getEngineStatus', () => {
    it('собирает разделы, недоступные даёт null', async () => {
        const deps = {
            getMeQuality: async () => ({ counters: { reconnect_success: 5 } }),
            getMePoolState: async () => { throw new Error('feature_disabled'); },
            getNatStun: async () => ({ servers: { live: 2 } }),
            getMeSelftest: async () => { throw new Error('nope'); },
            getRuntimeGates: async () => ({ reroute_active: false }),
            getUpstreams: async () => ({ summary: {} }),
            getHealthReady: async () => ({ ready: true }),
            getConfig: async () => ({ server: { api: { minimal_runtime_enabled: false } } }),
        };
        const r = await getEngineStatus(deps);
        assert.deepEqual(r.quality, { counters: { reconnect_success: 5 } });
        assert.equal(r.pool, null);
        assert.equal(r.selftest, null);
        assert.equal(r.gates.reroute_active, false);
        assert.equal(r.ready.ready, true);
        assert.deepEqual(r.flags, { minimal_runtime_enabled: false, runtime_edge_enabled: null });
    });
});
