/**
 * @fileoverview Тесты перебора WEB-носителей (node:test).
 * Проверяем правила, которые иначе приводят к падению конфига Telemt.
 * Запуск: node --test tests/webCarriers.test.js
 */

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-for-unit-tests';
process.env.DB_PATH = process.env.DB_PATH || require('path').join(__dirname, 'test-carriers-tmp.db');

const fs = require('fs');
const path = require('path');
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert');

const webCarriers = require('../services/webCarriers');
const { normalize, ALL_CARRIERS, FALLBACK_CARRIER, MAX_CANDIDATES } = webCarriers;

before(() => { require('../db'); });

after(() => {
    for (const suf of ['', '-wal', '-shm', '-journal']) {
        try { fs.unlinkSync(path.join(__dirname, 'test-carriers-tmp.db' + suf)); } catch { /* ignore */ }
    }
});

describe('нормализация списка носителей', () => {
    test('пустой массив — перебор выключен', () => {
        assert.deepEqual(normalize([]), []);
        assert.deepEqual(normalize(null), []);
        assert.deepEqual(normalize(false), []);
        assert.deepEqual(normalize(''), []);
    });

    test('https убирается: он всегда идёт запасным', () => {
        assert.deepEqual(normalize(['https', 'websocket']), ['websocket']);
    });

    test('порядок сохраняется', () => {
        assert.deepEqual(normalize(['websocket', 'https-lanes']), ['websocket', 'https-lanes']);
    });

    test('строка через запятую разбирается', () => {
        assert.deepEqual(normalize('websocket, websocket-lanes'), ['websocket', 'websocket-lanes']);
    });

    test('JSON-строка разбирается', () => {
        assert.deepEqual(normalize('["websocket"]'), ['websocket']);
    });

    test('неизвестный носитель отвергается', () => {
        assert.throws(() => normalize(['carrier-pigeon']), /Неизвестный носитель/);
    });

    test('дубликаты отвергаются', () => {
        assert.throws(() => normalize(['websocket', 'websocket']), /Повтор/);
    });

    test('весь набор носителей помещается в лимит Telemt', () => {
        // Telemt не даёт набор шире четырёх: кандидаты + запасной.
        const all = ALL_CARRIERS.filter((c) => c !== FALLBACK_CARRIER);
        assert.equal(all.length, MAX_CANDIDATES);
        assert.equal(MAX_CANDIDATES + 1, 4);
        assert.deepEqual(normalize(all), all);
    });

    test('набор из всех четырёх носителей принимается (https убирается как запасной)', () => {
        assert.deepEqual(normalize([...ALL_CARRIERS]), ALL_CARRIERS.filter((c) => c !== FALLBACK_CARRIER));
    });

    test('запасной https всегда доступен и неизменяем', () => {
        assert.equal(FALLBACK_CARRIER, 'https');
        assert.ok(ALL_CARRIERS.includes(FALLBACK_CARRIER));
    });

    test('lanes-варианты входят в список поддерживаемых', () => {
        assert.ok(ALL_CARRIERS.includes('https-lanes'));
        assert.ok(ALL_CARRIERS.includes('websocket-lanes'));
    });
});

describe('состояние перебора', () => {
    test('состояние содержит запасной вариант и признак перезапуска', () => {
        const s = webCarriers.getState();
        assert.equal(s.fallback, 'https');
        assert.equal(typeof s.needsRestart, 'boolean');
        assert.ok(Array.isArray(s.candidates));
        assert.ok(Array.isArray(s.supported));
    });
});