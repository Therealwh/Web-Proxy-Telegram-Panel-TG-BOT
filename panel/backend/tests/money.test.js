/**
 * Тесты атомарного баланса (Фаза 0 / M5).
 * Использует отдельную in-memory SQLite — не трогает рабочую БД.
 * Запуск: node --test tests/money.test.js
 */

const test = require('node:test');
const assert = require('node:assert');
const Database = require('better-sqlite3');

// Схема, минимально необходимая для utils/balance
function makeDb() {
    const db = new Database(':memory:');
    db.exec(`CREATE TABLE clients (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL,
        telegram_id INTEGER,
        balance REAL NOT NULL DEFAULT 0
    )`);
    return db;
}

test('deductBalanceAtomic: хватает денег — списывается один раз', () => {
    const db = makeDb();
    db.prepare("INSERT INTO clients (username, telegram_id, balance) VALUES ('u1', 100, 500)").run();
    // Подменяем db внутри модуля: require с injections невозможен (CommonJS) —
    // используем proxy через кэш модулей
    const balancePath = require.resolve('../utils/balance');
    require.cache[balancePath] = { id: balancePath, filename: balancePath, loaded: true, exports: makeBalanceModule(db) };
    const { deductBalanceAtomic } = require('../utils/balance');

    assert.strictEqual(deductBalanceAtomic(100, 300), true);
    const bal = db.prepare('SELECT balance FROM clients WHERE telegram_id = 100').get().balance;
    assert.strictEqual(bal, 200);
});

test('deductBalanceAtomic: повторное списание сверх остатка отклоняется (M5)', () => {
    const db = makeDb();
    db.prepare("INSERT INTO clients (username, telegram_id, balance) VALUES ('u1', 100, 300)").run();
    const balancePath = require.resolve('../utils/balance');
    require.cache[balancePath] = { id: balancePath, filename: balancePath, loaded: true, exports: makeBalanceModule(db) };
    const { deductBalanceAtomic } = require('../utils/balance');

    assert.strictEqual(deductBalanceAtomic(100, 300), true, 'первое списание ок');
    assert.strictEqual(deductBalanceAtomic(100, 300), false, 'второе списание должно упасть — не хватает');
    const bal = db.prepare('SELECT balance FROM clients WHERE telegram_id = 100').get().balance;
    assert.strictEqual(bal, 0, 'баланс не должен стать отрицательным');
});

test('deductBalanceAtomic: несуществующий клиент и некорректная сумма', () => {
    const db = makeDb();
    const balancePath = require.resolve('../utils/balance');
    require.cache[balancePath] = { id: balancePath, filename: balancePath, loaded: true, exports: makeBalanceModule(db) };
    const { deductBalanceAtomic } = require('../utils/balance');

    assert.strictEqual(deductBalanceAtomic(999, 100), false);
    assert.strictEqual(deductBalanceAtomic(100, 0), false);
    assert.strictEqual(deductBalanceAtomic(100, -5), false);
});

test('totalBalance: суммирует по всем прокси клиента', () => {
    const db = makeDb();
    db.prepare("INSERT INTO clients (username, telegram_id, balance) VALUES ('a', 100, 10)").run();
    db.prepare("INSERT INTO clients (username, telegram_id, balance) VALUES ('b', 100, 25.5)").run();
    db.prepare("INSERT INTO clients (username, telegram_id, balance) VALUES ('c', 200, 99)").run();
    const balancePath = require.resolve('../utils/balance');
    require.cache[balancePath] = { id: balancePath, filename: balancePath, loaded: true, exports: makeBalanceModule(db) };
    const { totalBalance } = require('../utils/balance');

    assert.strictEqual(totalBalance(100), 35.5);
    assert.strictEqual(totalBalance(200), 99);
    assert.strictEqual(totalBalance(300), 0);
});

/** Создаёт копию модуля balance, привязанную к переданной БД. */
function makeBalanceModule(db) {
    const deduct = (telegramId, amount) => {
        if (!(amount > 0)) return false;
        const result = db.prepare(
            'UPDATE clients SET balance = balance - ? WHERE telegram_id = ? AND balance >= ?'
        ).run(amount, telegramId, amount);
        return result.changes === 1;
    };
    const total = (telegramId) => {
        const row = db.prepare(
            'SELECT COALESCE(SUM(balance), 0) AS total FROM clients WHERE telegram_id = ?'
        ).get(telegramId);
        return row ? row.total : 0;
    };
    const credit = (telegramId, amount) => {
        if (!(amount > 0)) return false;
        const result = db.prepare(
            'UPDATE clients SET balance = balance + ? WHERE id = (SELECT id FROM clients WHERE telegram_id = ? LIMIT 1)'
        ).run(amount, telegramId);
        return result.changes === 1;
    };
    /** Спред-списание: распределяет сумму по строкам от большего остатка. */
    function spread(telegramId, amount) {
        if (!(amount > 0)) return { ok: false, touched: [], left: amount };
        let left = amount;
        const touched = [];
        const spreadTx = db.transaction(() => {
            const upd = db.prepare('UPDATE clients SET balance = balance - ? WHERE id = ? AND balance >= ?');
            for (let pass = 0; pass < 2 && left > 0; pass++) {
                const rows = db.prepare(
                    'SELECT id, balance FROM clients WHERE telegram_id = ? AND balance > 0 ORDER BY balance DESC'
                ).all(telegramId);
                for (const c of rows) {
                    if (left <= 0) break;
                    const take = Math.min(c.balance, left);
                    const r = upd.run(take, c.id, take);
                    if (r.changes === 0) continue;
                    touched.push({ id: c.id, amount: take });
                    left -= take;
                }
            }
            if (left > 0) throw new Error('INSUFFICIENT_TOTAL_BALANCE');
        });
        try {
            spreadTx();
        } catch (e) {
            if (e.message !== 'INSUFFICIENT_TOTAL_BALANCE') throw e;
            return { ok: false, touched: [], left: amount };
        }
        return { ok: true, touched, left: 0 };
    }
    return { deductBalanceAtomic: deduct, deductBalanceSpread: spread, totalBalance: total, creditBalance: credit };
}

test('deductBalanceSpread: баланс размазан по строкам — списывается ровно', () => {
    const db = makeDb();
    db.prepare("INSERT INTO clients (username, telegram_id, balance) VALUES ('u1', 100, 200)").run();
    db.prepare("INSERT INTO clients (username, telegram_id, balance) VALUES ('u2', 100, 100)").run();
    const balancePath = require.resolve('../utils/balance');
    require.cache[balancePath] = { id: balancePath, filename: balancePath, loaded: true, exports: makeBalanceModule(db) };
    const { deductBalanceSpread } = require('../utils/balance');

    const result = deductBalanceSpread(100, 300);
    assert.strictEqual(result.ok, true, 'спред-списание должно покрыть сумму с двух строк');
    assert.strictEqual(result.touched.length, 2, 'затронуты обе строки');
    const rows = db.prepare('SELECT balance FROM clients WHERE telegram_id = 100 ORDER BY balance').all();
    assert.deepStrictEqual(rows.map((r) => r.balance), [0, 0], 'остатки нулевые');
});

test('deductBalanceSpread: суммы больше total — отказ без изменений', () => {
    const db = makeDb();
    db.prepare("INSERT INTO clients (username, telegram_id, balance) VALUES ('u1', 100, 200)").run();
    db.prepare("INSERT INTO clients (username, telegram_id, balance) VALUES ('u2', 100, 100)").run();
    const balancePath = require.resolve('../utils/balance');
    require.cache[balancePath] = { id: balancePath, filename: balancePath, loaded: true, exports: makeBalanceModule(db) };
    const { deductBalanceSpread } = require('../utils/balance');

    const result = deductBalanceSpread(100, 301);
    assert.strictEqual(result.ok, false, 'списание сверх total должно быть отклонено');
    const rows = db.prepare('SELECT balance FROM clients WHERE telegram_id = 100 ORDER BY balance').all();
    assert.deepStrictEqual(rows.map((r) => r.balance), [100, 200], 'баланс не должен измениться');
});
