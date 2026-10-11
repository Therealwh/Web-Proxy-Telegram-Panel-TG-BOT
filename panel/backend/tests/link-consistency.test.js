/**
 * @fileoverview Сторож: ни одно место, где пользователю показывают ссылку
 * MTProto, не должно забывать про Fake TLS.
 *
 * Такая ошибка уже была: в уведомлении «Администратор выдал вам прокси»
 * Fake TLS не выводился, и при выдаче админом клиент получал только dd,
 * хотя при оплате получал обе ссылки. Расхождение заметил пользователь.
 *
 * Проверка текстовая, но ловит именно этот класс ошибок: если новое
 * место выводит mtproto_https и рядом нет mtproto_faketls_https — тест падает.
 * Запуск: node --test tests/link-consistency.test.js
 */

const fs = require('fs');
const path = require('path');
const { test, describe, before } = require('node:test');
const assert = require('node:assert');

// Обязательные переменные окружения — до подключения services/links
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-for-unit-tests';

const ROOT = path.join(__dirname, '..');

/** Файлы, где формируются сообщения со ссылками для пользователей. */
const FILES = [
    path.join(ROOT, 'services', 'bot.js'),
    path.join(ROOT, 'services', 'notifier.js'),
    path.join(ROOT, 'routes', 'bot.js'),
    path.join(ROOT, 'routes', 'apiV1.js'),
    path.join(ROOT, 'routes', 'qr.js'),
];

describe('ссылки MTProto выдаются вместе с Fake TLS', () => {
    for (const file of FILES) {
        test(`${path.relative(ROOT, file)}: нет сообщения без Fake TLS`, () => {
            const src = fs.readFileSync(file, 'utf8');
            const lines = src.split('\n');

            const problems = [];
            lines.forEach((line, i) => {
                // Рассматриваем только то, что реально уходит пользователю:
                // текст сообщения или кнопка. Генерация QR и раздача объекта
                // ссылок наружу (API, /qr) — другая задача, там ключ и так есть.
                const userFacing = /text\s*\+=|lines\.push|kb\.url/.test(line);
                if (!userFacing) return;
                if (!/links\.mtproto(_https)?\b/.test(line)) return;
                // Полная раздача объекта — Fake TLS там приезжает сам
                if (/:\s*clientLinks\(|links\s*:\s*clientLinks\(/.test(line)) return;

                // Fake TLS может идти следующей строкой, иногда через комментарий
                const window = lines.slice(i, i + 8).join('\n');
                if (!/mtproto_faketls/.test(window)) {
                    problems.push(`строка ${i + 1}: ${line.trim()}`);
                }
            });

            assert.deepEqual(problems, [], `сообщения без Fake TLS:\n${problems.join('\n')}`);
        });
    }
});

describe('Fake TLS не выдаётся молча при неготовом домене', () => {
    test('ссылка ee формируется только при готовой проверке домена', () => {
        const { fakeTlsSecret } = require('../services/links');
        // Без домена маскировки секрет не собирается вовсе
        assert.equal(fakeTlsSecret('a'.repeat(32), ''), null);
        assert.equal(fakeTlsSecret('a'.repeat(32), null), null);
    });
});