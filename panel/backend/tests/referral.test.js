/**
 * Тесты реферальной программы (миграция 024, utils/referral).
 * Отдельная in-memory SQLite — рабочая БД не трогается.
 * Запуск: node --test tests/referral.test.js
 */

const test = require('node:test');
const assert = require('node:assert');
const Database = require('better-sqlite3');

// config требует JWT_SECRET при загрузке (logger → config)
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-referral-0123456789';

// Минимальная схема для utils/referral
function makeDb() {
    const db = new Database(':memory:');
    db.exec(`
        CREATE TABLE clients (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT NOT NULL,
            telegram_id INTEGER,
            balance REAL NOT NULL DEFAULT 0,
            referral_code TEXT UNIQUE,
            referrer_id INTEGER
        );
        CREATE TABLE referral_earnings (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            referrer_id INTEGER NOT NULL,
            referred_id INTEGER,
            amount REAL NOT NULL,
            kind TEXT NOT NULL DEFAULT 'purchase',
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE TABLE referral_pending (
            telegram_id INTEGER PRIMARY KEY,
            referrer_id INTEGER NOT NULL
        );
        CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT);
    `);
    return db;
}

// Подмена db в кэше модулей (как в money.test.js) + свежая загрузка referral.
// Важно: settings и balance тоже читают db на импорте — их кэш сбрасываем,
// иначе между тестами они остались бы привязаны к прежней in-memory БД.
function inject(db) {
    const dbPath = require.resolve('../db');
    require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: db };
    for (const mod of ['../utils/referral', '../utils/balance', '../routes/settings']) {
        delete require.cache[require.resolve(mod)];
    }
    return require('../utils/referral');
}

function seed(db) {
    // Реферер (id 1, tg 100) и приглашённый (id 2, tg 200)
    db.prepare("INSERT INTO clients (username, telegram_id, balance) VALUES ('ref1', 100, 0)").run();
    db.prepare("INSERT INTO clients (username, telegram_id, balance, referrer_id) VALUES ('user2', 200, 0, 1)").run();
}

test('ensureReferralCode: генерирует 8-символьный код и сохраняет его', () => {
    const db = makeDb();
    db.prepare("INSERT INTO clients (username, telegram_id) VALUES ('u1', 100)").run();
    const referral = inject(db);

    const code = referral.ensureReferralCode(1);
    assert.strictEqual(code.length, 8);
    assert.match(code, /^[0-9a-f]{8}$/);
    assert.strictEqual(referral.ensureReferralCode(1), code, 'повторный вызов возвращает тот же код');
});

test('resolveRefPayload: новый код и легаси ref_<telegram_id>', () => {
    const db = makeDb();
    db.prepare("INSERT INTO clients (username, telegram_id, referral_code) VALUES ('u1', 100, 'ab12cd34')").run();
    db.prepare("INSERT INTO clients (username, telegram_id) VALUES ('u2', 200)").run();
    const referral = inject(db);

    assert.strictEqual(referral.resolveRefPayload('ref_ab12cd34'), 1, 'переход по коду');
    assert.strictEqual(referral.resolveRefPayload('ref_200'), 2, 'легаси-ссылка по telegram_id');
    assert.strictEqual(referral.resolveRefPayload('ref_unknown1'), null, 'неизвестный код');
    assert.strictEqual(referral.resolveRefPayload('ref_'), null, 'пустой код');
    assert.strictEqual(referral.resolveRefPayload('promo_XYZ'), null, 'чужой payload');
    assert.strictEqual(referral.resolveRefPayload(null), null, 'null payload');
});

test('payReferral percent: 10% от 300 → +30 на баланс реферера', () => {
    const db = makeDb();
    seed(db);
    const referral = inject(db);

    const r = referral.payReferral({ referredClientId: 2, amount: 300, kind: 'purchase', currency: 'RUB' });
    assert.strictEqual(r.credited, true);
    assert.strictEqual(r.bonus, 30);
    assert.strictEqual(db.prepare('SELECT balance FROM clients WHERE id = 1').get().balance, 30);
    const row = db.prepare("SELECT * FROM referral_earnings WHERE referrer_id = 1").get();
    assert.ok(row, 'начисление записано в журнал');
    assert.strictEqual(row.amount, 30);
    assert.strictEqual(row.kind, 'purchase');
    assert.strictEqual(row.referred_id, 2);
});

test('payReferral: режим off ничего не начисляет', () => {
    const db = makeDb();
    seed(db);
    db.prepare("INSERT INTO settings (key, value) VALUES ('referral_mode', '\"off\"')").run();
    const referral = inject(db);

    const r = referral.payReferral({ referredClientId: 2, amount: 300, kind: 'deposit' });
    assert.strictEqual(r.credited, false);
    assert.strictEqual(db.prepare('SELECT balance FROM clients WHERE id = 1').get().balance, 0);
    assert.strictEqual(db.prepare('SELECT COUNT(*) AS c FROM referral_earnings').get().c, 0);
});

test('payReferral: процент 0 — начисления нет', () => {
    const db = makeDb();
    seed(db);
    db.prepare("INSERT INTO settings (key, value) VALUES ('referral_percent', '0')").run();
    const referral = inject(db);

    assert.strictEqual(referral.payReferral({ referredClientId: 2, amount: 300 }).credited, false);
});

test('payReferral: без реферера — no-op', () => {
    const db = makeDb();
    db.prepare("INSERT INTO clients (username, telegram_id) VALUES ('solo', 300)").run();
    const referral = inject(db);

    assert.strictEqual(referral.payReferral({ referredClientId: 1, amount: 500 }).credited, false);
    assert.strictEqual(db.prepare('SELECT COUNT(*) AS c FROM referral_earnings').get().c, 0);
});

test('payReferral: самоприглашение отклоняется', () => {
    const db = makeDb();
    db.prepare("INSERT INTO clients (username, telegram_id, referrer_id) VALUES ('self', 100, 1)").run();
    const referral = inject(db);

    assert.strictEqual(referral.payReferral({ referredClientId: 1, amount: 500 }).credited, false);
    assert.strictEqual(db.prepare('SELECT COUNT(*) AS c FROM referral_earnings').get().c, 0);
});

test('payReferral: пополнение от новичка без прокси — реферер из referral_pending', () => {
    const db = makeDb();
    db.prepare("INSERT INTO clients (username, telegram_id) VALUES ('ref1', 100)").run();
    db.prepare('INSERT INTO referral_pending (telegram_id, referrer_id) VALUES (200, 1)').run();
    const referral = inject(db);

    const r = referral.payReferral({ referredTgId: 200, amount: 100, kind: 'deposit', currency: 'RUB' });
    assert.strictEqual(r.credited, true);
    assert.strictEqual(r.bonus, 10);
    assert.strictEqual(db.prepare('SELECT balance FROM clients WHERE id = 1').get().balance, 10);
    const row = db.prepare('SELECT * FROM referral_earnings').get();
    assert.strictEqual(row.kind, 'deposit');
    assert.strictEqual(row.referred_id, null, 'прокси у новичка ещё нет');
});

test('payReferral: округление до копеек (333 → 33.3)', () => {
    const db = makeDb();
    seed(db);
    const referral = inject(db);

    const r = referral.payReferral({ referredClientId: 2, amount: 333, kind: 'purchase' });
    assert.strictEqual(r.bonus, 33.3);
});

test('adminStats: итоги, топ и последние начисления', () => {
    const db = makeDb();
    seed(db);
    const referral = inject(db);
    referral.payReferral({ referredClientId: 2, amount: 200, kind: 'purchase' });

    const stats = referral.adminStats();
    assert.strictEqual(stats.totals.invited, 1);
    assert.strictEqual(stats.totals.referrers, 1);
    assert.strictEqual(stats.totals.paid_out, 20);
    assert.strictEqual(stats.top.length, 1);
    assert.strictEqual(stats.top[0].username, 'ref1');
    assert.strictEqual(stats.top[0].earned, 20);
    assert.strictEqual(stats.recent.length, 1);
    assert.strictEqual(stats.recent[0].referrer_username, 'ref1');
});

test('userStats: приглашённые и заработок реферера', () => {
    const db = makeDb();
    seed(db);
    db.prepare('INSERT INTO referral_pending (telegram_id, referrer_id) VALUES (999, 1)').run();
    const referral = inject(db);
    referral.payReferral({ referredClientId: 2, amount: 100, kind: 'purchase' });

    const st = referral.userStats(1);
    assert.strictEqual(st.invited, 1);
    assert.strictEqual(st.pending, 1);
    assert.strictEqual(st.earned, 10);
});
