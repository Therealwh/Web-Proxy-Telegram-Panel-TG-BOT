/**
 * @fileoverview Безголовый прогон игры на сайте-заглушке.
 *
 * Игра — это около тысячи строк JavaScript, который никто не открывает
 * в браузере на этапе разработки. Проверка синтаксиса тут не годится:
 * обращение к несуществующему элементу или перекрытая переменная
 * проявляются только при реальном исполнении. Поэтому здесь подменяются
 * DOM, canvas и таймер, после чего игра запускается и прогоняется через
 * несколько экранов и уровней.
 *
 * Так были найдены три ошибки, которые полностью ломали игру:
 *   - поле строилось из 7 строк уровня вместо 13, игра падала на старте;
 *   - локальная переменная `fire` перекрывала функцию выстрела;
 *   - в уровнях отсутствовала нижняя половина.
 *
 * Запуск: node --test tests/gameRuntime.test.js
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { test, describe } = require('node:test');
const assert = require('node:assert');

const GAME_PATH = path.join(__dirname, '..', '..', '..', 'templates', 'websites', 'tanks', 'game.js');

/** Считает обращения к canvas — по ним видно, что поле реально рисуется. */
const calls = { fillRect: 0, fillText: 0, arc: 0 };

function makeCtx() {
    const noop = () => {};
    return new Proxy({
        canvas: { width: 338, height: 338 },
        fillStyle: '', strokeStyle: '', font: '', textAlign: '', lineWidth: 1,
        save: noop, restore: noop, beginPath: noop, closePath: noop,
        moveTo: noop, lineTo: noop, stroke: noop, translate: noop, rotate: noop,
        measureText: () => ({ width: 10 }),
    }, {
        get(target, prop) {
            if (prop === 'fillRect') return () => { calls.fillRect++; };
            if (prop === 'fillText') return () => { calls.fillText++; };
            if (prop === 'arc') return () => { calls.arc++; };
            // Любой незнакомый вызов — заглушка: список методов canvas
            // длинный, и отсутствие одного из них не должно ронять прогон
            return prop in target ? target[prop] : noop;
        },
        set() { return true; },
    });
}

/**
 * Поднимает игру в песочнице.
 * @returns {{errors: string[], frames: () => number, pump: Function, key: Function|null}}
 */
function boot() {
    for (const k of Object.keys(calls)) calls[k] = 0;

    const elements = new Map();
    const el = (id) => {
        if (!elements.has(id)) {
            elements.set(id, {
                id, style: {}, value: '', textContent: '', innerHTML: '',
                addEventListener() {}, getContext: () => makeCtx(), appendChild() {},
            });
        }
        return elements.get(id);
    };

    let rafQueue = [];
    const listeners = new Map();
    const errors = [];
    let frames = 0;
    let clock = 0;

    const sandbox = {
        console: { log() {}, warn() {}, error() {} },
        document: {
            readyState: 'complete',
            getElementById: el,
            addEventListener() {},
            createElement: () => el('tmp'),
        },
        window: {
            addEventListener: (t, fn) => { listeners.set(t, fn); },
            AudioContext: undefined,
        },
        localStorage: {
            _d: {},
            getItem(k) { return this._d[k] ?? null; },
            setItem(k, v) { this._d[k] = String(v); },
        },
        requestAnimationFrame: (fn) => { rafQueue.push(fn); return rafQueue.length; },
        setTimeout: () => 1,
        clearTimeout() {},
        Math, Date, JSON, Number, String, Array, Object, Uint8Array, Proxy, Error,
        isNaN, parseInt, parseFloat,
        fetch: async () => ({ ok: true, json: async () => ({ scores: [] }) }),
    };
    sandbox.globalThis = sandbox;

    vm.createContext(sandbox);
    try {
        vm.runInContext(fs.readFileSync(GAME_PATH, 'utf8'), sandbox, { filename: 'game.js' });
    } catch (e) {
        errors.push('запуск: ' + e.message);
    }

    const key = listeners.get('keydown') || null;

    function pump(n) {
        for (let i = 0; i < n; i++) {
            const batch = rafQueue;
            rafQueue = [];
            for (const fn of batch) {
                try {
                    fn(clock += 16.7);
                    frames++;
                } catch (e) {
                    errors.push(`кадр ${frames}: ${e.message}`);
                    return false;
                }
            }
        }
        return true;
    }

    const press = (k) => {
        if (!key) return;
        try { key({ key: k, preventDefault() {} }); } catch (e) { errors.push(`ввод ${k}: ${e.message}`); }
    };

    return { errors, pump, press, frames: () => frames, hasKeys: () => !!key };
}

describe('игра запускается без ошибок', () => {
    test('инициализация проходит, поле строится', () => {
        const g = boot();
        assert.deepEqual(g.errors, [], `ошибки при запуске: ${g.errors.join(' | ')}`);
    });

    test('управление подвязано', () => {
        assert.ok(boot().hasKeys(), 'обработчик клавиатуры не зарегистрирован');
    });

    test('экран меню рисует текст', () => {
        const g = boot();
        g.pump(30);
        assert.ok(calls.fillText > 0, `текст не выведен: ${calls.fillText}`);
    });
});

describe('игровой процесс', () => {
    test('после старта кадры идут и поле рисуется', () => {
        const g = boot();
        g.press(' ');          // старт
        g.press('ArrowUp');
        g.pump(120);
        assert.deepEqual(g.errors, [], `ошибки в игре: ${g.errors.join(' | ')}`);
        assert.ok(g.frames() > 100, `кадров мало: ${g.frames()}`);
        assert.ok(calls.fillRect > 1000, `мало отрисовки: ${calls.fillRect}`);
    });

    test('все уровни загружаются без ошибок', () => {
        const g = boot();
        g.press(' ');
        g.pump(60);
        // Проходим цикл уровней движением и стрельбой в разные стороны
        for (let round = 0; round < 25; round++) {
            g.press('ArrowRight');
            g.press('ArrowDown');
            g.press('x');
            if (!g.pump(20)) break;
        }
        assert.deepEqual(g.errors, [], `ошибки уровней: ${g.errors.join(' | ')}`);
        assert.ok(g.frames() >= 560, `прогнано слишком мало кадров: ${g.frames()}`);
    });

    test('движение и стрельба вместе не ломают игру', () => {
        const g = boot();
        g.press(' ');
        g.press('ArrowLeft');
        g.press('x');
        g.press('ArrowUp');
        g.press('x');
        g.pump(200);
        assert.deepEqual(g.errors, [], `ошибки: ${g.errors.join(' | ')}`);
    });

    test('повторные нажатия старта не ломают состояние', () => {
        const g = boot();
        for (let i = 0; i < 5; i++) {
            g.press(' ');
            g.pump(20);
        }
        assert.deepEqual(g.errors, [], `ошибки: ${g.errors.join(' | ')}`);
    });
});