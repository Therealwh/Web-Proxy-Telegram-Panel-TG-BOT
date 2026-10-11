/**
 * @fileoverview Тесты фильтра журнала действий (/api/audit).
 * Фильтр собирает SQL из пользовательского ввода — важно, что значения
 * всегда идут параметрами, а не склейкой строки.
 * Запуск: JWT_SECRET=test node --test tests/
 */

process.env.JWT_SECRET = 'test-secret-for-unit-tests';

const { test } = require('node:test');
const assert = require('node:assert');
const { buildFilter } = require('../routes/audit');

test('audit: без фильтров условие пустое, параметров нет', () => {
    const { sql, params } = buildFilter({});
    assert.strictEqual(sql, '1=1');
    assert.deepStrictEqual(params, []);
});

test('audit: фильтр по администратору параметризуется', () => {
    const { sql, params } = buildFilter({ admin: 'demo' });
    assert.match(sql, /admin = \?/);
    assert.deepStrictEqual(params, ['demo']);
});

test('audit: фильтр по методу использует LIKE с префиксом', () => {
    const { sql, params } = buildFilter({ action: 'DELETE' });
    assert.match(sql, /action LIKE \?/);
    assert.deepStrictEqual(params, ['DELETE%']);
});

test('audit: поиск фильтрует по action, details и ip', () => {
    const { sql, params } = buildFilter({ search: 'клиент' });
    assert.match(sql, /action LIKE \? OR details LIKE \? OR ip LIKE \?/);
    assert.deepStrictEqual(params, ['%клиент%', '%клиент%', '%клиент%']);
});

test('audit: диапазон дат добавляет обе границы', () => {
    const { sql, params } = buildFilter({ from: '2026-01-01', to: '2026-12-31' });
    assert.match(sql, /created_at >= \?/);
    assert.match(sql, /created_at <= \?/);
    assert.deepStrictEqual(params, ['2026-01-01', '2026-12-31']);
});

test('audit: значения фильтров не попадают в SQL как есть (инъекция)', () => {
    const evil = "'; DROP TABLE audit_log; --";
    const { sql, params } = buildFilter({ admin: evil });
    assert.ok(!sql.includes('DROP'), 'вредоносная строка не должна попадать в SQL');
    assert.deepStrictEqual(params, [evil], 'значение должно уйти параметром');
});

test('audit: несколько фильтров объединяются через AND', () => {
    const { sql, params } = buildFilter({ admin: 'demo', action: 'POST', from: '2026-01-01' });
    assert.strictEqual((sql.match(/ AND /g) || []).length, 3);
    assert.deepStrictEqual(params, ['demo', 'POST%', '2026-01-01']);
});

test('audit: превышение длины фильтра отклоняется схемой', () => {
    assert.throws(() => buildFilter({ search: 'x'.repeat(201) }));
    assert.throws(() => buildFilter({ admin: 'x'.repeat(65) }));
});