/**
 * Безголовый прогон новой игры.
 *
 * Страница переписана под жёсткий CSP, и проверить её глазами нельзя —
 * она живёт только на сервере. Этот прогон поднимает страницу в песочнице
 * с подменённым canvas и таймерами, запускает игру и смотрит, что
 * реальный код не падает и рисует поле.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { test, describe } = require('node:test');
const assert = require('node:assert');

const DIR = path.join(__dirname, '..', '..', '..', 'templates', 'websites', 'tanks');

function boot() {
    const canvasState = { ops: 0, fillText: 0, drawImage: 0 };
    const contexts = [];
    const listeners = new Map();
    const errors = [];
    let raf = [];
    let frames = 0;

    const makeCtx = (cv) => {
        const noop = () => {};
        const ctx = {
            canvas: cv,
            scale: noop, translate: noop, rotate: noop, save: noop, restore: noop,
            beginPath: noop, closePath: noop, moveTo: noop, lineTo: noop,
            stroke: noop, fill: noop, arc: noop, rect: noop, clearRect: noop,
            strokeRect: noop, drawImage: () => { canvasState.drawImage++; canvasState.ops++; },
            fillRect: () => { canvasState.ops++; },
            fillText: () => { canvasState.fillText++; canvasState.ops++; },
            measureText: () => ({ width: 10 }),
            getContext: null,
        };
        return ctx;
    };

    const makeCanvas = (w, h) => {
        const cv = {
            width: w || 300, height: h || 150, style: {},
            getContext: () => { const c = makeCtx(cv); contexts.push(c); return c; },
            addEventListener() {}, setPointerCapture() {},
            getBoundingClientRect: () => ({ left: 0, top: 0, width: 416, height: 416 }),
        };
        return cv;
    };

    const elements = new Map();
    const el = (id) => {
        if (!elements.has(id)) {
            elements.set(id, {
                id, style: {}, value: '', textContent: '', innerHTML: '', className: '',
                width: 300, height: 150,
                addEventListener() {}, appendChild() {}, removeChild() {},
                blur() {}, classList: { add() {}, remove() {}, toggle() {} },
                getContext: undefined,
                getBoundingClientRect: () => ({ left: 0, top: 0, width: 416, height: 416 }),
                setPointerCapture() {},
                children: [],
            });
            const e = elements.get(id);
            e.getContext = () => { const c = makeCtx(e); contexts.push(c); return c; };
        }
        return elements.get(id);
    };

    const sandbox = {
        console: { log() {}, warn() {}, error() {} },
        document: {
            readyState: 'complete',
            getElementById: el,
            createElement: (tag) => (tag === 'canvas' ? makeCanvas() : el('el-' + Math.random())),
            querySelector: () => el('qs'),
            querySelectorAll: () => [],
            addEventListener() {},
            hidden: false,
        },
        window: {
            addEventListener: (t, f) => { listeners.set(t, f); },
            devicePixelRatio: 1,
            AudioContext: undefined,
        },
        navigator: { clipboard: null },
        localStorage: {
            _d: {},
            getItem(k) { return this._d[k] ?? null; },
            setItem(k, v) { this._d[k] = String(v); },
        },
        requestAnimationFrame: (fn) => { raf.push(fn); return raf.length; },
        setTimeout: () => 1, clearTimeout() {}, setInterval: () => 1, clearInterval() {},
        btoa: (s) => Buffer.from(s, 'binary').toString('base64'),
        atob: (s) => Buffer.from(s, 'base64').toString('binary'),
        Math, Date, JSON, Number, String, Array, Object, Uint8Array, Error,
        isNaN, parseInt, parseFloat, Promise, Set, Map,
        fetch: async () => ({ ok: true, json: async () => ({ scores: [] }) }),
    };
    sandbox.globalThis = sandbox;
    vm.createContext(sandbox);

    try {
        vm.runInContext(fs.readFileSync(path.join(DIR, 'game.js'), 'utf8'), sandbox, { filename: 'game.js' });
    } catch (e) {
        errors.push('загрузка: ' + e.message);
    }

    const keydown = listeners.get('keydown');

    function pump(n) {
        for (let i = 0; i < n; i++) {
            const batch = raf;
            raf = [];
            for (const fn of batch) {
                try {
                    fn(frames * 16.7 + 16.7);
                    frames++;
                } catch (e) {
                    errors.push(`кадр ${frames}: ${e.message}`);
                    return false;
                }
            }
        }
        return true;
    }

    return {
        errors, pump, keydown, canvasState, contexts,
        frames: () => frames,
        press: (code) => { if (keydown) keydown({ code, preventDefault() {}, repeat: false }); },
    };
}

describe('новая игра запускается под жёстким CSP', () => {
    test('страница и код загружаются без ошибок', () => {
        const g = boot();
        assert.deepEqual(g.errors, [], `ошибки: ${g.errors.join(' | ')}`);
    });

    test('меню рисуется', () => {
        const g = boot();
        g.pump(30);
        assert.ok(g.canvasState.ops > 50, `мало операций рисования: ${g.canvasState.ops}`);
    });

    test('после старта идёт игровой процесс', () => {
        const g = boot();
        g.pump(20);
        g.press('Enter');       // «НАЧАТЬ ИГРУ»
        g.pump(200);            // интро + игровой кадры
        assert.deepEqual(g.errors, [], `ошибки в игре: ${g.errors.join(' | ')}`);
        assert.ok(g.frames() > 200, `кадров мало: ${g.frames()}`);
    });

    test('движение и стрельба не ломают игру', () => {
        const g = boot();
        g.pump(20);
        g.press('Enter');
        g.pump(160);
        g.press('KeyW'); g.press('Space');
        g.pump(120);
        g.press('KeyD');
        g.pump(120);
        assert.deepEqual(g.errors, [], `ошибки: ${g.errors.join(' | ')}`);
    });

    test('никаких data:URL и внешних ресурсов в коде', () => {
        const js = fs.readFileSync(path.join(DIR, 'game.js'), 'utf8');
        const html = fs.readFileSync(path.join(DIR, 'index.html'), 'utf8');
        assert.doesNotMatch(js, /toDataURL\(/, 'data:URL в JS умрут на img-src self');
        assert.doesNotMatch(js, /new Image\(/, 'new Image с data:URL умрёт');
        assert.doesNotMatch(js, /prompt\(/, 'prompt() заблокирован в ряде окружений');
        assert.doesNotMatch(html, /\sstyle="/, 'инлайновый style= блокируется style-src self');
        assert.doesNotMatch(html, /<style>/, 'инлайновый <style> блокируется');
        assert.doesNotMatch(html, /googleapis|gstatic|https?:\/\/[^\s"']*\.js/,
            'внешние ресурсы не пройдут default-src self');
        assert.doesNotMatch(html, /data:image/, 'data:URI в HTML заблокирован img-src self');
    });
});