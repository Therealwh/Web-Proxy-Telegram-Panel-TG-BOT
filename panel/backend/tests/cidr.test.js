/**
 * @fileoverview Тесты разбора адресов и подсетей (node:test).
 * Ошибка здесь опасна обоих видов: правило может не сработать или,
 * наоборот, отрезать кусок интернета. Поэтому проверяем и границы, и вхождение.
 * Запуск: node --test tests/cidr.test.js
 */

const { test, describe } = require('node:test');
const assert = require('node:assert');

const { parseCidr, checkScope, contains, addressCount } = require('../utils/cidr');

const ok = (raw) => {
    const r = parseCidr(raw);
    assert.ok(r.ok, `${raw} должен разбираться, получено: ${r.error}`);
    return r;
};
const bad = (raw) => {
    const r = parseCidr(raw);
    assert.equal(r.ok, false, `${raw} должен отвергаться`);
    return r.error;
};

describe('IPv4 без маски', () => {
    test('обычный адрес превращается в /32', () => {
        const r = ok('192.0.2.5');
        assert.equal(r.cidr, '192.0.2.5/32');
        assert.equal(r.family, 4);
        assert.equal(r.prefix, 32);
    });

    test('адрес нормализуется и не меняет хостовую часть', () => {
        assert.equal(ok('8.8.4.4').cidr, '8.8.4.4/32');
    });

    test('регистр и пробелы не мешают', () => {
        assert.equal(ok('  1.1.1.1  ').cidr, '1.1.1.1/32');
    });
});

describe('IPv4 подсети', () => {
    test('сеть приводится к границе маски', () => {
        // 10.1.2.3/8 принадлежит сети 10.0.0.0/8
        assert.equal(ok('10.1.2.3/8').cidr, '10.0.0.0/8');
        assert.equal(ok('192.168.1.55/24').cidr, '192.168.1.0/24');
    });

    test('/0 допустим, но помечается как слишком широкий', () => {
        const r = ok('0.0.0.0/0');
        assert.equal(r.cidr, '0.0.0.0/0');
        assert.equal(checkScope(r).ok, false);
    });

    test('/8 проходит с предупреждением, /7 уже нет', () => {
        assert.equal(checkScope(ok('10.0.0.0/8')).ok, true);
        assert.ok(checkScope(ok('10.0.0.0/8')).warning);
        assert.equal(checkScope(ok('10.0.0.0/7')).ok, false);
    });

    test('размер подсети считается верно', () => {
        assert.equal(addressCount(ok('10.0.0.0/24')), 256);
        assert.equal(addressCount(ok('10.0.0.0/8')), 16777216);
        assert.equal(addressCount(ok('1.2.3.4/32')), 1);
    });
});

describe('отказ на некорректном вводе', () => {
    test('не IP', () => {
        bad('не адрес');
        bad('');
        bad('999.1.1.1');
        bad('1.2.3');
        bad('1.2.3.4.5');
    });

    test('маска вне диапазона', () => {
        bad('10.0.0.0/33');
        bad('10.0.0.0/-1');
        bad('10.0.0.0/abc');
    });

    test('ведущие нули отвергаются: 01.2.3.4 читается неоднозначно', () => {
        bad('01.2.3.4');
    });
});

describe('IPv6', () => {
    test('сжатая запись разбирается', () => {
        const r = ok('2001:db8::1');
        assert.equal(r.family, 6);
        assert.equal(r.cidr, '2001:db8::1/128');
    });

    test('подсеть приводится к границе', () => {
        assert.equal(ok('2001:db8::1/32').cidr, '2001:db8::/32');
    });

    test('в квадратных скобках с портом тоже понимается', () => {
        assert.equal(ok('[2001:db8::1]').ok, true);
    });

    test('две сжатые группы подряд невалидны', () => {
        bad('2001::db8::1');
    });

    test('слишком много групп', () => {
        bad('1:2:3:4:5:6:7:8:9');
    });

    test('слишком широкая подсеть IPv6 отвергается', () => {
        assert.equal(checkScope(ok('2001:db8::/8')).ok, false);
        assert.equal(checkScope(ok('2001:db8::/32')).ok, true);
    });

    test('нули сжимаются канонически', () => {
        assert.equal(ok('2001:0:0:0:0:0:0:0/128').cidr, '2001::/128');
    });
});

describe('вхождение адреса в подсеть', () => {
    test('адрес внутри подсети', () => {
        assert.ok(contains(ok('10.0.0.0/8'), '10.5.4.3'));
        assert.ok(contains(ok('192.168.1.0/24'), '192.168.1.255'));
    });

    test('адрес снаружи подсети', () => {
        assert.ok(!contains(ok('10.0.0.0/8'), '11.0.0.1'));
        assert.ok(!contains(ok('192.168.1.0/24'), '192.168.2.1'));
    });

    test('границы подсети включаются', () => {
        const p = ok('192.168.1.0/24');
        assert.ok(contains(p, '192.168.1.0'));
        assert.ok(contains(p, '192.168.1.255'));
    });

    test('смешение семейств не даёт ложного срабатывания', () => {
        assert.ok(!contains(ok('10.0.0.0/8'), '2001:db8::1'));
        assert.ok(!contains(ok('2001:db8::/32'), '10.0.0.1'));
    });

    test('/32 ловит ровно один адрес', () => {
        const p = ok('203.0.113.7/32');
        assert.ok(contains(p, '203.0.113.7'));
        assert.ok(!contains(p, '203.0.113.8'));
    });

    test('::ffff:1.2.3.4 трактуется как IPv4-адрес', () => {
        const p = parseCidr('::ffff:1.2.3.4');
        assert.equal(p.ok, true);
        assert.equal(p.family, 6);
    });
});