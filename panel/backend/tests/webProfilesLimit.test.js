/**
 * Тесты лимита WEB-профилей: хранение в settings, обрезка списка
 * клиентов с учётом служебного welcome, дефолт 32.
 *
 * Каждый тест — независимый: уникальные имена клиентов и сброс мока
 * между тестами (общая БД миграционная, чистим только данные).
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.DB_PATH = path.join(os.tmpdir(), 'tggate-limit-test.db');
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret';
process.env.TELEMT_API = process.env.TELEMT_API || 'http://127.0.0.1:9091';
process.env.TELEMT_API_AUTH = process.env.TELEMT_API_AUTH || 'test';
process.env.DOMAIN = process.env.DOMAIN || 'web.example.com';

const { test, describe, before } = require('node:test');
const assert = require('node:assert');

const calls = [];
const telemtMock = {
    /** Текущий лимит в «движке» — тесты меняют. */
    engineLimit: 32,
    getConfig: async () => ({
        web: {
            limits: { max_profiles: telemtMock.engineLimit },
            vhosts: [{ host: 'web.example.com', profiles: [] }],
        },
    }),
    patchConfig: async (patch, reload) => {
        calls.push({ patch, reload });
        // Эмулируем применение: движок запоминает лимит
        if (patch.web && patch.web.limits) telemtMock.engineLimit = patch.web.limits.max_profiles;
        return { ok: true };
    },
};
require.cache[require.resolve('../services/telemtApi')] = {
    id: require.resolve('../services/telemtApi'),
    filename: require.resolve('../services/telemtApi'),
    loaded: true,
    exports: telemtMock,
};

const db = require('../db');
const webProfiles = require('../services/webProfiles');

let seq = 0;
const addClient = (web = 1) => {
    seq += 1;
    db.prepare('INSERT INTO clients (username, secret, web_enabled) VALUES (?, ?, ?)')
        .run('user' + seq, 'a'.repeat(32), web);
    return 'user' + seq;
};
const setLimit = (v) => {
    db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
        .run('web_max_profiles', String(JSON.stringify(v)));
};

describe('лимит WEB-профилей', () => {
    before(() => {
        db.prepare('DELETE FROM settings').run();
        db.prepare('DELETE FROM clients').run();
    });

    test('дефолтный лимит — 32 (как в движке)', () => {
        assert.equal(webProfiles.configuredLimit(), 32);
        assert.equal(webProfiles.DEFAULT_LIMIT, 32);
    });

    test('сохранённый лимит читается из settings', () => {
        setLimit(100);
        assert.equal(webProfiles.configuredLimit(), 100);
    });

    test('битое значение в settings откатывается на дефолт', () => {
        setLimit('мусор');
        assert.equal(webProfiles.configuredLimit(), 32);
    });

    test('клиенты обрезаются до лимита минус служебный welcome', async () => {
        setLimit(10);
        for (let i = 0; i < 15; i++) addClient();

        await webProfiles.syncWebProfiles();

        const patchProfiles = calls.find((c) => c.patch.web && c.patch.web.vhosts);
        assert.ok(patchProfiles, 'PATCH с vhosts не отправлен');
        const profiles = patchProfiles.patch.web.vhosts[0].profiles;
        assert.equal(profiles.length, 10, '1 welcome + 9 клиентов');
        assert.equal(profiles[0].user, 'welcome');
    });

    test('лимит применяется в конфиг движка, если отличается', async () => {
        setLimit(100);
        calls.length = 0;
        await webProfiles.syncWebProfiles();
        const limitPatch = calls.find((c) => c.patch.web && c.patch.web.limits);
        assert.ok(limitPatch, 'PATCH с limits не отправлен');
        assert.equal(limitPatch.patch.web.limits.max_profiles, 100);
        assert.equal(telemtMock.engineLimit, 100, 'движок не применил лимит');
    });

    test('лимит не патчится, если совпадает с текущим', async () => {
        // движок уже принял 100 в прошлом тесте
        telemtMock.engineLimit = 100;
        addClient();
        calls.length = 0;
        await webProfiles.syncWebProfiles();
        const limitPatch = calls.find((c) => c.patch.web && c.patch.web.limits);
        assert.equal(limitPatch, undefined, 'лишний PATCH с limits');
    });

    test('клиент с выключенным Web Proxy не получает профиль', async () => {
        const off = addClient(0);
        const on = addClient(1);
        calls.length = 0;
        await webProfiles.syncWebProfiles();
        const patchProfiles = calls.find((c) => c.patch.web && c.patch.web.vhosts);
        const users = patchProfiles.patch.web.vhosts[0].profiles.map((p) => p.user);
        assert.ok(users.includes(on));
        assert.ok(!users.includes(off));
    });
});