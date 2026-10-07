const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-avail-0123456789';
process.env.DB_PATH = path.join(__dirname, 'test-avail-tmp.db');
after(() => {
    for (const suf of ['', '-wal', '-shm', '-journal']) {
        try { fs.unlinkSync(path.join(__dirname, 'test-avail-tmp.db' + suf)); } catch { /* ignore */ }
    }
});

const { scoreResults } = require('../services/availability');

describe('availability.scoreResults', () => {
    it('считает долю успешных пробов', () => {
        const r = scoreResults([
            { status: 'success' }, { status: 'success' }, { status: 'failed' }, { status: 'failed' },
        ]);
        assert.deepEqual(r, { ok: 2, total: 4, pct: 50 });
    });

    it('все успешны → 100', () => {
        assert.deepEqual(scoreResults([{ status: 'success' }]), { ok: 1, total: 1, pct: 100 });
    });

    it('пусто / мусор → pct null', () => {
        for (const v of [[], null, undefined]) {
            const r = scoreResults(v);
            assert.equal(r.pct, null);
            assert.equal(r.ok, 0);
        }
        assert.deepEqual(scoreResults([null, {}]), { ok: 0, total: 2, pct: 0 });
    });
});
