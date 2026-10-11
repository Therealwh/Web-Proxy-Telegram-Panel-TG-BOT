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

    // Игра — это IIFE без экспортов: состояние нужно, чтобы проверить
    // спавн и движение. В копию файла добавляется строка экспорта,
    // сам шаблон игры при этом не меняется.
    const source = fs.readFileSync(GAME_PATH, 'utf8').replace(
        /\}\)\(\);\s*$/,
        'window.__G = G; window.__X = { TANK_LEVELS, buildField, TILE, COLS, ROWS, ENEMY_SPAWN_COLS, PLAYER_SPAWN_COL };\n})();\n'
    );

    vm.createContext(sandbox);
    try {
        vm.runInContext(source, sandbox, { filename: 'game.js' });
    } catch (e) {
        errors.push('запуск: ' + e.message);
    }

    const key = listeners.get('keydown') || null;
    const keydown = key;
    const keyup = listeners.get('keyup') || null;

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

    /**
     * Настоящее нажатие клавиши: браузер присылает и code, и key.
     * `code` — физическая клавиша, `key` — символ по текущей раскладке.
     * @param {string} code физическая клавиша, например KeyW
     * @param {string} key  символ: 'w' в латинице, 'ц' в русской
     */
    const pressKey = (code, key) => {
        if (!keydown) return;
        try { keydown({ code, key, preventDefault() {} }); } catch (e) { errors.push(`ввод ${code}: ${e.message}`); }
    };
    const releaseKey = (code, key) => {
        if (!keyup) return;
        try { keyup({ code, key, preventDefault() {} }); } catch (e) { errors.push(`отпуск ${code}: ${e.message}`); }
    };

    return {
        errors, pump, press, pressKey, releaseKey, G: () => sandbox.window.__G,
        X: () => sandbox.window.__X,
        frames: () => frames, hasKeys: () => !!key,
    };
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

describe('спавн танка', () => {
    // Именно так выглядел баг «поворачивает, но не едет»: танк ставился
    // в угол клетки, занимал четыре клетки и упирался в кирпич. Направление
    // менялось, а позиция нет — игра выглядела сломанной.
    test('на всех уровнях под спавном игрока нет стен', () => {
        const g = boot();
        const X = g.X();
        const G = g.G();
        const solid = (c, r) => (c < 0 || r < 0 || c >= X.COLS || r >= X.ROWS
            ? true
            : [1, 2, 3, 4].includes(G.tiles[r * X.COLS + c]));

        const blocked = [];
        for (let n = 1; n <= X.TANK_LEVELS.length; n++) {
            G.tiles = X.buildField(X.TANK_LEVELS[n - 1], true).tiles;
            const c = X.PLAYER_SPAWN_COL, r = X.ROWS - 1;
            for (const [cc, rr] of [[c, r], [c, r - 1]]) {
                if (solid(cc, rr)) blocked.push(`ур.${n}: ${cc},${rr}`);
            }
        }
        assert.deepEqual(blocked, [],
            `спавн игрока заблокирован: ${blocked.slice(0, 10).join(', ')}`);
    });

    test('на всех уровнях точки выхода врагов свободны', () => {
        const g = boot();
        const X = g.X();
        const G = g.G();
        const solid = (c, r) => (c < 0 || r < 0 || c >= X.COLS || r >= X.ROWS
            ? true
            : [1, 2, 3, 4].includes(G.tiles[r * X.COLS + c]));

        const blocked = [];
        for (let n = 1; n <= X.TANK_LEVELS.length; n++) {
            G.tiles = X.buildField(X.TANK_LEVELS[n - 1], true).tiles;
            for (const c of X.ENEMY_SPAWN_COLS) {
                for (const r of [0, 1]) {
                    if (solid(c, r)) blocked.push(`ур.${n}: ${c},${r}`);
                }
            }
        }
        assert.deepEqual(blocked, [],
            `выход врагов заблокирован: ${blocked.slice(0, 10).join(', ')}`);
    });
});

describe('управление', () => {
    /** Зажимает клавишу, ждёт кадры и возвращает, на сколько сдвинулся танк. */
    function drive(g, code, key, frames = 25) {
        const p = g.G().player;
        const bx = p.x, by = p.y;
        g.pressKey(code, key);
        g.pump(frames);
        g.releaseKey(code, key);
        return { dx: p.x - bx, dy: p.y - by };
    }

    test('танк едет сразу после старта, а не только поворачивается', () => {
        const g = boot();
        g.pressKey('Enter', 'Enter');
        g.pump(20);
        assert.equal(g.G().state, 'play', 'игра не началась');

        // Вверх и вправо — проход из стартовой клетки заведомо свободен
        const up = drive(g, 'KeyW', 'w');
        assert.ok(up.dy < -5, `вверх не едет: ${up.dy.toFixed(1)}`);

        const right = drive(g, 'KeyD', 'd');
        assert.ok(right.dx > 5, `вправо не едет: ${right.dx.toFixed(1)}`);
    });

    test('WASD работает при русской раскладке и при CapsLock', () => {
        // Раньше читался только e.key: с русской раскладкой WASD не
        // работал совсем, а при CapsLock давал «W» вместо «w».
        const cases = [['KeyW', 'ц'], ['KeyD', 'в'], ['KeyW', 'W'], ['KeyW', 'w']];
        for (const [code, key] of cases) {
            const g = boot();
            g.pressKey('Enter', 'Enter');
            g.pump(20);
            const m = drive(g, code, key);
            const moved = Math.abs(m.dx) + Math.abs(m.dy);
            assert.ok(moved > 5,
                `${code} с key=${JSON.stringify(key)} не сработала: смещение ${moved.toFixed(1)}`);
        }
    });

    test('стрелки работают как раньше', () => {
        const g = boot();
        g.pressKey('Enter', 'Enter');
        g.pump(20);
        const m = drive(g, 'ArrowUp', 'ArrowUp');
        assert.ok(m.dy < -5, `стрелка вверх не едет: ${m.dy.toFixed(1)}`);
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