/**
 * @fileoverview Тесты разбора лимитов ресурсов движка (node:test).
 * Запуск: node --test tests/engineLimits.test.js
 */

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-for-unit-tests';

const { test, describe } = require('node:test');
const assert = require('node:assert');

const { parseBytes, usagePercent } = require('../services/engineLimits');

const MB = 1048576;

describe('parseBytes', () => {
    test('обычное число байтов', () => {
        assert.equal(parseBytes(String(512 * MB)), 512 * MB);
    });

    test('infinity означает «лимита нет»', () => {
        assert.equal(parseBytes('infinity'), null);
    });

    test('пустое значение и мусор дают null, а не NaN', () => {
        assert.equal(parseBytes(''), null);
        assert.equal(parseBytes(undefined), null);
        assert.equal(parseBytes('не число'), null);
    });
});

describe('usagePercent', () => {
    test('половина потолка — 50%', () => {
        assert.equal(usagePercent(512 * MB, 1024 * MB), 50);
    });

    test('ровно потолок — 100%', () => {
        assert.equal(usagePercent(1024 * MB, 1024 * MB), 100);
    });

    test('без потолка процент неизвестен', () => {
        assert.equal(usagePercent(512 * MB, null), null);
    });

    test('потолок ноль не даёт деления на ноль', () => {
        assert.equal(usagePercent(512 * MB, 0), null);
    });

    test('нет текущего значения — процент неизвестен', () => {
        assert.equal(usagePercent(null, 1024 * MB), null);
    });

    test('2 ГБ лимита и 512 МБ usage дают 25%, а не 0.25', () => {
        assert.equal(usagePercent(512 * MB, 2048 * MB), 25);
    });
});