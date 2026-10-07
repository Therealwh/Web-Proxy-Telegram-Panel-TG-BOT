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
    it('считает долю успешных пробов (по rawOutput)', () => {
        const r = scoreResults([
            { result: { rawOutput: 'Reply from example.com (1.2.3.4) on port 8443: Succeeded in 20 ms' } },
            { result: { rawOutput: 'Reply from example.com (1.2.3.4) on port 8443: Succeeded in 22 ms' } },
            { result: { rawOutput: 'No reply from example.com (1.2.3.4) on port 8443.' } },
            { result: { rawOutput: 'Request timed out for example.com.' } },
        ]);
        assert.deepEqual(r, { ok: 2, total: 4, pct: 50 });
    });

    it('все успешны → 100', () => {
        assert.deepEqual(
            scoreResults([{ result: { rawOutput: 'Reply from example.com in 5 ms' } }]),
            { ok: 1, total: 1, pct: 100 }
        );
    });

    it('пусто / мусор → pct null', () => {
        for (const v of [[], null, undefined]) {
            const r = scoreResults(v);
            assert.equal(r.pct, null);
            assert.equal(r.ok, 0);
        }
        assert.deepEqual(scoreResults([null, {}]), { ok: 0, total: 2, pct: 0 });
    });

    it('пустой rawOutput — не успех', () => {
        assert.deepEqual(scoreResults([{ result: { status: 'finished' } }]), { ok: 0, total: 1, pct: 0 });
    });
});
