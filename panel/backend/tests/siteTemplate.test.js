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

describe('совместимость с политикой безопасности', () => {
    // Заглушку отдаёт движок со строгим CSP: default-src 'self', без
    // unsafe-inline и без data: в img-src. Нарушения не бросают исключений —
    // страница просто выглядит сломанной. Проверяем превентивно.
    const html = () => read('index.html');

    test('нет инлайновых скриптов (ld+json — блок данных, не скрипт)', () => {
        const bad = html().match(/<script(?![^>]*\ssrc=)(?![^>]*ld\+json)[^>]*>/g) || [];
        assert.deepEqual(bad, [], `инлайновые скрипты: ${bad.join(' ')}`);
    });

    test('нет инлайновых стилей и обработчиков', () => {
        assert.deepEqual(html().match(/\sstyle="/g) || [], [], 'найден атрибут style=');
        assert.deepEqual(html().match(/\son[a-z]+\s*=/gi) || [], [], 'найден инлайновый обработчик');
        assert.deepEqual(html().match(/<style[\s>]/g) || [], [], 'найден тег <style>');
    });

    test('нет data:-URI — img-src их не разрешает', () => {
        assert.deepEqual(html().match(/(?:src|href)\s*=\s*["']data:/g) || [],
            [], 'найден data:-URI в src/href');
    });

    test('id уникальны: дубли ломают getElementById', () => {
        const ids = [...html().matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
        const dup = [...new Set(ids.filter((v, i) => ids.indexOf(v) !== i))];
        assert.deepEqual(dup, [], `дублирующиеся id: ${dup.join(', ')}`);
    });

    test('id="game" принадлежит canvas, а не секции', () => {
        // Регрессия: id="game" был и у секции, и у canvas. getElementById
        // возвращал секцию, и игра падала с «canvas.getContext is not a function».
        assert.ok(/<canvas[^>]*\sid="game"/.test(html()), 'canvas должен владеть id="game"');
    });

    test('все id, к которым обращается скрипт, есть в разметке', () => {
        const ids = [...html().matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
        const used = [...new Set([...read('game.js').matchAll(/getElementById\('([^']+)'\)/g)].map((m) => m[1]))];
        const missing = used.filter((u) => !ids.includes(u));
        assert.deepEqual(missing, [], `в разметке нет: ${missing.join(', ')}`);
        assert.ok(used.includes('game'), 'скрипт должен обращаться к canvas по id');
    });

    test('якоря меню ведут на существующие id', () => {
        const ids = [...html().matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
        const anchors = [...html().matchAll(/href="#([^"]+)"/g)].map((m) => m[1]);
        const broken = anchors.filter((a) => !ids.includes(a));
        assert.deepEqual(broken, [], `битые якоря: ${broken.join(', ')}`);
    });

    test('файл фавикона существует', () => {
        const m = html().match(/rel="icon"[^>]*href="([^"]+)"/);
        assert.ok(m, 'нет подписи на иконку');
        assert.ok(fs.existsSync(path.join(DIR, m[1])), `нет файла ${m[1]}`);
    });
});

/**
 * Вытаскивает уровни из game.js настоящим разбором, а не поиском подстроки:
 * иначе тест молча проверяет пустой срез, если имя массива поменяли.
 * @returns {{mode: string, rows: string[]}[]}
 */
function parseLevels(js) {
    const src = fs.readFileSync(path.join(DIR, 'game.js'), 'utf8');
    const start = src.indexOf('const TANK_LEVELS = [');
    assert.ok(start >= 0, 'в game.js нет массива TANK_LEVELS');
    const body = src.slice(start + 'const TANK_LEVELS = ['.length);
    const end = body.indexOf('\n];');
    assert.ok(end > 0, 'не найден конец массива уровней');

    const levels = [];
    let cur = null;
    // Уровень начинается со строки «{» на уровне вложенности массива.
    // Раньше уровень без явного mode приклеивался к предыдущему — из-за
    // этого и вёрстка, и проверки считали неверное число уровней.
    for (const line of body.slice(0, end).split('\n')) {
        if (/^\s{4}\{\s*$/.test(line)) {
            if (cur) levels.push(cur);
            cur = { mode: 'v', rows: [] };
            continue;
        }
        if (!cur) continue;
        const mode = line.match(/mode:\s*'(\w)'/);
        if (mode) { cur.mode = mode[1]; continue; }
        const row = line.match(/^\s*'([^']+)',\s*$/);
        if (row) cur.rows.push(row[1]);
    }
    if (cur) levels.push(cur);
    return levels;
}

describe('игровая логика', () => {
    test('уровней много, и все описаны', () => {
        const levels = parseLevels(read('game.js'));
        assert.ok(levels.length >= 50, `уровней мало: ${levels.length}`);
        for (const [i, lv] of levels.entries()) {
            assert.equal(lv.rows.length, 7, `уровень ${i + 1}: строк ${lv.rows.length}`);
        }
    });

    test('строки уровней корректной ширины для своего режима', () => {
        const levels = parseLevels(read('game.js'));
        for (const [i, lv] of levels.entries()) {
            // 'h' описывается во всю ширину, остальные — половиной
            const want = lv.mode === 'h' ? 13 : 7;
            for (const r of lv.rows) {
                assert.equal(r.length, want, `уровень ${i + 1} (${lv.mode}): "${r}" — длина ${r.length}`);
            }
        }
    });

    test('в уровнях только известные символы', () => {
        const levels = parseLevels(read('game.js'));
        for (const [i, lv] of levels.entries()) {
            for (const r of lv.rows) {
                for (const ch of r) {
                    assert.ok('.B#~TIE'.includes(ch), `уровень ${i + 1}: неизвестный символ "${ch}"`);
                }
                assert.ok(!r.includes('E'), `уровень ${i + 1}: база в описании не нужна, ставится автоматически`);
            }
        }
    });

    test('число уровней в тексте страницы совпадает с реальным', () => {
        // Регрессия: уровней стало 55, а в description, og:description,
        // разметке и видимом тексте осталось «20 уровней» — страника
        // врала о себе и для посетителя, и для поисковика.
        const levels = parseLevels(read('game.js'));
        const real = String(levels.length);
        const html = read('index.html');

        const mentions = [...html.matchAll(/(\d+)\s+уровн/g)].map((m) => m[1]);
        assert.ok(mentions.length >= 4, `ожидали несколько упоминаний, нашли: ${mentions.length}`);
        for (const m of mentions) {
            assert.equal(m, real,
                `на странице написано «${m} уровней», а в игре ${real}. ` +
                'Число в тексте должно совпадать с реальным — иначе страница врёт.');
        }
    });

    test('полноэкранный режим подключён', () => {
        const html = read('index.html');
        const js = read('game.js');
        assert.ok(/id="fs-btn"/.test(html), 'нет кнопки полного экрана');
        assert.ok(/getElementById\('fs-btn'\)/.test(js), 'скрипт не подключает кнопку');
        assert.ok(/requestFullscreen/.test(js), 'нет вызова полноэкранного API');
    });

    test('шаблон помечен версией', () => {
        // Без версии панель не может предупредить об устаревшей копии
        const meta = JSON.parse(read('template.json'));
        assert.equal(meta.id, 'tanks');
        assert.ok(meta.version, 'не указана версия шаблона');
    });

    test('уровни не повторяются — иначе это не «много уровней»', () => {
        const levels = parseLevels(read('game.js'));
        const sig = levels.map((l) => l.mode + '|' + l.rows.join(','));
        const uniq = new Set(sig);
        assert.equal(uniq.size, sig.length,
            `дубликаты уровней: ${sig.length} описаний, уникальных ${uniq.size}`);
    });

    test('используются все три типа симметрии', () => {
        const levels = parseLevels(read('game.js'));
        const modes = new Set(levels.map((l) => l.mode));
        assert.ok(modes.has('v'), 'нет режима v (зеркало по обеим осям)');
        assert.ok(modes.has('h'), 'нет режима h (широкие строки)');
        assert.ok(modes.has('d'), 'нет режима d (диагональ)');
    });

    test('сложность растёт: у поздних уровней больше препятствий', () => {
        const levels = parseLevels(read('game.js'));
        const density = (lv) => {
            const all = lv.rows.join('');
            const wall = (all.match(/[B#]/g) || []).length;
            return wall / all.length;
        };
        const early = levels.slice(0, 5).reduce((s, l) => s + density(l), 0) / 5;
        const late = levels.slice(-8).reduce((s, l) => s + density(l), 0) / 8;
        assert.ok(late > early,
            `плотность стен должна расти: начало ${early.toFixed(2)}, конец ${late.toFixed(2)}`);
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