const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// Изолированная временная БД: заодно проверяет миграцию 014_dc_monitor.sql
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-dc-monitor-0123456789';
process.env.DB_PATH = path.join(__dirname, 'test-dc-tmp.db');
after(() => {
    for (const suf of ['', '-wal', '-shm', '-journal']) {
        try { fs.unlinkSync(path.join(__dirname, 'test-dc-tmp.db' + suf)); } catch { /* ignore */ }
    }
});

const { evaluateDc } = require('../services/dcMonitor');

const okDc = (dc, coverage = 100, extra = {}) => ({
    dc, coverage_pct: coverage, rtt_ms: 20, alive_writers: 4, required_writers: 2, ...extra,
});

describe('dcMonitor.evaluateDc', () => {
    it('все DC здоровы → ok', () => {
        const r = evaluateDc({ dcs: [okDc(1), okDc(2), okDc(4), okDc(5)] }, 50);
        assert.equal(r.overall, 'ok');
        assert.equal(r.degraded.length, 0);
        assert.equal(r.perDc.length, 4);
    });

    it('один DC ниже порога → partial', () => {
        const r = evaluateDc({ dcs: [okDc(1), okDc(2, 10), okDc(4), okDc(5)] }, 50);
        assert.equal(r.overall, 'partial');
        assert.deepEqual(r.degraded, [2]);
    });

    it('все DC ниже порога → degraded (триггер рестарта)', () => {
        const r = evaluateDc({ dcs: [okDc(1, 0), okDc(2, 5)] }, 50);
        assert.equal(r.overall, 'degraded');
        assert.equal(r.shouldRestart, true);
    });

    it('alive < required → degraded даже при покрытии', () => {
        const r = evaluateDc({ dcs: [okDc(1, 100, { alive_writers: 0, required_writers: 2 })] }, 50);
        assert.equal(r.overall, 'degraded');
        assert.deepEqual(r.degraded, [1]);
    });

    it('граница порога: coverage == threshold → ok', () => {
        const r = evaluateDc({ dcs: [okDc(1, 50)] }, 50);
        assert.equal(r.overall, 'ok');
    });

    it('пусто / нет данных → unknown, рестарта нет', () => {
        for (const payload of [null, {}, { dcs: [] }]) {
            const r = evaluateDc(payload, 50);
            assert.equal(r.overall, 'unknown');
            assert.equal(r.shouldRestart, false);
        }
    });

    it('rtt_ms пробрасывается как есть (включая null)', () => {
        const r = evaluateDc({ dcs: [{ dc: 1, coverage_pct: 90, rtt_ms: null, alive_writers: 2, required_writers: 2 }] }, 50);
        assert.equal(r.perDc[0].rtt_ms, null);
    });
});
