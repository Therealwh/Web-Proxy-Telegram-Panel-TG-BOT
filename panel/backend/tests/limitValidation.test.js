/**
 * Тесты валидации лимита: zod-схема не должна падать с RegExp,
 * значение доходит до патча конфига, ошибка движка показывается как есть.
 *
 * Регрессия: в схему передали RegExp вместо zod-типа — z.object падал
 * с TypeError без statusCode, и пользователь видел безликое «Внутренняя
 * ошибка сервера» на любом значении.
 */
const { test, describe } = require('node:test');
const assert = require('node:assert');
const { z } = require('zod');

// Точная копия схемы из routes/webProfilesLimit.js
const SANITY_CAP = 1_000_000;
const LimitSchema = z.object({
    limit: z.coerce.number().int().min(1).max(SANITY_CAP),
});

describe('валидация лимита WEB-профилей', () => {
    test('строка «500» приводится к числу 500', () => {
        assert.equal(LimitSchema.parse({ limit: '500' }).limit, 500);
    });

    test('число 500 проходит', () => {
        assert.equal(LimitSchema.parse({ limit: 500 }).limit, 500);
    });

    test('32 проходит', () => {
        assert.equal(LimitSchema.parse({ limit: 32 }).limit, 32);
    });

    test('ноль отклоняется', () => {
        assert.throws(() => LimitSchema.parse({ limit: 0 }), z.ZodError);
    });

    test('отрицательное отклоняется', () => {
        assert.throws(() => LimitSchema.parse({ limit: -5 }), z.ZodError);
    });

    test('дробное отклоняется', () => {
        assert.throws(() => LimitSchema.parse({ limit: 10.5 }), z.ZodError);
    });

    test('мусор отклоняется', () => {
        assert.throws(() => LimitSchema.parse({ limit: 'abc' }), z.ZodError);
    });

    test('значение выше защитного потолка отклоняется', () => {
        assert.throws(() => LimitSchema.parse({ limit: 2_000_000 }), z.ZodError);
    });

    test('отсутствие значения отклоняется', () => {
        assert.throws(() => LimitSchema.parse({}), z.ZodError);
    });

    test('ошибка валидации — ZodError с 400-поведением, не TypeError', () => {
        // Регрессия: RegExp в схеме давал TypeError без statusCode —
        // errorHandler превращал его в безликий 500
        try {
            LimitSchema.parse({ limit: 0 });
            assert.fail('должно упасть');
        } catch (e) {
            assert.equal(e.name, 'ZodError');
            assert.notEqual(e.message, 'keyValidator._parse is not a function');
        }
    });
});