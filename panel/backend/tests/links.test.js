/**
 * @fileoverview Тесты генерации ссылок подключения (node:test).
 * Запуск: node --test tests/links.test.js
 */

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-for-unit-tests';
process.env.DOMAIN = 'proxy.example.com';
process.env.MTPROTO_PORT = '8443';
// Изолированная БД: clientLinks без override читает настройки
const fs = require('fs');
const path = require('path');
process.env.DB_PATH = path.join(__dirname, 'test-links-tmp.db');

const { test, describe, after } = require('node:test');
const assert = require('node:assert');

after(() => {
    for (const suf of ['', '-wal', '-shm', '-journal']) {
        try { fs.unlinkSync(path.join(__dirname, 'test-links-tmp.db' + suf)); } catch { /* ignore */ }
    }
});

const { webProxyLink, mtprotoLink, webProxyLinkHttps, mtprotoLinkHttps, clientLinks } = require('../services/links');

const client = { secret: 'a'.repeat(32), web_enabled: true, mtproto_enabled: true };

describe('webProxyLink', () => {
    test('формат tg://webproxy с dd-префиксом', () => {
        const link = webProxyLink('a'.repeat(32));
        assert.equal(link, `tg://webproxy?server=proxy.example.com&secret=dd${'a'.repeat(32)}`);
    });

    test('переопределение домена', () => {
        const link = webProxyLink('a'.repeat(32), 'web.proxy.example.com');
        assert.equal(link, `tg://webproxy?server=web.proxy.example.com&secret=dd${'a'.repeat(32)}`);
    });

    test('https-вариант с переопределением', () => {
        const link = webProxyLinkHttps('a'.repeat(32), 'web.proxy.example.com');
        assert.equal(link, `https://t.me/webproxy?server=web.proxy.example.com&secret=dd${'a'.repeat(32)}`);
    });
});

describe('mtprotoLink', () => {
    test('формат tg://proxy с dd-префиксом (Secure)', () => {
        const link = mtprotoLink('b'.repeat(32));
        assert.equal(link, `tg://proxy?server=proxy.example.com&port=8443&secret=dd${'b'.repeat(32)}`);
    });

    test('переопределение домена', () => {
        const link = mtprotoLink('b'.repeat(32), 'mtproto.proxy.example.com');
        assert.equal(link, `tg://proxy?server=mtproto.proxy.example.com&port=8443&secret=dd${'b'.repeat(32)}`);
    });

    test('https-вариант с переопределением', () => {
        const link = mtprotoLinkHttps('b'.repeat(32), 'mtproto.proxy.example.com');
        assert.equal(link, `https://t.me/proxy?server=mtproto.proxy.example.com&port=8443&secret=dd${'b'.repeat(32)}`);
    });

    test('ссылка парсится как URL', () => {
        const link = mtprotoLink('c'.repeat(32));
        assert.ok(link.startsWith('tg://proxy?'));
        assert.ok(link.includes('port=8443'));
        assert.ok(link.includes('secret=dd'));
    });
});

describe('clientLinks', () => {
    test('без настроек — общий domain из конфига', () => {
        const links = clientLinks(client, null, {});
        assert.ok(links.web.includes('server=proxy.example.com'));
        assert.ok(links.mtproto.includes('server=proxy.example.com'));
        assert.ok(links.web_https.includes('server=proxy.example.com'));
        assert.ok(links.mtproto_https.includes('server=proxy.example.com'));
    });

    test('раздельные домены из override', () => {
        const links = clientLinks(client, null, {
            web: 'web.proxy.example.com',
            mtproto: 'mtproto.proxy.example.com',
        });
        assert.ok(links.web.includes('server=web.proxy.example.com'));
        assert.ok(links.mtproto.includes('server=mtproto.proxy.example.com'));
        assert.ok(links.web_https.includes('server=web.proxy.example.com'));
        assert.ok(links.mtproto_https.includes('server=mtproto.proxy.example.com'));
    });

    test('null в override — откат на общий domain', () => {
        const links = clientLinks(client, null, { web: null, mtproto: null });
        assert.ok(links.web.includes('server=proxy.example.com'));
        assert.ok(links.mtproto.includes('server=proxy.example.com'));
    });

    test('выключенные протоколы — null в ссылках', () => {
        const links = clientLinks(
            { secret: 'a'.repeat(32), web_enabled: false, mtproto_enabled: true },
            null, { web: 'web.proxy.example.com' }
        );
        assert.equal(links.web, null);
        assert.equal(links.web_https, null);
        assert.ok(links.mtproto.includes('server=proxy.example.com'));
    });
});
