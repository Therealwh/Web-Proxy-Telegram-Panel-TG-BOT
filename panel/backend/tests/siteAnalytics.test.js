/**
 * Тесты сборки сайта с аналитикой.
 *
 * Счётчики и верификация живут в analytics.html и подставляются в
 * index.html при применении шаблона. Если сборка сломается, метрика
 * молча перестанет работать — это видно только по отсутствию счётчика
 * на живом сайте, поэтому логика сборки проверяется здесь.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');

const { MARKER, buildIndex, preserveAnalytics, restoreAnalytics } = require('../services/siteAnalytics');

const TPL = path.join(__dirname, '..', '..', '..', 'templates', 'websites', 'tanks');

let tmp;

beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tggate-analytics-'));
});

afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
});

const write = (name, content) => fs.writeFileSync(path.join(tmp, name), content, 'utf8');
const read = (name) => fs.readFileSync(path.join(tmp, name), 'utf8');

describe('подстановка аналитики в сайт', () => {
    test('маркер в шаблоне index.html существует', () => {
        const html = fs.readFileSync(path.join(TPL, 'index.html'), 'utf8');
        assert.ok(html.includes(MARKER), `нет маркера ${MARKER} в шаблоне`);
        // Маркер обязан быть в head: верификация и счётчик там и работают
        const head = html.slice(0, html.indexOf('</head>'));
        assert.ok(head.includes(MARKER), 'маркер должен быть внутри <head>');
    });

    test('analytics.html в шаблоне есть и содержит инструкции', () => {
        const a = fs.readFileSync(path.join(TPL, 'analytics.html'), 'utf8');
        assert.match(a, /yandex-verification/, 'нет заготовки верификации');
        assert.match(a, /mc\.yandex\.ru/, 'нет заготовки Метрики');
        assert.match(a, /ЗАМЕНИТЕ_МЕНЯ/, 'нет пометки, куда вставлять код');
    });

    test('подстановка заменяет маркер содержимым файла', () => {
        write('index.html', `<head>${MARKER}</head>`);
        write('analytics.html', '<meta name="yandex-verification" content="abc">');
        assert.equal(buildIndex(tmp), true);
        assert.equal(read('index.html'), '<head><meta name="yandex-verification" content="abc"></head>');
    });

    test('без analytics.html маркер просто убирается', () => {
        write('index.html', `<head>${MARKER}</head>`);
        assert.equal(buildIndex(tmp), true);
        assert.equal(read('index.html'), '<head></head>');
    });

    test('если маркера нет, файл не трогается', () => {
        write('index.html', '<head>чистый файл</head>');
        write('analytics.html', '<meta name="x">');
        assert.equal(buildIndex(tmp), false);
        assert.equal(read('index.html'), '<head>чистый файл</head>');
    });

    test('пользовательская аналитика переживает обновление шаблона', () => {
        // Имитация apply-template: сохранить -> перезаписать -> восстановить
        write('analytics.html', '<!-- мой счётчик 12345678 -->');
        const saved = preserveAnalytics(tmp);
        assert.ok(saved && saved.includes('12345678'), 'не сохранился');

        fs.rmSync(tmp, { recursive: true, force: true });
        fs.mkdirSync(tmp, { recursive: true });
        write('index.html', `<head>${MARKER}</head>`);

        restoreAnalytics(tmp, saved);
        assert.ok(read('analytics.html').includes('12345678'), 'не восстановился');

        buildIndex(tmp);
        assert.ok(read('index.html').includes('12345678'), 'не подставился в index.html');
    });

    test('отсутствие analytics.html при обновлении не ломает сборку', () => {
        assert.equal(preserveAnalytics(tmp), null);
        restoreAnalytics(tmp, null);
        write('index.html', `<head>${MARKER}</head>`);
        assert.equal(buildIndex(tmp), true);
        assert.equal(read('index.html'), '<head></head>');
    });

    test('собранная страница получает заготовку аналитики', () => {
        // Заготовка закомментирована, пока пользователь не вставил свой ID:
        // важно, что она попадает в собранный файл и маркер исчезает
        write('index.html', `<head>${MARKER}</head>`);
        write('analytics.html', fs.readFileSync(path.join(TPL, 'analytics.html'), 'utf8'));
        buildIndex(tmp);
        const html = read('index.html');
        assert.ok(html.includes('mc.yandex.ru'), 'заготовка Метрики не попала в собранный файл');
        assert.ok(html.includes('yandex-verification'), 'заготовка верификации не попала');
        assert.ok(!html.includes(MARKER), 'маркер остался в собранном файле');
        // Закомментированная заготовка ничего не выполняет: счётчика нет,
        // пока пользователь не вставит свой номер
        const active = html.replace(/<!--[\s\S]*?-->/g, '');
        assert.ok(!active.includes('ym('), 'активный счётчик в заготовке не должен выполняться');
    });
});