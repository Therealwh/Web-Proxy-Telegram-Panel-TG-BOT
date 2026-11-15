/**
 * Тесты защиты БД (services/dbHealth): проверка целостности,
 * верификация файлов бэкапов, поиск последнего бэкапа.
 * Инцидент 14.11.2026: порча SQLite-страниц осталась незамеченной,
 * а автобэкапы копировали уже повреждённый файл.
 *
 * ВАЖНО: verifyLatestBackup тестируется с ИНЖЕКТОМ ФЕЙК-БД (паттерн
 * promo.test.js) — реальный алертный путь (event_logs, notifyAdmin)
 * должен писать в фейк, а не в dev-БД панели и не пажить админа ложной
 * тревогой при каждом прогоне тестов. Фейк — чистый JS-stub БЕЗ нативных
 * better-sqlite3 хендлов: незакрытые нативные соединения роняют процесс
 * на Windows-teardown (известная проблема окружения).
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-dbhealth';

// ── Инжект фейк-БД ДО загрузки dbHealth (алерты уходят в JS-stub) ──
const eventLogRows = []; // [{event, title, details, level}]
const fakeDb = {
    prepare: (sql) => {
        if (/INSERT INTO event_logs/.test(sql)) {
            return { run: (...args) => { eventLogRows.push(args); return { changes: 1 }; } };
        }
        if (/FROM event_logs/.test(sql)) {
            return { get: () => ({ c: eventLogRows.length }), all: () => eventLogRows };
        }
        if (/FROM settings/.test(sql)) {
            // getAll(): пустая таблица → дефолты → notifyAdmin тихо вернёт null
            return { all: () => [], get: () => null };
        }
        throw new Error(`неожиданный запрос в тесте: ${sql}`);
    },
    pragma: () => 'ok',
};
const dbPath = require.resolve('../db');
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: fakeDb };
for (const mod of ['../services/dbHealth', '../services/eventLog', '../routes/settings', '../services/notifier']) {
    delete require.cache[require.resolve(mod)];
}
const dbHealth = require('../services/dbHealth');

// ВАЖНО 1: в этом файле НЕ должно быть объектов better-sqlite3 — их нативные
// деструкторы на Windows (better-sqlite3 + Node 24) абортят процесс при
// teardown. Целостность проверяем через stub-БД и валидный fixture-файл
// (fixtures/backup-valid.db — единственный нативный open/close внутри
// verifyBackupFile, тот же путь, что в проде).
// ВАЖНО 2: на Windows гонять с --test-isolation=none; изредка процесс может
// абортнуться на нативном teardown — ассерты при этом всегда проходят,
// перезапустить. На Linux детерминировано..

/** Валидный SQLite-файл для проверки живого пути verifyBackupFile. */
const VALID_FIXTURE = path.join(__dirname, 'fixtures', 'backup-valid.db');

/** Stub-БД для checkDatabase: healthy/повреждённая. */
function stubDb(issues) {
    return { pragma: () => issues.map((v) => ({ quick_check: v })) };
}

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
    const r = dbHealth.checkDatabase(stubDb(['ok']));
    assert.strictEqual(r.ok, true);
    assert.deepStrictEqual(r.issues, ['ok']);
});

test('checkDatabase: повреждённая БД — не ok, список проблем', () => {
    const r = dbHealth.checkDatabase(stubDb(['*** in database main ***', 'Page 30091: error']));
    assert.strictEqual(r.ok, false);
    assert.deepStrictEqual(r.issues, ['*** in database main ***', 'Page 30091: error']);
});

test('verifyBackupFile: корректный файл бэкапа (fixture) — ok', () => {
    assert.ok(fs.existsSync(VALID_FIXTURE), 'fixture не найден: tests/fixtures/backup-valid.db');
    const r = dbHealth.verifyBackupFile(VALID_FIXTURE);
    assert.strictEqual(r.ok, true, `ожидали ok, получили: ${JSON.stringify(r)}`);
    assert.strictEqual(r.file, VALID_FIXTURE);
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

test('verifyLatestBackup: нет бэкапов — не бросает, алерта нет (не спамим)', () => {
    const dir = tmpDir();
    withBackupDir(dir, () => {
        const r = dbHealth.verifyLatestBackup();
        assert.strictEqual(r.ok, false);
        assert.strictEqual(r.error, 'no backups');
        assert.strictEqual(eventLogRows.length, 0, 'отсутствие бэкапов не должно быть алертом');
    });
});

test('verifyLatestBackup: свежий битый бэкап — не ok + алерт в фейковую БД', () => {
    const dir = tmpDir();
    withBackupDir(dir, () => {
        fs.writeFileSync(path.join(dir, `auto-${new Date().toISOString().slice(0, 10)}.db`), 'мусор');
        const r = dbHealth.verifyLatestBackup();
        assert.strictEqual(r.ok, false);
        assert.strictEqual(eventLogRows.length, 1, 'алерт о битом бэкапе должен записаться');
        assert.match(eventLogRows[0][2], /auto-\d{4}-\d{2}-\d{2}\.db/);
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
