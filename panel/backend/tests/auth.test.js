/**
 * Тесты WS-тикетов: одноразовость, TTL, тип (Фаза 0 / C1).
 * Запуск: node --test tests/auth.test.js
 */

const test = require('node:test');
const assert = require('node:assert');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-for-ws-ticket-tests-0123456789';

const { issueTicket, verifyTicket, TICKET_TTL } = require('../utils/wsTicket');

const admin = { id: 1, login: 'root' };

test('issueTicket/verifyTicket: валидный тикет проходит один раз', () => {
    const ticket = issueTicket(admin);
    const res = verifyTicket(ticket);
    assert.ok(res, 'тикет должен верифицироваться');
    assert.strictEqual(String(res.id), String(admin.id));
    assert.strictEqual(res.login, admin.login);
});

test('issueTicket/verifyTicket: повторное использование отклоняется (одноразовость)', () => {
    const ticket = issueTicket(admin);
    assert.ok(verifyTicket(ticket), 'первое использование — ок');
    assert.strictEqual(verifyTicket(ticket), null, 'второе использование — null');
});

test('verifyTicket: мусор, пустая строка и перегруз отклоняются', () => {
    assert.strictEqual(verifyTicket('garbage'), null);
    assert.strictEqual(verifyTicket(''), null);
    assert.strictEqual(verifyTicket('a'.repeat(2000)), null);
    assert.strictEqual(verifyTicket(undefined), null);
});

test('verifyTicket: access-токен (не тикет) отклоняется — type обязателен', () => {
    const jwt = require('jsonwebtoken');
    const config = require('../config');
    // Обычный access-токен без type:'ws'
    const accessToken = jwt.sign({ sub: 1, login: 'root' }, config.jwtSecret, { expiresIn: '5m' });
    assert.strictEqual(verifyTicket(accessToken), null, 'access-токен не должен работать как тикет');
});

test('TICKET_TTL: короткая жизнь (<= 60 сек)', () => {
    assert.ok(TICKET_TTL <= 60, `TTL слишком длинный: ${TICKET_TTL}`);
    assert.ok(TICKET_TTL >= 10, 'TTL должен позволять мгновенное использование');
});
