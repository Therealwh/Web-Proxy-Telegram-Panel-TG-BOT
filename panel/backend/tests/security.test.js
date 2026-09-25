/**
 * Тесты утилит безопасности (Фаза 0 — страховочная сетка).
 * Запуск: node --test tests/security.test.js
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { safePath } = require('../utils/safePath');
const { csvCell, csvRow } = require('../utils/csv');

// ---------------------------------------------------------------------------
// safePath
// ---------------------------------------------------------------------------

test('safePath: обычный файл внутри каталога проходит', () => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'tggate-sp-'));
    try {
        const abs = safePath(base, 'index.html');
        assert.ok(abs.startsWith(path.normalize(base)));
        assert.match(abs, /index\.html$/);
    } finally {
        fs.rmSync(base, { recursive: true, force: true });
    }
});

test('safePath: вложенный путь проходит', () => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'tggate-sp-'));
    try {
        const abs = safePath(base, 'css/main.css');
        assert.ok(abs.startsWith(path.normalize(base)));
    } finally {
        fs.rmSync(base, { recursive: true, force: true });
    }
});

test('safePath: .. отклоняется', () => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'tggate-sp-'));
    try {
        assert.throws(() => safePath(base, '../etc/passwd'));
        assert.throws(() => safePath(base, 'a/../../b'));
    } finally {
        fs.rmSync(base, { recursive: true, force: true });
    }
});

test('safePath: абсолютный путь и спецсимволы отклоняются', () => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'tggate-sp-'));
    try {
        assert.throws(() => safePath(base, '/etc/passwd'));
        assert.throws(() => safePath(base, 'file name with space'));
        assert.throws(() => safePath(base, 'file<script>'));
        assert.throws(() => safePath(base, ''));
    } finally {
        fs.rmSync(base, { recursive: true, force: true });
    }
});

test('safePath: symlink-escape отклоняется (MINOR-7)', () => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'tggate-sp-'));
    const secretDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tggate-secret-'));
    try {
        const secretFile = path.join(secretDir, 'secret.txt');
        fs.writeFileSync(secretFile, 'top secret');
        const link = path.join(base, 'innocent.html');
        try {
            fs.symlinkSync(secretFile, link);
        } catch (e) {
            if (e.code === 'EPERM') return; // Windows без прав на symlink — пропускаем
            throw e;
        }
        // safePath должен либо выбросить ошибку, либо вернуть путь внутри base
        let resolved = null;
        let threw = false;
        try {
            resolved = safePath(base, 'innocent.html');
        } catch {
            threw = true; // отклонение symlink-а — приемлемый исход
        }
        if (!threw) {
            assert.ok(
                resolved.startsWith(path.normalize(base)),
                `realpath вышел за пределы base: ${resolved}`
            );
        }
    } finally {
        fs.rmSync(base, { recursive: true, force: true });
        fs.rmSync(secretDir, { recursive: true, force: true });
    }
});

// ---------------------------------------------------------------------------
// csvCell / csvRow — защита от формульной CSV-инъекции (MINOR-5)
// ---------------------------------------------------------------------------

test('csvCell: кавычки и запятые экранируются', () => {
    assert.strictEqual(csvCell('say "hi", ok'), '"say ""hi"", ok"');
    assert.strictEqual(csvCell('line\nbreak'), '"line\nbreak"');
});

test('csvCell: формульные первые символы получают префикс', () => {
    assert.strictEqual(csvCell('=cmd|a'), '\'=cmd|a');
    assert.strictEqual(csvCell('+1+1'), '\'+1+1');
    assert.strictEqual(csvCell('-1'), '\'-1');
    assert.strictEqual(csvCell('@SUM(1)'), '\'@SUM(1)');
    assert.strictEqual(csvCell('\tT'), '\'\tT');
});

test('csvCell: безопасные значения не трогаются', () => {
    assert.strictEqual(csvCell('plain'), 'plain');
    assert.strictEqual(csvCell('10.20.30.40'), '10.20.30.40');
    assert.strictEqual(csvCell(null), '');
    assert.strictEqual(csvCell(undefined), '');
    assert.strictEqual(csvCell(42), '42');
});

test('csvRow: собирает строку с запятыми', () => {
    assert.strictEqual(csvRow(['a', 'b,c', 'd']), 'a,"b,c",d');
});

test('csvCell: отрицательное число тоже защищается (минус = формула)', () => {
    // Значение '-5' в Excel интерпретируется безопасно, но '-SUM()' — нет;
    // единообразно ставим префикс для всех '-' (текстовые поля доминируют)
    assert.strictEqual(csvCell('-SUM(A1)'), '\'-SUM(A1)');
});
