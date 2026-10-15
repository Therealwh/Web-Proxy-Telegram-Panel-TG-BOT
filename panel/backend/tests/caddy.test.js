/**
 * Тесты Caddy-сервисса: дедупликация сайтов и валидация.
 *
 * Регрессия на реальный инцидент: дубль status.vpstg.run в Caddyfile
 * валиден для человека, но Caddy отказывается стартовать с «ambiguous
 * site definition». Порт 443 оставался неслушанным — сайт и веб-прокси
 * падали целиком.
 */
const { test, describe } = require('node:test');
const assert = require('node:assert');
const { dedupeSites } = require('../services/caddy');

describe('дедупликация сайтов в Caddyfile', () => {
    test('дубль сайта удаляется, первый блок остаётся', () => {
        const src = `web.example.com {
	reverse_proxy 127.0.0.1:8080
}

status.example.com {
	reverse_proxy 127.0.0.1:3000
}

status.example.com {
	reverse_proxy 127.0.0.1:3001
}
`;
        const { text, removed } = dedupeSites(src);
        assert.deepEqual(removed, ['status.example.com']);
        assert.equal((text.match(/status\.example\.com/g) || []).length, 1);
        // Первый блок не тронут: порт остался 3000
        assert.match(text, /reverse_proxy 127\.0\.0\.1:3000/);
        assert.doesNotMatch(text, /3001/);
    });

    test('глобальный блок в начале не считается сайтом', () => {
        const src = `{
	email admin@example.com
}

web.example.com {
	reverse_proxy 127.0.0.1:8080
}
`;
        const { text, removed } = dedupeSites(src);
        assert.deepEqual(removed, []);
        assert.match(text, /email admin@example\.com/);
        assert.match(text, /web\.example\.com/);
    });

    test('вложенные фигурные скобки не ломают разбор блока', () => {
        const src = `web.example.com {
	header {
		-Server
	}
	reverse_proxy 127.0.0.1:8080
}

web.example.com {
	reverse_proxy 127.0.0.1:9999
}
`;
        const { text, removed } = dedupeSites(src);
        assert.deepEqual(removed, ['web.example.com']);
        // Первый блок выжил целиком, включая вложенный header
        assert.match(text, /-Server/);
        assert.doesNotMatch(text, /9999/);
    });

    test('конфиг без дубликатов не меняется', () => {
        const src = `{
	email a@b.c
}

a.example.com {
	reverse_proxy 127.0.0.1:1
}

b.example.com {
	reverse_proxy 127.0.0.1:2
}
`;
        const { text, removed } = dedupeSites(src);
        assert.deepEqual(removed, []);
        assert.equal(text, src);
    });

    test('пустой файл и файл без сайтов не падают', () => {
        assert.deepEqual(dedupeSites('').removed, []);
        const { text } = dedupeSites('# только комментарий\n');
        assert.match(text, /только комментарий/);
    });

    test('реальный кейс: дубль status-домена из инцидента', () => {
        // Воспроизведение конфигурации с сервера до починки
        const src = `{
	email therealwh@gmail.com
}

web.vpstg.run {
	reverse_proxy 127.0.0.1:8080
}

status.vpstg.run {
	reverse_proxy 127.0.0.1:3000
}

status.vpstg.run {
	reverse_proxy 127.0.0.1:3000
}
`;
        const { text, removed } = dedupeSites(src);
        assert.deepEqual(removed, ['status.vpstg.run']);
        const sites = [...text.matchAll(/^([\w.-]+) \{/gm)].map((m) => m[1]);
        assert.deepEqual(sites.sort(), ['status.vpstg.run', 'web.vpstg.run']);
    });
});