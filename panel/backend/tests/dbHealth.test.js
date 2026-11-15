/**
 * Тесты защиты БД (services/dbHealth): проверка целостности,
 * верификация файлов бэкапов, поиск последнего бэкапа.
 * Инцидент 14.11.2026: порча SQLite-страниц осталась незамеченной,
 * а автобэкапы копировали уже повреждённый файл.
 *
 * ВАЖНО: тестируем verifyLatestBackup с ИНЖЕКТОМ фейк-БД (паттерн
 * promo.test.js) — реальный алертный путь (event_logs, notifyAdmin)
 * должен писать в фейковую БД, а не в dev-БД панели и не пажить
 * админа ложной тревогой при каждом прогоне тестов.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const Database = require('better-sqlite3');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-dbhealth';

// ── Инжект фейк-БД ДО загрузки dbHealth (алерты уходят в :memory:) ──
const fakeDb = new Database(':memory:');
fakeDb.exec(`
    CREATE TABLE event_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        event TEXT NOT NULL,
        title TEXT NOT NULL,
        details TEXT,
        level TEXT DEFAULT 'info',
        telegram_id INTEGER,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT);
`);
const dbPath = require.resolve('../db');
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: fakeDb };
for (const mod of ['../services/dbHealth', '../services/eventLog', '../routes/settings', '../services/notifier']) {
    delete require.cache[require.resolve(mod)];
}
const dbHealth = require('../services/dbHealth');
const eventLog = require('../services/eventLog');

// Незакрытый better-sqlite3 хендл при форс-выходе тестов роняет процесс
// на нативном teardown (Windows) — закрываем явно
test.after(() => {
    try { fakeDb.close(); } catch { /* уже закрыт */ }
});

/** Временный каталог под тестовые файлы. */
function tmpDir() {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'dbhealth-'));
}

/** Подмена каталога бэкапов в config с гарантированным восстановлением. */
function withBackupDir(dir, fn) {
    const config = require.cache[require.resolve('../config')].exports;
    const prev = config.backupDir;
    config.backupDir = dir;
    try {
        return fn();
    } finally {
        config.backupDir = prev;
    }
}

test('checkDatabase: здоровая БД — ok', () => {
    const db = new Database(':memory:');
    db.exec('CREATE TABLE t (id INTEGER)');
    const r = dbHealth.checkDatabase(db);
    assert.strictEqual(r.ok, true);
    assert.deepStrictEqual(r.issues, ['ok']);
    db.close();
});

test('verifyBackupFile: корректный файл бэкапа — ok', () => {
    const dir = tmpDir();
    const file = path.join(dir, 'auto-2026-01-01.db');
    const db = new Database(file);
    db.exec('CREATE TABLE clients (id INTEGER PRIMARY KEY, username TEXT)');
    db.prepare('INSERT INTO clients (username) VALUES (?)').run('tg100x1');
    db.close();

    const r = dbHealth.verifyBackupFile(file);
    assert.strictEqual(r.ok, true, `ожидали ok, получили: ${JSON.stringify(r)}`);
    assert.strictEqual(r.file, file);
});

test('verifyBackupFile: битый файл (мусор вместо БД) — не ok, без исключения', () => {
    const dir = tmpDir();
    const file = path.join(dir, 'auto-2026-01-02.db');
    fs.writeFileSync(file, Buffer.from('это не база данных, а просто мусор '.repeat(100), 'utf8'));

    const r = dbHealth.verifyBackupFile(file);
    assert.strictEqual(r.ok, false);
    assert.ok(r.error || (r.issues && r.issues.length), 'должна быть причина отказа');
});

test('verifyBackupFile: несуществующий файл — не ok, без исключения', () => {
    const r = dbHealth.verifyBackupFile(path.join(os.tmpdir(), 'dbhealth-no-such-file.db'));
    assert.strictEqual(r.ok, false);
    assert.ok(r.error);
});

test('findLatestBackup: берёт самый свежий auto-*.db, игнорирует остальное', () => {
    const dir = tmpDir();
    for (const f of ['auto-2026-01-01.db', 'auto-2026-01-02.db', 'notes.txt', 'other.db']) {
        fs.writeFileSync(path.join(dir, f), 'x');
    }
    const latest = dbHealth.findLatestBackup(dir);
    assert.strictEqual(latest, path.join(dir, 'auto-2026-01-02.db'));
});

test('findLatestBackup: пустой каталог — null', () => {
    const dir = tmpDir();
    assert.strictEqual(dbHealth.findLatestBackup(dir), null);
});

test('verifyLatestBackup: нет бэкапов — не бросает, помечает no backups', () => {
    const dir = tmpDir();
    withBackupDir(dir, () => {
        const r = dbHealth.verifyLatestBackup();
        assert.strictEqual(r.ok, false);
        assert.strictEqual(r.error, 'no backups');
        // Фейковая БД не должна получить алерт «нет бэкапов» (не спамим)
        const alerts = fakeDb.prepare("SELECT COUNT(*) AS c FROM event_logs WHERE title LIKE '%Проблема с базой%'").get().c;
        assert.strictEqual(alerts, 0, 'отсутствие бэкапов не должно быть алертом');
    });
});

test('verifyLatestBackup: свежий битый бэкап — не ok + алерт в фейковую БД', () => {
    const dir = tmpDir();
    withBackupDir(dir, () => {
        fs.writeFileSync(path.join(dir, `auto-${new Date().toISOString().slice(0, 10)}.db`), 'мусор');
        const r = dbHealth.verifyLatestBackup();
        assert.strictEqual(r.ok, false);
        const alerts = fakeDb.prepare("SELECT COUNT(*) AS c FROM event_logs WHERE title LIKE '%Проблема с базой%'").get().c;
        assert.strictEqual(alerts, 1, 'алерт о битом бэкапе должен записаться в фейковую БД');
        assert.match(fakeDb.prepare('SELECT details FROM event_logs LIMIT 1').get().details, /auto-\d{4}-\d{2}-\d{2}\.db/);
    });
});

test('runDailyCheck: падение самой проверки — алерт, не бросает', async () => {
    const dir = tmpDir();
    withBackupDir(dir, async () => {
        // Пересоздаём dbHealth с «сломанной» БД (prepare всегда бросает):
        // замена exports после загрузки модуля не влияет на захваченную ссылку
        const broken = { prepare: () => { throw new Error('I/O error'); } };
        require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: broken };
        delete require.cache[require.resolve('../services/dbHealth')];
        const fresh = require('../services/dbHealth');
        try {
            const r = await fresh.runDailyCheck();
            assert.strictEqual(r.ok, false);
            assert.ok(r.issues[0].startsWith('check failed:'), 'сбой проверки должен быть виден');
        } finally {
            // Восстанавливаем инжект фейк-БД и оригинальный сервис
            require.cache[dbPath].exports = fakeDb;
            delete require.cache[require.resolve('../services/dbHealth')];
        }
    });
});

test('алерты не пишут в реальную dev-БД: фейковая БД принята сервисом', () => {
    // Контракт инжекта: dbHealth/eventLog используют именно подменённый модуль
    assert.strictEqual(require.cache[dbPath].exports, fakeDb, 'инжект должен быть активен');
});
