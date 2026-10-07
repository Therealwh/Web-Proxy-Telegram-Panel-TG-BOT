const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-tlsfp-0123456789';
process.env.DB_PATH = path.join(__dirname, 'test-tlsfp-tmp.db');
after(() => {
    for (const suf of ['', '-wal', '-shm', '-journal']) {
        try { fs.unlinkSync(path.join(__dirname, 'test-tlsfp-tmp.db' + suf)); } catch { /* ignore */ }
    }
});

const { mergeFp } = require('../services/tlsFp');

const base = {
    fp: 'fp1', ja3: 'j3', ja4: 'j4',
    total: 100, auth_success: 90, bad_or_probe: 10,
    first_seen: '2026-10-01T00:00:00Z', last_seen: '2026-10-02T00:00:00Z',
};

describe('tlsFp.mergeFp', () => {
    it('без накопленного — берёт входящую как есть', () => {
        assert.deepEqual(mergeFp(null, { ...base }), base);
    });

    it('рост счётчиков — берёт максимум', () => {
        const m = mergeFp(base, { ...base, total: 150, auth_success: 140, bad_or_probe: 10 });
        assert.equal(m.total, 150);
        assert.equal(m.auth_success, 140);
        assert.equal(m.first_seen, '2026-10-01T00:00:00Z');
    });

    it('сброс счётчика (рестарт движка) — накапливает поверх', () => {
        const m = mergeFp(base, { ...base, total: 20, auth_success: 18, bad_or_probe: 2 });
        assert.equal(m.total, 120);
        assert.equal(m.auth_success, 108);
        assert.equal(m.bad_or_probe, 12);
    });
});
