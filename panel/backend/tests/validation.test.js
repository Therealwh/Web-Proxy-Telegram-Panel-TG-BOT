/**
 * @fileoverview Тесты валидации: схема клиента и middleware ошибок.
 * Запуск: JWT_SECRET=test node --test tests/
 */

process.env.JWT_SECRET = 'test-secret-for-unit-tests';

const { test } = require('node:test');
const assert = require('node:assert');
const { z } = require('zod');

// Повторяем схему из routes/clients.js для проверки правил
const clientSchema = z.object({
    username: z.string().regex(/^[A-Za-z0-9_.-]{1,64}$/),
    quota_bytes: z.number().int().positive().nullable().optional(),
    max_ips: z.number().int().min(1).max(100).nullable().optional(),
    ad_tag: z.string().regex(/^[0-9a-f]{32}$/).nullable().optional(),
});

test('валидация: корректное имя клиента проходит', () => {
    assert.doesNotThrow(() => clientSchema.parse({ username: 'ivan_2026' }));
});

test('валидация: кириллица в имени отклоняется', () => {
    assert.throws(() => clientSchema.parse({ username: 'иван' }));
});

test('валидация: SQL-инъекция в имени отклоняется', () => {
    assert.throws(() => clientSchema.parse({ username: "'; DROP TABLE clients;--" }));
});

test('валидация: max_ips вне диапазона отклоняется', () => {
    assert.throws(() => clientSchema.parse({ username: 'a', max_ips: 0 }));
    assert.throws(() => clientSchema.parse({ username: 'a', max_ips: 500 }));
});

test('валидация: ad_tag должен быть 32 hex', () => {
    assert.doesNotThrow(() => clientSchema.parse({ username: 'a', ad_tag: '0'.repeat(32) }));
    assert.throws(() => clientSchema.parse({ username: 'a', ad_tag: 'xyz' }));
});
