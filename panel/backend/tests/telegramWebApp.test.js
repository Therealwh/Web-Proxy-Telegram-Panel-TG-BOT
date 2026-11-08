/**
 * Тесты валидации Telegram WebApp initData (мини-апп).
 * Чистая криптография — БД не трогается.
 * Запуск: JWT_SECRET=test node --test tests/telegramWebApp.test.js
 */

const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const { validateInitData } = require('../utils/telegramWebApp');

const BOT_TOKEN = '123456:TEST-TOKEN-FOR-UNIT-TESTS';

/** Строит подписанный Telegram'ом initData (как это делает сам Telegram). */
function buildInitData(overrides = {}, authDate = Math.floor(Date.now() / 1000)) {
    const user = { id: 424242, first_name: 'Тест', username: 'tester', ...overrides.user };
    const fields = {
        auth_date: String(authDate),
        query_id: 'AAF9tE0aAAAAANPT0tltRrVh',
        user: JSON.stringify(user),
        ...overrides.extra,
    };
    const dataCheckString = Object.entries(fields)
        .map(([k, v]) => `${k}=${v}`)
        .sort()
        .join('\n');
    const secret = crypto.createHmac('sha256', 'WebAppData').update(BOT_TOKEN).digest();
    const hash = crypto.createHmac('sha256', secret).update(dataCheckString).digest('hex');
    return new URLSearchParams({ ...fields, hash }).toString();
}

test('validateInitData: корректная подпись от Telegram проходит', () => {
    const user = validateInitData(buildInitData(), BOT_TOKEN);
    assert.ok(user, 'пользователь распознан');
    assert.strictEqual(user.id, 424242);
    assert.strictEqual(user.username, 'tester');
});

test('validateInitData: подделанные данные отклоняются', () => {
    // Валидная подпись, но id пользователя подменён после подписи
    const tampered = buildInitData().replace('424242', '111111');
    assert.strictEqual(validateInitData(tampered, BOT_TOKEN), null, 'подмена user.id ловится');
});

test('validateInitData: чужой токен бота не подходит', () => {
    assert.strictEqual(validateInitData(buildInitData(), '999999:OTHER-TOKEN'), null);
});

test('validateInitData: просроченная auth_date отклоняется', () => {
    const old = Math.floor(Date.now() / 1000) - 25 * 60 * 60; // 25 часов назад
    assert.strictEqual(validateInitData(buildInitData({}, old), BOT_TOKEN), null, 'реплей отклонён');
});

test('validateInitData: мусор и пустота — null без исключений', () => {
    assert.strictEqual(validateInitData(null, BOT_TOKEN), null);
    assert.strictEqual(validateInitData('', BOT_TOKEN), null);
    assert.strictEqual(validateInitData('user=garbage', BOT_TOKEN), null);
    assert.strictEqual(validateInitData('hash=deadbeef&auth_date=1', BOT_TOKEN), null);
    assert.strictEqual(validateInitData(buildInitData(), ''), null);
});
