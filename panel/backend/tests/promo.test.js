/**
 * Тесты промокодов v2: дни/скидка, аудитория, per-user.
 * Отдельная in-memory SQLite — рабочая БД не трогается.
 * Запуск: JWT_SECRET=test node --test tests/promo.test.js
 */

const test = require('node:test');
const assert = require('node:assert');
const Database = require('better-sqlite3');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-promo-0123456789';

function makeDb() {
    const db = new Database(':memory:');
    db.exec(`
        CREATE TABLE promo_codes (
            code TEXT PRIMARY KEY, discount_percent REAL, discount_fixed REAL,
            first_payment_only INTEGER NOT NULL DEFAULT 0, max_uses INTEGER,
            used_count INTEGER NOT NULL DEFAULT 0, expires_at TEXT,
            enabled INTEGER NOT NULL DEFAULT 1,
            kind TEXT NOT NULL DEFAULT 'percent', audience TEXT NOT NULL DEFAULT 'all',
            days INTEGER, one_per_user INTEGER NOT NULL DEFAULT 1
        );
        CREATE TABLE promo_uses (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            promo_code TEXT NOT NULL, telegram_id INTEGER NOT NULL,
            used_at TEXT NOT NULL DEFAULT (datetime('now')),
            UNIQUE(promo_code, telegram_id)
        );
        CREATE TABLE bot_users (
            telegram_id INTEGER PRIMARY KEY, username TEXT, first_name TEXT,
            last_name TEXT, seen_at TEXT NOT NULL DEFAULT (datetime('now')),
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            balance REAL NOT NULL DEFAULT 0, pending_promo TEXT
        );
        CREATE TABLE clients (
            id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT NOT NULL,
            secret TEXT, expires_at TEXT, telegram_id INTEGER,
            web_enabled INTEGER DEFAULT 1, mtproto_enabled INTEGER DEFAULT 1,
            max_ips INTEGER, status TEXT NOT NULL DEFAULT 'active', node_id INTEGER
        );
        CREATE TABLE payments (
            id INTEGER PRIMARY KEY AUTOINCREMENT, tariff_id INTEGER,
            amount REAL, currency TEXT, provider TEXT, status TEXT,
            telegram_id INTEGER, client_id INTEGER, promo_code TEXT
        );
        CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT);
    `);
    return db;
}

function inject(db) {
    const dbPath = require.resolve('../db');
    require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: db };
    // Заглушка Telemt: createUser/patchUser без сети
    const telemtPath = require.resolve('../services/telemtApi');
    require.cache[telemtPath] = {
        id: telemtPath, filename: telemtPath, loaded: true,
        exports: { createUser: async (d) => ({ secret: 'a'.repeat(32), ...d }), patchUser: async () => ({}) },
    };
    for (const mod of ['../services/promo', '../utils/balance', '../routes/settings']) {
        delete require.cache[require.resolve(mod)];
    }
    return require('../services/promo');
}

function seed(db) {
    db.prepare("INSERT INTO bot_users (telegram_id, first_name) VALUES (100, 'Новенький'), (200, 'Действующий')").run();
    // 200 — действующий (есть активный прокси и покупка), 100 — новый
    db.prepare("INSERT INTO clients (username, secret, telegram_id, status) VALUES ('tg200x1', 's', 200, 'active')").run();
    db.prepare("INSERT INTO payments (telegram_id, status, amount) VALUES (200, 'success', 100)").run();
}

function addDaysPromo(db, code, audience, days, onePerUser = 1) {
    db.prepare(
        "INSERT INTO promo_codes (code, kind, audience, days, one_per_user, enabled) VALUES (?, 'days', ?, ?, ?, 1)"
    ).run(code, audience, days, onePerUser);
}

function addPercentPromo(db, code, audience, percent, onePerUser = 1) {
    db.prepare(
        "INSERT INTO promo_codes (code, kind, audience, discount_percent, one_per_user, enabled) VALUES (?, 'percent', ?, ?, ?, 1)"
    ).run(code, audience, percent, onePerUser);
}

test('validate: несуществующий и выключенный промокод отклоняются', () => {
    const db = makeDb(); seed(db);
    const promo = inject(db);
    assert.strictEqual(promo.validate('NOPE', 100).ok, false);
    addDaysPromo(db, 'X1', 'new', 7);
    db.prepare("UPDATE promo_codes SET enabled = 0 WHERE code = 'X1'").run();
    assert.strictEqual(promo.validate('X1', 100).ok, false, 'выключенный отклонён');
});

test('validate: истёкший срок и исчерпанный лимит', () => {
    const db = makeDb(); seed(db);
    const promo = inject(db);
    db.prepare("INSERT INTO promo_codes (code, kind, audience, days, expires_at) VALUES ('OLD', 'days', 'all', 3, '2020-01-01')").run();
    assert.strictEqual(promo.validate('OLD', 100).error, 'Срок действия промокода истёк');
    db.prepare("INSERT INTO promo_codes (code, kind, audience, days, max_uses, used_count) VALUES ('FULL', 'days', 'all', 3, 1, 1)").run();
    assert.strictEqual(promo.validate('FULL', 100).error, 'Лимит применений промокода исчерпан');
});

test('validate: per-user — повторное применение отклоняется', () => {
    const db = makeDb(); seed(db);
    const promo = inject(db);
    addDaysPromo(db, 'ONCE', 'all', 5);
    assert.strictEqual(promo.validate('ONCE', 100).ok, true);
    db.prepare("INSERT INTO promo_uses (promo_code, telegram_id) VALUES ('ONCE', 100)").run();
    assert.strictEqual(promo.validate('ONCE', 100).error, 'Вы уже применяли этот промокод');
});

test('validate: one_per_user=0 разрешает повтор', () => {
    const db = makeDb(); seed(db);
    const promo = inject(db);
    addDaysPromo(db, 'MANY', 'all', 5, 0);
    db.prepare("INSERT INTO promo_uses (promo_code, telegram_id) VALUES ('MANY', 100)").run();
    assert.strictEqual(promo.validate('MANY', 100).ok, true);
});

test('days/new: новенькому создаётся прокси, действующему — отказ', async () => {
    const db = makeDb(); seed(db);
    const promo = inject(db);
    addDaysPromo(db, 'NEW7', 'new', 7);

    const r = await promo.applyDaysPromo(promo.getPromo('NEW7'), 100);
    assert.strictEqual(r.ok, true);
    assert.ok(r.created, 'прокси создан');
    const row = db.prepare('SELECT * FROM clients WHERE username = ?').get(r.created);
    assert.ok(row && row.status === 'active');
    const days = (new Date(row.expires_at) - new Date()) / 86400000;
    assert.ok(days > 6.9 && days < 7.1, `срок ≈ 7 дней (${days})`);

    const denied = await promo.applyDaysPromo(promo.getPromo('NEW7'), 200);
    assert.strictEqual(denied.ok, false, 'действующему отказано');
});

test('days/all: продлеваются все активные прокси', async () => {
    const db = makeDb(); seed(db);
    const promo = inject(db);
    // Второй прокси действующему пользователю
    db.prepare("INSERT INTO clients (username, secret, telegram_id, status) VALUES ('tg200x2', 's2', 200, 'active')").run();
    addDaysPromo(db, 'ALL5', 'all', 5);

    const r = await promo.applyDaysPromo(promo.getPromo('ALL5'), 200);
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.extended, 2, 'продлено 2 прокси');
    const uses = db.prepare("SELECT COUNT(*) AS c FROM promo_uses WHERE promo_code = 'ALL5'").get().c;
    assert.strictEqual(uses, 1, 'применение записано один раз');
});

test('percent: активация на следующую покупку и списание', () => {
    const db = makeDb(); seed(db);
    const promo = inject(db);
    addPercentPromo(db, 'SALE20', 'all', 20);

    const act = promo.activatePercent(promo.getPromo('SALE20'), 200);
    assert.strictEqual(act.ok, true);
    assert.strictEqual(act.percent, 20);
    assert.strictEqual(
        db.prepare('SELECT pending_promo FROM bot_users WHERE telegram_id = 200').get().pending_promo, 'SALE20');

    assert.strictEqual(promo.discountedPrice(100, promo.getPromo('SALE20')), 80);

    promo.consumePercent('SALE20', 200);
    assert.strictEqual(
        db.prepare('SELECT pending_promo FROM bot_users WHERE telegram_id = 200').get().pending_promo, null,
        'промокод снят после покупки');
    const uses = db.prepare("SELECT COUNT(*) AS c FROM promo_uses WHERE promo_code = 'SALE20'").get().c;
    assert.strictEqual(uses, 1, 'применение списано');
});

test('percent/new: только для первой покупки', () => {
    const db = makeDb(); seed(db);
    const promo = inject(db);
    addPercentPromo(db, 'FIRST', 'new', 15);
    assert.strictEqual(promo.checkAudience(promo.getPromo('FIRST'), 200).ok, false, 'у 200 уже есть покупка');
    assert.strictEqual(promo.checkAudience(promo.getPromo('FIRST'), 100).ok, true, 'у 100 покупок нет');
});

// ═══ v3: аудитория «старенькие» (old) ═══

test('days/old: доступен купившим, новичкам и «только тест» — отказ', async () => {
    const db = makeDb(); seed(db);
    const promo = inject(db);
    // 300 — только бесплатный тестовый прокси (не «старенький»)
    db.prepare("INSERT INTO clients (username, secret, telegram_id, status) VALUES ('test300', 's', 300, 'active')").run();
    addDaysPromo(db, 'OLD5', 'old', 5);

    assert.strictEqual(promo.checkAudience(promo.getPromo('OLD5'), 200).ok, true, '200 купил прокси');
    assert.strictEqual(promo.checkAudience(promo.getPromo('OLD5'), 100).ok, false, '100 ничего не покупал');
    assert.strictEqual(promo.checkAudience(promo.getPromo('OLD5'), 300).ok, false, 'тестовый прокси не считается');

    const r = await promo.applyDaysPromo(promo.getPromo('OLD5'), 200);
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.extended, 1);
    const denied = await promo.applyDaysPromo(promo.getPromo('OLD5'), 100).catch(() => ({ ok: false }));
    assert.strictEqual(denied.ok, false, 'новичку применить нельзя');
});

test('days/old: истёкший прокси продлевается и активируется', async () => {
    const db = makeDb(); seed(db);
    const promo = inject(db);
    db.prepare(
        "INSERT INTO clients (username, secret, telegram_id, status, expires_at) VALUES ('tg200x2', 's2', 200, 'expired', '2020-01-01T00:00:00Z')"
    ).run();
    addDaysPromo(db, 'OLDEX', 'old', 10);

    const targets = promo.daysPromoTargets(promo.getPromo('OLDEX'), 200);
    assert.strictEqual(targets.length, 2, 'в наборе активный и истёкший');
    const expired = targets.find((t) => t.username === 'tg200x2');
    const r = await promo.applyDaysPromo(promo.getPromo('OLDEX'), 200, expired.id);
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.target, 'tg200x2', 'продлён именно выбранный');
    const row = db.prepare('SELECT status, expires_at FROM clients WHERE username = ?').get('tg200x2');
    assert.strictEqual(row.status, 'active', 'истёкший активирован');
    const days = (new Date(row.expires_at) - new Date()) / 86400000;
    assert.ok(days > 9.9 && days < 10.1, `срок ≈ 10 дней (${days})`);
    // Второй (активный) прокси не тронут
    const other = db.prepare('SELECT expires_at FROM clients WHERE username = ?').get('tg200x1');
    assert.strictEqual(other.expires_at, null, 'невыбранный прокси не продлен');
});

test('days/old: чужой targetClientId отклоняется', async () => {
    const db = makeDb(); seed(db);
    const promo = inject(db);
    addDaysPromo(db, 'OLDOWN', 'old', 5);
    const r = await promo.applyDaysPromo(promo.getPromo('OLDOWN'), 200, 99999);
    assert.strictEqual(r.ok, false, 'чужой/несуществующий прокси нельзя выбрать');
});

test('days/all: targetClientId продлевает только выбранный прокси', async () => {
    const db = makeDb(); seed(db);
    const promo = inject(db);
    const second = db.prepare(
        "INSERT INTO clients (username, secret, telegram_id, status) VALUES ('tg200x2', 's2', 200, 'active')"
    ).run();
    addDaysPromo(db, 'ALLCHOICE', 'all', 5);
    const targets = promo.daysPromoTargets(promo.getPromo('ALLCHOICE'), 200);
    assert.strictEqual(targets.length, 2);
    const r = await promo.applyDaysPromo(promo.getPromo('ALLCHOICE'), 200, second.lastInsertRowid);
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.extended, 1, 'продлён один прокси');
    assert.strictEqual(r.target, 'tg200x2');
});

test('daysPromoTargets: new → пусто, old → без тестов, all → только активные', () => {
    const db = makeDb(); seed(db);
    const promo = inject(db);
    db.prepare("INSERT INTO clients (username, secret, telegram_id, status) VALUES ('test200', 'st', 200, 'active')").run();
    db.prepare("INSERT INTO clients (username, secret, telegram_id, status, expires_at) VALUES ('tg200x9', 's9', 200, 'expired', '2020-01-01')").run();

    assert.deepStrictEqual(promo.daysPromoTargets({ kind: 'days', audience: 'new' }, 200), []);
    const oldTargets = promo.daysPromoTargets({ kind: 'days', audience: 'old' }, 200);
    assert.ok(oldTargets.every((t) => !t.username.startsWith('test')), 'тесты исключены');
    assert.ok(oldTargets.some((t) => t.status === 'expired'), 'истёкшие включены');
    const allTargets = promo.daysPromoTargets({ kind: 'days', audience: 'all' }, 200);
    assert.ok(allTargets.every((t) => t.status === 'active'), 'только активные');
});

test('percent/old: скидка тем, у кого есть купленный прокси', () => {
    const db = makeDb(); seed(db);
    const promo = inject(db);
    db.prepare("INSERT INTO clients (username, secret, telegram_id, status) VALUES ('test300', 's', 300, 'active')").run();
    addPercentPromo(db, 'OLD20', 'old', 20);

    assert.strictEqual(promo.checkAudience(promo.getPromo('OLD20'), 200).ok, true, '200 купил');
    assert.strictEqual(promo.checkAudience(promo.getPromo('OLD20'), 100).ok, false, '100 не покупал');
    assert.strictEqual(promo.checkAudience(promo.getPromo('OLD20'), 300).ok, false, 'только тест — не считается');

    const act = promo.activatePercent(promo.getPromo('OLD20'), 200);
    assert.strictEqual(act.ok, true);
});

test('discountedPrice: процент и фиксированная, не ниже нуля', () => {
    const db = makeDb();
    const promo = inject(db);
    assert.strictEqual(promo.discountedPrice(100, { discount_percent: 25, discount_fixed: null }), 75);
    assert.strictEqual(promo.discountedPrice(100, { discount_percent: null, discount_fixed: 30 }), 70);
    assert.strictEqual(promo.discountedPrice(10, { discount_percent: null, discount_fixed: 50 }), 0);
});
