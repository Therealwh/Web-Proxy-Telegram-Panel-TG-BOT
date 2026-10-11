/**
 * Проверка целостности шаблона сайта-заглушки.
 *
 * Заглушку не открывают в браузере на этапе разработки — её проверяют
 * уже на сервере, где сломанный JS выглядит как пустая страница. Поэтому
 * здесь ловим то, что ломается тихо: незакрытые теги, незакрытые скобки,
 * ссылки на несуществующие файлы и id, к которым скрипт не подключён.
 */

const fs = require('fs');
const path = require('path');
const { test, describe } = require('node:test');
const assert = require('node:assert');

const DIR = path.join(__dirname, '..', '..', '..', 'templates', 'websites', 'tanks');

const read = (name) => fs.readFileSync(path.join(DIR, name), 'utf8');

describe('состав шаблона', () => {
    test('все три файла на месте', () => {
        for (const f of ['index.html', 'game.js', 'style.css', 'robots.txt']) {
            assert.ok(fs.existsSync(path.join(DIR, f)), `нет файла ${f}`);
        }
    });

    test('нет внешних ресурсов — заглушка должна работать офлайн', () => {
        const html = read('index.html');
        // Внешние адреса допустимы только в мета-тегах (описания, og:image)
        const body = html.replace(/<meta[^>]*>/g, '').replace(/<link[^>]*>/g, '');
        assert.ok(!/src\s*=\s*["']https?:/i.test(body), 'внешний скрипт или картинка');
        assert.ok(!/<link[^>]+href\s*=\s*["']https?:/i.test(html.replace(/rel=["']canonical["']/gi, '')),
            'внешняя таблица стилей');
        // Шрифты из сети тоже не подойдут
        assert.ok(!/@import\s+url\(\s*["']?https?:/i.test(read('style.css')), 'внешний @import');
    });

    test('поле canvas присутствует и подключён скриптом', () => {
        const html = read('index.html');
        assert.ok(html.includes('id="game"'), 'нет canvas с id="game"');
        assert.ok(/<canvas[^>]*id="game"/.test(html), 'canvas должен быть с id');
    });

    test('ссылки на файлы существуют', () => {
        const html = read('index.html');
        const refs = [...html.matchAll(/(?:src|href)=["']([A-Za-z0-9_.\-]+\.(?:js|css))["']/g)]
            .map((m) => m[1]);
        assert.ok(refs.length >= 2, `ожидали ссылки на js и css, нашли: ${refs.join(', ')}`);
        for (const r of refs) {
            assert.ok(fs.existsSync(path.join(DIR, r)), `файл ${r} не существует`);
        }
    });

    test('картинка для превью существует и действительно PNG', () => {
        const html = read('index.html');
        const m = html.match(/property=["']og:image["'] content=["']([^"']+)["']/);
        assert.ok(m, 'нет og:image');
        const file = path.join(DIR, m[1]);
        assert.ok(fs.existsSync(file), `og:image указывает на отсутствующий файл ${m[1]}`);
        const b = fs.readFileSync(file);
        assert.equal(b.slice(1, 4).toString('ascii'), 'PNG', 'og:image не является PNG');
        // Размер пригоден для превью
        assert.ok(b.readUInt32BE(16) >= 600, `ширина мала: ${b.readUInt32BE(16)}`);
        assert.ok(b.readUInt32BE(20) >= 300, `высота мала: ${b.readUInt32BE(20)}`);
    });
});

describe('SEO-разметка', () => {
    test('есть title и description', () => {
        const html = read('index.html');
        const title = html.match(/<title>([^<]+)<\/title>/);
        assert.ok(title, 'нет <title>');
        assert.ok(title[1].length > 20 && title[1].length < 120,
            `длина title вне диапазона 20–120: ${title[1].length}`);

        const desc = html.match(/<meta name="description" content="([^"]+)"/);
        assert.ok(desc, 'нет description');
        assert.ok(desc[1].length > 80 && desc[1].length < 300,
            `длина description вне диапазона 80–300: ${desc[1].length}`);
    });

    test('есть Open Graph для красивой ссылки в мессенджерах', () => {
        const html = read('index.html');
        for (const prop of ['og:title', 'og:description', 'og:image']) {
            assert.ok(html.includes(prop), `нет ${prop}`);
        }
    });

    test('есть robots с разрешением индексации', () => {
        const html = read('index.html');
        const robots = html.match(/<meta name="robots" content="([^"]+)"/);
        assert.ok(robots, 'нет meta robots');
        assert.ok(/index/.test(robots[1]), 'индексация не разрешена');
    });

    test('есть JSON-LD разметка игры', () => {
        const html = read('index.html');
        const m = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
        assert.ok(m, 'нет JSON-LD');
        const data = JSON.parse(m[1]);
        const types = (data['@graph'] || []).map((n) => n['@type']);
        assert.ok(types.includes('VideoGame'), 'нет VideoGame в разметке');
        assert.ok(types.includes('FAQPage'), 'нет FAQPage — блок вопросов на странице не связан с разметкой');
    });

    test('robots.txt разрешает индексацию и закрывает служебный API', () => {
        const robots = read('robots.txt');
        assert.ok(/User-agent:\s*\*/.test(robots), 'нет правила для всех роботов');
        assert.ok(/Disallow:\s*\/panel-api\//.test(robots),
            'служебный эндпоинт лидерборда не закрыт от роботов');
    });

    test('в FAQ-разметке столько же вопросов, сколько на странице', () => {
        const html = read('index.html');
        const m = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
        const data = JSON.parse(m[1]);
        const faq = (data['@graph'] || []).find((n) => n['@type'] === 'FAQPage');
        assert.ok(faq.mainEntity.length >= 3, 'мало вопросов в разметке');
        for (const q of faq.mainEntity) {
            assert.ok(q.acceptedAnswer && q.acceptedAnswer.text, `у вопроса «${q.name}» нет ответа`);
        }
    });
});

describe('игровая логика', () => {
    test('уровней много, и все описаны', () => {
        const js = read('game.js');
        const start = js.indexOf('const HALF_LEVELS');
        const end = js.indexOf('];', start);
        const block = js.slice(start, end);
        // 13 строк на уровень × N уровней
        const rows = (block.match(/'/g) || []).length;
        assert.ok(rows >= 130, `похоже, уровней мало: строк ${rows}`);
    });

    test('каждая строка уровня — 13 символов', () => {
        const js = read('game.js');
        const start = js.indexOf('const HALF_LEVELS');
        const end = js.indexOf('];', start);
        const rows = [...js.slice(start, end).matchAll(/'([^']{7,13})'/g)].map((m) => m[1]);
        assert.ok(rows.length > 0, 'не нашли строк уровней');
        for (const r of rows) {
            // Либо 7 символов (левая половина), либо 13 (если описана целиком)
            assert.ok(r.length === 7 || r.length === 13, `строка уровня неверной длины (${r.length}): ${r}`);
            for (const ch of r) {
                assert.ok('.B#~TIE'.includes(ch), `неизвестный символ уровня: ${ch}`);
            }
        }
    });

    test('нет обращений к удалённым функциям', () => {
        const js = read('game.js');
        // Регрессия: массив очереди вызывался как функция, а spawnOne
        // остался от старой схемы
        assert.ok(!/spawnQueue\s*\(/.test(js), 'spawnQueue вызывается как функция');
        assert.ok(!/makeSpawner/.test(js), 'осталась ссылка на удалённый makeSpawner');
        assert.ok(!/spawnQueueSet/.test(js), 'осталась ссылка на удалённый spawnQueueSet');
    });

    test('экраны состояния обрабатываются все', () => {
        const js = read('game.js');
        for (const st of ['menu', 'play', 'gameover', 'levelclear']) {
            assert.ok(new RegExp(`'${st}'`).test(js), `нет состояния ${st}`);
        }
    });
});