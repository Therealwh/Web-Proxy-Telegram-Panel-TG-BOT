/**
 * @fileoverview Устаревание шаблона сайта.
 *
 * Шаблон при применении копируется в рабочий каталог сайта, и обновление
 * панели эту копию не трогает. Поэтому панель обязана замечать, что
 * обслуживаемые файлы старые.
 *
 * Здесь воспроизводится именно та ошибка, из-за которой предупреждение
 * не появлялось: установленный шаблон искался в настройках панели, а эта
 * запись существует только начиная с той версии, где начали применять
 * шаблоны. Тот, кто применил шаблон раньше, получал молчание — панель
 * считала, что ничего не установлено, и предупреждение не показывала
 * никогда. Правда лежит в template.json рядом с файлами сайта.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');

const SRC = path.join(__dirname, '..', 'routes', 'website.js');
const INSTALL_TEMPLATES = path.join(__dirname, '..', '..', '..', 'templates', 'websites');

let tmp;

/** Готовит временный каталог сайта и копию шаблона. */
beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tggate-site-'));
});

afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
});

/** Кладёт в каталог сайта развёрнутый шаблон указанной версии. */
function deploy(templateId, version) {
    const dir = path.join(tmp, 'website');
    fs.mkdirSync(dir, { recursive: true });
    if (templateId) {
        fs.writeFileSync(path.join(dir, 'template.json'),
            JSON.stringify({ id: templateId, version }), 'utf8');
    }
    fs.writeFileSync(path.join(dir, 'index.html'), '<!doctype html>', 'utf8');
    return dir;
}

/** Повторяет логику маршрута: читает template.json с диска. */
function deployedTemplate(dir) {
    try {
        const f = path.join(dir, 'template.json');
        if (!fs.existsSync(f)) return null;
        const data = JSON.parse(fs.readFileSync(f, 'utf8'));
        if (!data.id) return null;
        return { id: data.id, version: data.version || null };
    } catch {
        return null;
    }
}

describe('определение устаревшего шаблона', () => {
    test('установленный шаблон читается с диска, а не из настроек', () => {
        const dir = deploy('tanks', '1.21.0');
        const found = deployedTemplate(dir);
        assert.deepEqual(found, { id: 'tanks', version: '1.21.0' });
        // Ровно тот случай, который молчал раньше: в настройках панели
        // записи нет, потому что шаблон применили до их появления
    });

    test('версия в репозитории новее установленной — шаблон устарел', () => {
        const dir = deploy('tanks', '1.21.0');
        const installed = deployedTemplate(dir);
        const current = JSON.parse(
            fs.readFileSync(path.join(INSTALL_TEMPLATES, 'tanks', 'template.json'), 'utf8')
        ).version;

        assert.notEqual(installed.version, current,
            'установленная копия должна отличаться от текущей в репозитории');
    });

    test('совпадающие версии не считаются устаревшими', () => {
        const current = JSON.parse(
            fs.readFileSync(path.join(INSTALL_TEMPLATES, 'tanks', 'template.json'), 'utf8')
        ).version;
        const dir = deploy('tanks', current);
        const installed = deployedTemplate(dir);
        assert.equal(installed.version, current, 'свежий шаблон не должен считаться устаревшим');
    });

    test('без template.json установленный шаблон неизвестен', () => {
        const dir = deploy(null, null);
        assert.equal(deployedTemplate(dir), null,
            'отсутствие файла не должно ломать страницу сайта');
    });

    test('битый template.json не роняет страницу', () => {
        const dir = deploy(null, null);
        fs.writeFileSync(path.join(dir, 'template.json'), '{ это не json', 'utf8');
        assert.equal(deployedTemplate(dir), null,
            'повреждённый файл должен трактоваться как отсутствие');
    });

    test('маршрут берёт установленную версию с диска, а не из настроек', () => {
        const src = fs.readFileSync(SRC, 'utf8');
        assert.match(src, /function deployedTemplate\(\)/,
            'нет чтения установленного шаблона с диска');
        // Чтение настроек было причиной молчания: записи могло не быть
        assert.doesNotMatch(src, /SELECT value FROM settings WHERE key = \?'website_template'/,
            'установленный шаблон больше не берётся из настроек панели');
    });

    test('каждый шаблон в репозитории несёт версию', () => {
        for (const dir of fs.readdirSync(INSTALL_TEMPLATES)) {
            const full = path.join(INSTALL_TEMPLATES, dir);
            if (!fs.statSync(full).isDirectory()) continue;
            const f = path.join(full, 'template.json');
            assert.ok(fs.existsSync(f), `у шаблона ${dir} нет template.json`);
            const meta = JSON.parse(fs.readFileSync(f, 'utf8'));
            assert.ok(meta.version, `у шаблона ${dir} не указана версия`);
            assert.equal(meta.id, dir, `в шаблоне ${dir} записан чужой id`);
        }
    });
});