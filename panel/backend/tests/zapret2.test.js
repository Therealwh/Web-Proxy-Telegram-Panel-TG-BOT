/**
 * @fileoverview Тесты zapret2: разбор очередей ядра и конфига nfqws2.
 */

const { test, describe } = require('node:test');
const assert = require('node:assert');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-zapret2-0123456789';

const { queueBound, parseConf } = require('../routes/zapret2');

describe('zapret2.queueBound', () => {
    test('находит нашу очередь в выводе nfnetlink_queue', () => {
        const proc = '0 0 0 0 0 0\n200 0 262144 20 65535 262144\n';
        assert.equal(queueBound(proc, 200), true);
    });

    test('нет нашей очереди → false', () => {
        const proc = '0 0 0 0 0 0\n300 0 262144 20 65535 262144\n';
        assert.equal(queueBound(proc, 200), false);
    });

    test('пустой ввод → false', () => {
        assert.equal(queueBound('', 200), false);
        assert.equal(queueBound(null, 200), false);
    });

    test('не путает 200 с 2000', () => {
        const proc = '2000 0 262144 20 65535 262144\n';
        assert.equal(queueBound(proc, 200), false);
    });
});

describe('zapret2.parseConf', () => {
    test('читает --qnum и --filter-tcp из конфига', () => {
        const conf = '--qnum 200\n--fwmark=0x40000000\n--filter-tcp=8443\n';
        assert.equal(parseConf(conf, 'qnum'), '200');
        assert.equal(parseConf(conf, 'filter-tcp'), '8443');
    });

    test('нет опции → null', () => {
        assert.equal(parseConf('--qnum 200\n', 'filter-tcp'), null);
        assert.equal(parseConf('', 'qnum'), null);
    });
});
