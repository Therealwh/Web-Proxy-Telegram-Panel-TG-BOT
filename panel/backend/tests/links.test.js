/**
 * @fileoverview Тесты генерации ссылок подключения (node:test).
 * Запуск: JWT_SECRET=test node --test tests/
 */

process.env.JWT_SECRET = 'test-secret-for-unit-tests';

const { test } = require('node:test');
const assert = require('node:assert');

process.env.DOMAIN = 'proxy.example.com';
process.env.MTPROTO_PORT = '8443';

const { webProxyLink, mtprotoLink } = require('../services/links');

test('webProxyLink: формат tg://webproxy с dd-префиксом', () => {
    const secret = 'a'.repeat(32);
    const link = webProxyLink(secret);
    assert.equal(link, `tg://webproxy?server=proxy.example.com&secret=dd${secret}`);
});

test('mtprotoLink: формат tg://proxy с ee-префиксом и доменом в hex', () => {
    const secret = 'b'.repeat(32);
    const link = mtprotoLink(secret, 'www.cloudflare.com');
    const domainHex = Buffer.from('www.cloudflare.com', 'utf8').toString('hex');
    assert.equal(
        link,
        `tg://proxy?server=proxy.example.com&port=8443&secret=ee${secret}${domainHex}`
    );
});

test('mtprotoLink: ссылка парсится как URL', () => {
    const link = mtprotoLink('c'.repeat(32), 'example.com');
    // tg:// — кастомная схема, проверяем структуру вручную
    assert.ok(link.startsWith('tg://proxy?'));
    assert.ok(link.includes('port=8443'));
    assert.ok(link.includes('secret=ee'));
});
