/**
 * @fileoverview Тесты политики маскировки (node:test).
 * Здесь важна валидация адреса selfmask: неверный адрес уводит Telemt
 * в аварийный режим, поэтому проверяем строго.
 * Запуск: node --test tests/masking.test.js
 */

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-for-unit-tests';

const { test, describe } = require('node:test');
const assert = require('node:assert');

const { SNI_ACTIONS, SNI_ACTION_LABELS, isPrivateHost, validateUpstream } = require('../services/masking');

describe('политика SNI', () => {
    test('доступны все четыре действия из документации Telemt', () => {
        assert.deepEqual(SNI_ACTIONS, ['drop', 'mask', 'accept', 'reject_handshake']);
    });

    test('у каждого действия есть описание для интерфейса', () => {
        for (const a of SNI_ACTIONS) {
            assert.ok(SNI_ACTION_LABELS[a] && SNI_ACTION_LABELS[a].length > 5, `нет описания для ${a}`);
        }
    });
});

describe('приватность адреса', () => {
    test('loopback и приватные сети принимаются', () => {
        for (const ip of ['127.0.0.1', '10.0.0.5', '172.16.4.4', '192.168.1.1', '169.254.1.1', '::1']) {
            assert.ok(isPrivateHost(ip), `${ip} должен считаться приватным`);
        }
    });

    test('публичные адреса и домены не принимаются', () => {
        for (const h of ['8.8.8.8', '1.1.1.1', 'example.com', '203.0.113.5']) {
            assert.ok(!isPrivateHost(h), `${h} не должен считаться приватным`);
        }
    });

    test('172.32 снаружи приватного диапазона', () => {
        assert.ok(!isPrivateHost('172.32.0.1'));
        assert.ok(isPrivateHost('172.31.255.255'));
    });
});

describe('адрес бэкенда selfmask', () => {
    test('принимается приватный IP с портом', () => {
        const r = validateUpstream('127.0.0.1:8099');
        assert.equal(r.ok, true);
        assert.equal(r.upstream, 'http://127.0.0.1:8099');
    });

    test('схема http:// добавляется, но не дублируется', () => {
        assert.equal(validateUpstream('http://10.0.0.1:9000').upstream, 'http://10.0.0.1:9000');
    });

    test('https:// отвергается с понятным объяснением', () => {
        const r = validateUpstream('https://127.0.0.1:8099');
        assert.equal(r.ok, false);
        assert.match(r.error, /только http/);
    });

    test('доменное имя отвергается', () => {
        const r = validateUpstream('example.com:8099');
        assert.equal(r.ok, false);
        assert.match(r.error, /приватный IP/);
    });

    test('путь и логин запрещены', () => {
        assert.equal(validateUpstream('127.0.0.1:8099/site').ok, false);
        assert.equal(validateUpstream('user@127.0.0.1:8099').ok, false);
    });

    test('пустой адрес отвергается', () => {
        assert.equal(validateUpstream('').ok, false);
        assert.equal(validateUpstream(null).ok, false);
    });

    test('порт вне диапазона отвергается', () => {
        assert.equal(validateUpstream('127.0.0.1:0').ok, false);
        assert.equal(validateUpstream('127.0.0.1:70000').ok, false);
    });

    test('адрес без порта отвергается', () => {
        assert.equal(validateUpstream('127.0.0.1').ok, false);
    });

    test('IPv6 в скобках разбирается', () => {
        assert.equal(validateUpstream('[::1]:8099').ok, true);
    });
});