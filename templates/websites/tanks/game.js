/**
 * Танки — игра для сайта-заглушки.
 *
 * Всё в одном файле и без внешних ресурсов: заглушку открывают на чужом
 * устройстве и часто без интернета, поэтому ни CDN, ни шрифтов из сети.
 *
 * Поле — сетка 13×13 клеток, как в «Танчиках» с Денди. Кирпичи внутри
 * клетки делятся на 2×2 подклетки, поэтому стена разрушается постепенно,
 * а не целиком — это и даёт характер оригинала.
 */
(function () {
    'use strict';

/**
 * Уровни «Танчиков».
 *
 * Каждый уровень описан частью поля и достраивается симметрией — это
 * сокращает объём втрое и даёт правильную геометрию: поле всегда
 * симметрично относительно базы, как в оригинале.
 *
 * Тип симметрии задаётся полем mode:
 *   'v' (по умолчанию) — зеркало по обеим осям, описание 7×7;
 *   'h' — строки во всю ширину (13 символов), зеркало по вертикали;
 *   'd' — транспонирование, поле симметрично относительно диагонали.
 *
 * Обозначения: '.' пусто, 'B' кирпич, '#' сталь, '~' вода,
 * 'T' деревья, 'I' лёд. База ставится автоматически в центре низа.
 *
 * Сложность растёт по спирали: открытое поле, потом стены, затем вода
 * и лёд, под конец — плотные крепости и диагональные лабиринты.
 */
const TANK_LEVELS = [
    {
        rows: [
        '...B...',
        '...B...',
        '.......',
        '...B...',
        '.......',
        '...B...',
        '.......',
        ],
    },
    {
        rows: [
        '...BB..',
        '...BB..',
        '.......',
        '....B..',
        '.......',
        '....#..',
        '.......',
        ],
    },
    {
        rows: [
        '..~~~..',
        '..BBB..',
        '.......',
        '.....B#',
        '.......',
        '....#B#',
        '.......',
        ],
    },
    {
    mode: 'h',
        rows: [
        'BB.........BB',
        '.#..B...B..#.',
        '....BBB.B....',
        '.B..#...#..B.',
        '..#..B#B..#..',
        '.B.........B.',
        '.............',
        ],
    },
    {
        rows: [
        '.BB..#.',
        '.BB....',
        '.......',
        '..#...B',
        '.....B#',
        '..#..B.',
        '.......',
        ],
    },
    {
        rows: [
        'TTT.BBB',
        '...B...',
        'BB.....',
        '.......',
        '..BB.#.',
        '.......',
        'TT.BB..',
        ],
    },
    {
        rows: [
        '.##....',
        '.##..BB',
        '......#',
        '..BBB..',
        '..#....',
        '..BBB..',
        '......#',
        ],
    },
    {
    mode: 'h',
        rows: [
        '~.B.B.B.B.B.~',
        '..###...###..',
        '.B..B.B.B..B.',
        '...#..T..#...',
        '.B..B.B.B..B.',
        '..###...###..',
        '.............',
        ],
    },
    {
        rows: [
        '..III..',
        '..BBB..',
        '.......',
        'I....BB',
        '.......',
        'I....BB',
        '.......',
        ],
    },
    {
        rows: [
        'BBB.BBB',
        'B.B....',
        '...#..#',
        'B.B.B.B',
        '.......',
        'B.B.B.B',
        '...#..#',
        ],
    },
    {
    mode: 'd',
        rows: [
        'BBB.BBB',
        'B......',
        '.B..B..',
        '..B..#.',
        '...#.B.',
        '....#B.',
        '...#...',
        ],
    },
    {
        rows: [
        '.BB..#B',
        '.BB..#B',
        '.......',
        '####..B',
        '.......',
        '####..B',
        '.......',
        ],
    },
    {
        rows: [
        '..~~~II',
        '..BBBII',
        '.......',
        'I.#....',
        '.......',
        '..BBBII',
        '.......',
        ],
    },
    {
    mode: 'h',
        rows: [
        '#..#..#..#..#',
        '.B..B..B..B..',
        '#..#..#..#..#',
        '...B..B....B.',
        '.#.......#..#',
        '.............',
        '....#..#..#..',
        ],
    },
    {
        rows: [
        'B..B#..',
        'B..B#..',
        '......B',
        '####.BB',
        '.......',
        '####.BB',
        '......B',
        ],
    },
    {
        rows: [
        '#B#B#B.',
        '#......',
        '#.BBB#.',
        '#.#...#',
        '#...#B#',
        '#.BBB..',
        '#.#....',
        ],
    },
    {
    mode: 'h',
        rows: [
        '.B.B.B.B.B.B.',
        '.#.#.#.#.#.#.',
        '#.#.#.#.#.#.#',
        '.#.#.#.#.#.#.',
        'B.B.B.B.B.B.B',
        '.............',
        '.#..#..#..#..',
        ],
    },
    {
        rows: [
        '...##..',
        '...##.B',
        '.......',
        'BBB..#.',
        '.......',
        'BBB..#.',
        '.......',
        ],
    },
    {
    mode: 'd',
        rows: [
        '#..B#..',
        '.#.....',
        'B.#..B.',
        '.B....#',
        '#..#B..',
        '..B....',
        '.#...#B',
        ],
    },
    {
        rows: [
        'B.B.B.B',
        '.......',
        '..####.',
        '..#..B.',
        '.......',
        '..#..B.',
        '..####.',
        ],
    },
    {
    mode: 'h',
        rows: [
        'BB....#....BB',
        '.#....B....#.',
        '#..B.......B.',
        '.#...BBB...#.',
        '#..B.......B.',
        '.#....B....#.',
        '.............',
        ],
    },
    {
        rows: [
        'B.#.#.#',
        '.#.#.#.',
        '....B.B',
        '#B#....',
        '.......',
        '#B#....',
        '....B.B',
        ],
    },
    {
        rows: [
        'BB#BB#B',
        '..#..#.',
        'BB#BB#B',
        '......B',
        '.......',
        'BB#BB#B',
        '..#..#.',
        ],
    },
    {
    mode: 'd',
        rows: [
        '.BB#BB.',
        'B.#..#.',
        '.#..#..',
        '#..#BB.',
        '..B..#.',
        '.#..B..',
        'B#....#',
        ],
    },
    {
        rows: [
        '.~~~~~~',
        '~.BB.BB',
        '~......',
        '~..#...',
        '~......',
        '~..#...',
        '~~~~~~~',
        ],
    },
    {
        rows: [
        'TT#BBB#',
        '..B..I.',
        'BB.BIII',
        '..#B..#',
        '.......',
        '..#B..#',
        'BB.BIII',
        ],
    },
    {
    mode: 'h',
        rows: [
        '...#.....#...',
        '.B#B.BBB.B#B.',
        '.#..#...#..#.',
        '.B#B.BBB.B#B.',
        '...#.....#...',
        '.....B.B.....',
        '.............',
        ],
    },
    {
        rows: [
        '##BB##.',
        '.......',
        '.BBB...',
        '.#..#BB',
        '.......',
        '.#..#BB',
        '.BBB...',
        ],
    },
    {
        rows: [
        '~~..BBB',
        '~~.B...',
        '...B#B#',
        '..B..B.',
        '.......',
        '..B..B.',
        '...B#B#',
        ],
    },
    {
    mode: 'd',
        rows: [
        '#B#B#..',
        'B.....#',
        '.#..B..',
        'B.#..#.',
        '.B.B.B.',
        '#.....#',
        '.B#B#..',
        ],
    },
    {
        rows: [
        'B#B#B..',
        'B#B#B..',
        '...#..B',
        '..BB.BB',
        '.......',
        '..BB.BB',
        '...#..B',
        ],
    },
    {
    mode: 'h',
        rows: [
        '.BB.BB.BB.BB.',
        '#.##.##.##.#.',
        '....BBB..BBB.',
        '.#.#.....#.#.',
        '..BB#...#BB..',
        '.....B.B.....',
        '.............',
        ],
    },
    {
        rows: [
        'TTTT..#',
        '.B...#.',
        'BB..#B#',
        '.#.B.B.',
        '.......',
        '.#.B.B.',
        'BB..#B#',
        ],
    },
    {
        rows: [
        'I#I#I.#',
        'B.B...#',
        '#.#.BBB',
        '..#..B.',
        '.......',
        '..#..B.',
        '#.#.BBB',
        ],
    },
    {
        rows: [
        '..III.B',
        '.II.BBB',
        '.......',
        'BBB.#..',
        '.......',
        'BBB.#..',
        '.II.BBB',
        ],
    },
    {
    mode: 'h',
        rows: [
        '~~~..........',
        '.III.BBBB....',
        '....#.....#..',
        '.BBB.II.II.BB',
        '.............',
        '..#.....#....',
        '...BBB.BBB...',
        ],
    },
    {
        rows: [
        '~~..BB.',
        '~~.B..B',
        '...B#B#',
        '..B..B.',
        '.......',
        '..B..B.',
        '...B#B#',
        ],
    },
    {
    mode: 'd',
        rows: [
        'IIII.BB',
        '..B....',
        'B.#..I.',
        '.B..#..',
        'I..B.B.',
        '.B....#',
        'B#..II.',
        ],
    },
    {
        rows: [
        '.II.BB.',
        '.II.BB.',
        '....#.#',
        'B..#B#.',
        '.......',
        'B..#B#.',
        '....#.#',
        ],
    },
    {
    mode: 'h',
        rows: [
        'III..#..III..',
        'BBB..#..BBB..',
        '.....#.#.....',
        '..#..#B#..#..',
        '.............',
        '..#..#B#..#..',
        '.....#.#.....',
        ],
    },
    {
        rows: [
        '.#.#.#.',
        '.#.#.#.',
        '.....B.',
        '#B#..#.',
        '.......',
        '#B#..#.',
        '.....B.',
        ],
    },
    {
        rows: [
        '~~~..#.',
        'B~..#..',
        'BB..#..',
        '.....#.',
        '.......',
        '.....#.',
        'BB..#..',
        ],
    },
    {
    mode: 'd',
        rows: [
        'II.#B..',
        'B..#...',
        '.#B..I.',
        'I..#BB.',
        '..#...B',
        'B..I..#',
        '..B#II.',
        ],
    },
    {
    mode: 'h',
        rows: [
        '.III.III.~...',
        'B.BB.BB.B....',
        '..#.#.#......',
        '.BBB.BBB..#..',
        '.............',
        '.#..B..B..#..',
        '.............',
        ],
    },
    {
        rows: [
        '#B#B.B.',
        '#.#...#',
        '..BBB.B',
        '#.#.#.#',
        '.......',
        '#.#.#.#',
        '..BBB.B',
        ],
    },
    {
    mode: 'd',
        rows: [
        'B#B#B#.',
        '#..B...',
        '.#..B#.',
        'B#..#..',
        '..B#...',
        '.#B..#.',
        '#..BB#.',
        ],
    },
    {
    mode: 'h',
        rows: [
        'BB....#....BB',
        '.B....#....B.',
        '..B..#..B..#.',
        '#..BBBBBB..#.',
        '.#........#..',
        '.............',
        '...#..B..#...',
        ],
    },
    {
        rows: [
        'T.BB#BB',
        'B.B.B.B',
        '..B#B#B',
        '.B..B..',
        '.......',
        '.B..B..',
        '..B#B#B',
        ],
    },
    {
        rows: [
        '#B#B#..',
        '.#.#...',
        'BB..B#B',
        '...#...',
        '.......',
        '...#...',
        'BB..B#B',
        ],
    },
    {
    mode: 'd',
        rows: [
        '#B#..#.',
        'B..#B..',
        '.#B#BB#',
        '#..#..B',
        'B#B..#.',
        '..B#...',
        '#..B#B#',
        ],
    },
    {
    mode: 'h',
        rows: [
        '...#......#..',
        'BB.B#BB#B.BB.',
        '#.B......B.#.',
        'BB.#.BB.#.BB.',
        '....B.B......',
        '.............',
        '.#..B..B..#..',
        ],
    },
    {
        rows: [
        '..#..B.',
        'B.BB#B#',
        '.#.....',
        'B.B..#B',
        '.......',
        'B.B..#B',
        '.#.....',
        ],
    },
    {
        rows: [
        '~~~~.#.',
        '~B~B..#',
        '.#B...#',
        'B..BB#B',
        '.......',
        'B..BB#B',
        '.#B...#',
        ],
    },
    {
    mode: 'd',
        rows: [
        '#B#B#..',
        '.B..#B#',
        '#..#...',
        '.B#B#B.',
        '..#..B#',
        'B#..B..',
        '.B#B#B#',
        ],
    },
    {
    mode: 'h',
        rows: [
        'B#B.B#B.B#B..',
        '#..B#..B#..B.',
        '...BB.BB.....',
        '#B#..B..#B#..',
        '.B..#B#B..B..',
        '.............',
        '.#.B#B.B#....',
        ],
    },
];

    // ── Параметры поля ──────────────────────────────────────────────────────
    const COLS = 13;
    const ROWS = 13;
    const TILE = 26;            // размер клетки в пикселях (масштабируется)
    const SUB = 2;              // подклетки внутри кирпичной клетки
    const W = COLS * TILE;      // 338
    const H = ROWS * TILE;

    // Типы клеток
    const EMPTY = 0, BRICK = 1, STEEL = 2, WATER = 3, TREES = 4, ICE = 5, BASE = 6;

    // Символы уровней
    const CH = {
        '.': EMPTY, 'B': BRICK, '#': STEEL, '~': WATER,
        'T': TREES, 'I': ICE, 'E': BASE,
    };


    /**
     * Правая половина строки: все символы, кроме центрального, в обратном
     * порядке. Седьмая колонка — ось симметрии, она не дублируется.
     * @param {string} row - строка из 7 символов
     * @returns {string[]} 6 символов зеркальной половины
     */
    function reverseExcludingMid(row) {
        return row.slice(0, -1).split('').reverse();
    }

    /**
     * Собирает поле 13×13 по описанию уровня.
     *
     * Уровень задаётся частью поля, остальное достраивается симметрией.
     * Тип симметрии задаётся полем mode и заметно меняет вид поля при
     * одном и том же объёме описания:
     *
     *   'v' — зеркало по вертикали и по горизонтали (описание 7×7). Классика.
     *   'h' — зеркало только по горизонтали, строки во всю ширину (13).
     *         Даёт широкие коридоры, которых в режиме 'v' быть не может.
     *   'd' — транспонирование: описание повёрнуто относительно диагонали,
     *         поле симметрично по главной диагонали.
     *
     * @param {{mode?: string, rows: string[]}} level - описание уровня
     * @param {boolean} flipBase - база снизу (true) или сверху (false)
     * @returns {{tiles: Uint8Array, subs: Uint8Array, base: {c: number, r: number}}}
     */
    function buildField(level, flipBase) {
        const mode = (level && level.mode) || 'v';
        const half = (level && level.rows) || level;

        const tiles = new Uint8Array(COLS * ROWS);
        const subs = new Uint8Array(COLS * ROWS * SUB * SUB).fill(1);
        const HALF = 7;
        const grid = new Array(ROWS);
        for (let r = 0; r < ROWS; r++) grid[r] = new Array(COLS).fill('.');

        const put = (r, c, ch) => {
            if (r >= 0 && r < ROWS && c >= 0 && c < COLS) grid[r][c] = ch;
        };
        const mirrorDown = () => {
            for (let r = HALF; r < ROWS; r++) {
                const src = ROWS - 1 - r;
                for (let c = 0; c < COLS; c++) put(r, c, grid[src][c]);
            }
        };

        if (mode === 'd') {
            // Транспонирование: описание повёрнуто относительно главной
            // диагонали. Нижнюю половину зеркалим, иначе она осталась бы
            // пустой: симметрия относительно диагонали сохраняется.
            for (let r = 0; r < HALF; r++) {
                const row = half[r].split('');
                for (let c = 0; c < HALF; c++) put(c, r, row[c]);
            }
            mirrorDown();
        } else if (mode === 'h') {
            for (let r = 0; r < HALF; r++) {
                const row = half[r].split('');
                for (let c = 0; c < COLS; c++) put(r, c, row[c]);
            }
            mirrorDown();
        } else {
            for (let r = 0; r < HALF; r++) {
                const row = half[r].split('');
                const mirrored = reverseExcludingMid(half[r]);
                for (let c = 0; c < HALF; c++) put(r, c, row[c]);
                for (let c = 0; c < mirrored.length; c++) put(r, COLS - 1 - c, mirrored[c]);
            }
            mirrorDown();
        }

        for (let r = 0; r < ROWS; r++) {
            for (let c = 0; c < COLS; c++) {
                const ch = grid[r][c];
                tiles[r * COLS + c] = CH[ch] !== undefined ? CH[ch] : EMPTY;
            }
        }

        // Зоны выхода всегда свободны. Без этого на части уровней танк
        // появлялся внутри стены: направление менялось, а позиция нет —
        // игра выглядела как «не едет». Здесь выход гарантирован, и
        // про него нельзя забыть при рисовании нового уровня.
        const clear = (c, r) => { if (c >= 0 && r >= 0 && c < COLS && r < ROWS) tiles[r * COLS + c] = EMPTY; };
        // У игрока открываем проход вверх, у врагов — вниз
        for (const c of ENEMY_SPAWN_COLS) { clear(c, 0); clear(c, 1); }
        clear(PLAYER_SPAWN_COL, ROWS - 1);
        clear(PLAYER_SPAWN_COL, ROWS - 2);

        // База — по центру нижнего или верхнего ряда
        const baseRow = flipBase ? ROWS - 1 : 0;
        tiles[baseRow * COLS + 6] = BASE;
        tiles[baseRow * COLS + 7] = BASE;

        return { tiles, subs, base: { c: 6, r: baseRow } };
    }

    // ── Звук ────────────────────────────────────────────────────────────────
    // Короткие бипы через WebAudio. Нет файлов, нет загрузки, работает офлайн.
    let audioCtx = null;
    function beep(freq, dur, type) {
        try {
            if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
            if (audioCtx.state === 'suspended') audioCtx.resume();
            const osc = audioCtx.createOscillator();
            const gain = audioCtx.createGain();
            osc.type = type || 'square';
            osc.frequency.value = freq;
            gain.gain.setValueAtTime(0.05, audioCtx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + dur);
            osc.connect(gain).connect(audioCtx.destination);
            osc.start();
            osc.stop(audioCtx.currentTime + dur);
        } catch { /* звук не обязателен */ }
    }
    const SFX = {
        shoot: () => beep(220, 0.06, 'square'),
        hit: () => beep(140, 0.08, 'sawtooth'),
        boom: () => beep(70, 0.22, 'sawtooth'),
        powerup: () => beep(660, 0.12, 'triangle'),
        dead: () => beep(90, 0.3, 'sine'),
        win: () => beep(880, 0.15, 'triangle'),
    };

    // ── Объекты ─────────────────────────────────────────────────────────────
    const DIRS = [
        { dx: 0, dy: -1, name: 'up' },
        { dx: 1, dy: 0, name: 'right' },
        { dx: 0, dy: 1, name: 'down' },
        { dx: -1, dy: 0, name: 'left' },
    ];

    function makeTank(x, y, dir, kind) {
        return {
            x, y, dir,
            kind: kind || 'player',   // player | basic | fast | power | armor
            hp: kind === 'armor' ? 4 : kind === 'power' ? 2 : 1,
            speed: kind === 'fast' ? 1.15 : 0.8,
            cooldown: 0,
            moving: false,
            shield: 0,                 // до какой ступени броня (звезда)
            active: true,
        };
    }

    // ── Состояние игры ──────────────────────────────────────────────────────
    const G = {
        tiles: null, subs: null, base: null,
        player: null, enemies: [], bullets: [], powerups: [],
        level: 1, score: 0, lives: 3, best: 0,
        spawnLeft: 0, spawnTimer: 0, spawnPoints: [],
        state: 'menu',              // menu | play | dead | levelclear | gameover
        freeze: 0,
        keys: {},
        touch: { up: false, down: false, left: false, right: false, fire: false },
        lastTime: 0, acc: 0,
        tick: 0,
    };

    try { G.best = Number(localStorage.getItem('tanks_best') || 0) || 0; } catch { G.best = 0; }

    // ── Уровни ──────────────────────────────────────────────────────────────
    function levelCount() { return TANK_LEVELS.length; }

    /**
     * Ставит танк по центру клетки.
     *
     * Раньше ставили в угол клетки (`c * TILE`), и танк размером почти во
     * всю клетку занимал сразу четыре клетки. Любой кирпич рядом делал
     * движение невозможным: направление менялось, а позиция нет.
     */
    function spawnAt(c, r, dir, kind) {
        return makeTank(c * TILE + TILE / 2, r * TILE + TILE / 2, dir, kind);
    }

    function loadLevel(n) {
        G.level = ((n - 1) % levelCount()) + 1;
        const idx = G.level - 1;
        // База всегда снизу: это защищаемая сторона, как в оригинале
        const f = buildField(TANK_LEVELS[idx], true);
        G.tiles = f.tiles;
        G.subs = f.subs;
        G.base = f.base;

        G.player = spawnAt(PLAYER_SPAWN_COL, ROWS - 1, 0, 'player');
        G.bullets = [];
        G.powerups = [];
        G.freeze = 0;
        G.enemies = [];

        // Враги выходят не сразу, иначе вход забит с первой секунды
        const count = Math.min(20, 4 + Math.floor(idx * 0.9));
        G.spawnLeft = count;
        G.spawnPoints = SPAWN_POINTS.map((p) => ({ ...p, used: false }));
        G.spawnTimer = 1.2;
    }

    /** Точки появления врагов: три угла сверху. */
    const SPAWN_POINTS = [
        { c: 0, r: 0 }, { c: 6, r: 0 }, { c: 12, r: 0 },
    ];

    /** Колонки выхода врагов — в тон клеткам, которые мы очищаем. */
    const ENEMY_SPAWN_COLS = SPAWN_POINTS.map((p) => p.c);
    /** Колонка выхода игрока: слева от базы, как в оригинале. */
    const PLAYER_SPAWN_COL = 4;

    /** Случайный тип врага: чем дальше уровень, тем чаще тяжёлые. */
    function randomEnemyKind() {
        const roll = Math.random();
        if (roll < 0.5) return 'basic';
        if (roll < 0.72) return 'fast';
        if (roll < 0.9) return 'power';
        return 'armor';
    }

    /**
     * Выпускает одного врага в свободную точку появления.
     * @returns {boolean} удалось ли выпустить
     */
    function spawnOne() {
        const free = G.spawnPoints.filter((p) => !p.used);
        if (free.length === 0) return false;
        const spot = free[Math.floor(Math.random() * free.length)];
        spot.used = true;
        G.enemies.push(makeTank(
            spot.c * TILE + TILE / 2,
            spot.r * TILE + TILE / 2,
            2,
            randomEnemyKind()
        ));
        G.spawnLeft--;
        return true;
    }

    // ── Столкновения ────────────────────────────────────────────────────────

    /** Клетка занята твёрдым препятствием для танка? */
    function isSolidForTank(c, r) {
        if (c < 0 || r < 0 || c >= COLS || r >= ROWS) return true;
        const t = G.tiles[r * COLS + c];
        return t === BRICK || t === STEEL || t === WATER || t === BASE;
    }

    /** Клетка проходима для пули? */
    function isSolidForBullet(c, r) {
        if (c < 0 || r < 0 || c >= COLS || r >= ROWS) return true;
        const t = G.tiles[r * COLS + c];
        return t === BRICK || t === STEEL || t === BASE;
    }

    /** Кирпичная клетка ещё цела в этой подклетке? */
    function subAlive(c, r, sx, sy) {
        return G.subs[(r * COLS + c) * SUB * SUB + sy * SUB + sx] === 1;
    }

    function setSub(c, r, sx, sy, v) {
        G.subs[(r * COLS + c) * SUB * SUB + sy * SUB + sx] = v;
    }

    /** Разрушает клетку у снаряда, возвращает true, если был урон. */
    function damageAt(px, py, bulletDir, big) {
        const c = Math.floor(px / TILE);
        const r = Math.floor(py / TILE);
        if (c < 0 || r < 0 || c >= COLS || r >= ROWS) return 'wall';

        if (G.tiles[r * COLS + c] === BASE) return 'base';

        if (G.tiles[r * COLS + c] === STEEL) {
            // Броня «лопатка» позволяет разрушать сталь
            if (G.player && G.player.shovel > 0) {
                G.tiles[r * COLS + c] = EMPTY;
                return 'steel';
            }
            return 'steel';
        }

        if (G.tiles[r * COLS + c] === BRICK) {
            const subSize = TILE / SUB;
            const sx = Math.min(SUB - 1, Math.floor((px % TILE) / subSize));
            const sy = Math.min(SUB - 1, Math.floor((py % TILE) / subSize));
            const dir = DIRS[bulletDir];

            // Выбиваем подклетку по стороне удара
            if (!subAlive(c, r, sx, sy)) return null;
            setSub(c, r, sx, sy, 0);
            if (big) {
                // Граната сносит всю клетку
                for (let i = 0; i < SUB; i++) {
                    for (let j = 0; j < SUB; j++) setSub(c, r, i, j, 0);
                }
            } else {
                if (dir.dx === 0) {
                    for (let i = 0; i < SUB; i++) setSub(c, r, sx, i, 0);
                } else {
                    for (let i = 0; i < SUB; i++) setSub(c, r, i, sy, 0);
                }
            }
            // Клетка исчезает, только когда пуста целиком
            let any = false;
            for (let i = 0; i < SUB && !any; i++) {
                for (let j = 0; j < SUB; j++) {
                    if (subAlive(c, r, i, j)) { any = true; break; }
                }
            }
            if (!any) G.tiles[r * COLS + c] = EMPTY;
            return 'brick';
        }
        return null;
    }

    // ── Логика ──────────────────────────────────────────────────────────────
    function moveTank(t, dir, dt) {
        t.dir = dir;
        const d = DIRS[dir];
        const step = t.speed * dt * 90;
        const size = TILE - 4;             // танк чуть меньше клетки
        const half = size / 2;

        // Новая позиция с проверкой углами, чтобы не вклиниться в стену
        let nx = t.x, ny = t.y;
        if (d.dx) nx += d.dx * step; else ny += d.dy * step;

        const canStand = (x, y) => {
            const c1 = Math.floor((x - half) / TILE), c2 = Math.floor((x + half) / TILE);
            const r1 = Math.floor((y - half) / TILE), r2 = Math.floor((y + half) / TILE);
            for (let r = r1; r <= r2; r++) {
                for (let c = c1; c <= c2; c++) {
                    if (isSolidForTank(c, r)) return false;
                }
            }
            return true;
        };

        if (canStand(nx, t.y)) t.x = nx;
        if (canStand(t.x, ny)) t.y = ny;
        t.moving = true;
    }

    function rectsOverlap(a, b, size) {
        const h = size / 2;
        return Math.abs(a.x - b.x) < h && Math.abs(a.y - b.y) < h;
    }

    function fire(t, isPlayer) {
        if (t.cooldown > 0) return;
        t.cooldown = t.kind === 'player' ? 0.28 : 0.9;
        const d = DIRS[t.dir];
        const size = TILE - 4;
        G.bullets.push({
            x: t.x + d.dx * (size / 2),
            y: t.y + d.dy * (size / 2),
            dir: t.dir,
            player: !!isPlayer,
            big: isPlayer && t.shield >= 2,
            power: isPlayer && t.shield >= 3,
        });
        if (isPlayer) SFX.shoot();
    }

    function hurtTank(t) {
        if (t.shield > 0 && t.kind === 'player') {
            t.shield = 0;
            return false;
        }
        t.hp -= 1;
        return t.hp <= 0;
    }

    function killEnemy(e) {
        e.active = false;
        G.score += { basic: 100, fast: 200, power: 300, armor: 400 }[e.kind] || 100;
        SFX.boom();
        maybeDropPower();
    }

    // Бонусы выпадают не всегда, иначе игра превращается в фарм
    const POWER_KINDS = ['star', 'grenade', 'helmet', 'shovel', 'clock', 'life'];
    function maybeDropPower() {
        if (Math.random() > 0.18) return;
        const kind = POWER_KINDS[Math.floor(Math.random() * POWER_KINDS.length)];
        G.powerups.push({ x: G.player.x, y: G.player.y, kind, life: 14 });
    }

    function applyPower(kind) {
        const p = G.player;
        switch (kind) {
            case 'star':
                p.shield = Math.min(3, p.shield + 1); break;
            case 'grenade':
                G.enemies.slice().forEach(killEnemy); break;
            case 'helmet':
                p.shield = 3; break;
            case 'shovel':
                p.shovel = 10; break;
            case 'clock':
                G.freeze = 8; break;
            case 'life':
                G.lives = Math.min(9, G.lives + 1); break;
            default: break;
        }
        SFX.powerup();
    }

    // ── Цикл ────────────────────────────────────────────────────────────────
    function update(dt) {
        if (G.state !== 'play') return;

        if (G.freeze > 0) G.freeze -= dt;

        // Клавиатура и экранные кнопки сводим к одному состоянию
        const k = G.keys, t = G.touch;
        const up = k.up || t.up;
        const down = k.down || t.down;
        const left = k.left || t.left;
        const right = k.right || t.right;
        // Имя НЕ fire: локальная переменная перекрыла бы одноимённую функцию
        // выстрела, и вызов падал бы «fire is not a function».
        const wantFire = k.fire || t.fire;

        if (G.player && G.player.active) {
            let moved = false;
            if (up) { moveTank(G.player, 0, dt); moved = true; }
            if (down) { moveTank(G.player, 2, dt); moved = true; }
            if (left) { moveTank(G.player, 3, dt); moved = true; }
            if (right) { moveTank(G.player, 1, dt); moved = true; }
            if (!moved) G.player.moving = false;
            if (wantFire) fire(G.player, true);
            if (G.player.cooldown > 0) G.player.cooldown -= dt;
            if (G.player.shovel > 0) G.player.shovel -= dt;
        }

        // Враги
        for (const e of G.enemies) {
            if (!e.active) continue;
            if (e.cooldown > 0) e.cooldown -= dt;
            if (G.freeze > 0) continue;

            // Случайное блуждание со сменой направления
            if (!e.moving || Math.random() < 0.012) {
                // Разворачиваемся, если упёрлись
                const d = DIRS[e.dir];
                const aheadX = e.x + d.dx * (TILE / 2);
                const aheadY = e.y + d.dy * (TILE / 2);
                const blocked = isSolidForTank(
                    Math.floor(aheadX / TILE), Math.floor(aheadY / TILE)
                ) || hitBaseSoon(e, d);
                if (blocked) {
                    e.dir = Math.floor(Math.random() * 4);
                }
                e.moving = true;
            }
            moveTank(e, e.dir, dt);
            // Иногда стреляют
            if (Math.random() < 0.02) fire(e, false);
        }

        // Снаряды
        for (let i = G.bullets.length - 1; i >= 0; i--) {
            const b = G.bullets[i];
            const d = DIRS[b.dir];
            b.x += d.dx * 210 * dt;
            b.y += d.dy * 210 * dt;

            if (b.x < 0 || b.y < 0 || b.x >= W || b.y >= H) {
                G.bullets.splice(i, 1);
                continue;
            }

            const res = damageAt(b.x, b.y, b.dir, b.big);
            if (res) {
                if (res === 'brick') G.score += 10;
                if (res === 'base') {
                    G.state = 'gameover';
                    SFX.dead();
                }
                if (res === 'wall' || res === 'brick' || res === 'base') SFX.hit();
                if (b.power) {
                    // Сильный заряд сносит и сталь
                    const c = Math.floor(b.x / TILE), r = Math.floor(b.y / TILE);
                    if (c >= 0 && r >= 0 && c < COLS && r < ROWS && G.tiles[r * COLS + c] === STEEL) {
                        G.tiles[r * COLS + c] = EMPTY;
                    }
                }
                G.bullets.splice(i, 1);
                continue;
            }

            // Попадание в танки
            if (b.player) {
                let hit = false;
                for (const e of G.enemies) {
                    if (!e.active) continue;
                    if (rectsOverlap(b, e, 18)) {
                        if (hurtTank(e)) killEnemy(e);
                        hit = true;
                        break;
                    }
                }
                if (hit) G.bullets.splice(i, 1);
            } else if (G.player && G.player.active && rectsOverlap(b, G.player, 18)) {
                if (hurtTank(G.player)) {
                    G.player.active = false;
                    G.bullets.splice(i, 1);
                    playerDead();
                } else {
                    G.bullets.splice(i, 1);
                    SFX.hit();
                }
            }
        }

        // Бонусы
        for (let i = G.powerups.length - 1; i >= 0; i--) {
            const p = G.powerups[i];
            p.life -= dt;
            if (p.life <= 0) { G.powerups.splice(i, 1); continue; }
            if (G.player && G.player.active && rectsOverlap(p, G.player, TILE * 0.7)) {
                applyPower(p.kind);
                G.powerups.splice(i, 1);
            }
        }

        // Уборка убитых
        G.enemies = G.enemies.filter((e) => e.active);

        // Подпускаем новых врагов, пока есть кого выпустить
        if (G.state === 'play') {
            G.spawnTimer -= dt;
            if (G.spawnTimer <= 0 && G.spawnLeft > 0) {
                G.spawnTimer = 2.2;
                spawnOne();
            }
            // Уровень пройден, когда поле зачищено и выпускать больше некого
            if (G.enemies.length === 0 && G.spawnLeft <= 0) {
                G.state = 'levelclear';
                G.score += 500;
                SFX.win();
            }
        }

        if (G.score > G.best) {
            G.best = G.score;
            try { localStorage.setItem('tanks_best', String(G.best)); } catch { /* приватный режим */ }
        }
    }

    /** Не даём врагу уйти на базу. */
    function hitBaseSoon(e, d) {
        const c = Math.floor((e.x + d.dx * TILE * 2) / TILE);
        const r = Math.floor((e.y + d.dy * TILE * 2) / TILE);
        if (c < 0 || r < 0 || c >= COLS || r >= ROWS) return true;
        return G.tiles[r * COLS + c] === BASE;
    }

    function playerDead() {
        G.lives--;
        SFX.dead();
        if (G.lives <= 0) {
            G.state = 'gameover';
        } else {
            // Перезапуск уровня: остатки врагов возвращаются в очередь
            G.bullets = [];
            G.player = spawnAt(PLAYER_SPAWN_COL, ROWS - 1, 0, 'player');
            G.spawnLeft = G.spawnLeft + G.enemies.filter((e) => e.active).length;
            G.spawnPoints = SPAWN_POINTS.map((p) => ({ ...p, used: false }));
            G.spawnTimer = 1.5;
        }
    }

    // ── Отрисовка ───────────────────────────────────────────────────────────
    const canvas = document.getElementById('game');
    const ctx = canvas.getContext('2d');

    // Палитра настоящего NES (видеочип 2C02). Раньше здесь стояли
    // произвольные «красивые» цвета, и игра выглядела как современная
    // веб-страница, а не как игра с картриджа 8-битной эпохи.
    const NES = {
        black: '#000000',
        grey: '#545454',
        lightGrey: '#989696',
        white: '#fcfcfc',
        silver: '#bcbcbc',
        red: '#982c00',
        orange: '#ec6a64',
        gold: '#a0aa00',
        yellow: '#f8d800',
        green: '#00b800',
        darkGreen: '#007800',
        blue: '#0058f8',
        lightBlue: '#3cbcfc',
        cyan: '#38b4cc',
        tan: '#f0c060',
    };

    const COLORS = {
        bg: NES.black,
        brick: NES.white,
        brickDark: NES.grey,
        steel: NES.silver,
        steelDark: NES.grey,
        water: NES.blue,
        waterLight: NES.lightBlue,
        trees: NES.green,
        treesDark: NES.darkGreen,
        ice: NES.cyan,
        base: NES.white,
        baseDark: NES.grey,
        baseFrame: NES.silver,
        player: NES.yellow,
        // Типы врагов в оригинале различаются цветом: серый, зелёный,
        // жёлтый и мигающий бронированный
        enemy: NES.silver,
        enemyFast: NES.green,
        enemyPower: NES.yellow,
        enemyArmor: NES.white,
        bullet: NES.white,
        power: NES.gold,
    };

    // Один «пиксель» рисунка. Всё рисуется кратно этому размеру, иначе
    // картинка рассыпается: у NES пиксель был один, а не полпикселя.
    const PIX = 2;

    function drawCell(c, r) {
        const t = G.tiles[r * COLS + c];
        const x = c * TILE, y = r * TILE;

        if (t === BRICK) {
            const subSize = TILE / SUB;
            for (let sy = 0; sy < SUB; sy++) {
                for (let sx = 0; sx < SUB; sx++) {
                    if (!subAlive(c, r, sx, sy)) continue;
                    // Кирпичи в оригинале белые на чёрном, со швом
                    // через ряд. Раньше здесь был оранжевый цвет и
                    // сглаженные прямоугольники — это больше не «Денди».
                    const ox = x + sx * subSize;
                    const oy = y + sy * subSize;
                    ctx.fillStyle = COLORS.brickDark;
                    ctx.fillRect(ox, oy, subSize, subSize);
                    const shift = sy % 2 === 0 ? 0 : PIX * 2;
                    ctx.fillStyle = COLORS.brick;
                    for (let b = 0; b < 2; b++) {
                        ctx.fillRect(ox + shift + b * PIX * 5, oy + PIX, PIX * 4, subSize - PIX * 2);
                    }
                }
            }
            return;
        }
        if (t === STEEL) {
            // Броня: сплошной блок со светом сверху и тенью снизу
            ctx.fillStyle = COLORS.steelDark;
            ctx.fillRect(x, y, TILE, TILE);
            ctx.fillStyle = COLORS.steel;
            ctx.fillRect(x + PIX, y + PIX, TILE - PIX * 2, TILE - PIX * 2);
            ctx.fillStyle = NES.white;
            ctx.fillRect(x + PIX, y + PIX, TILE - PIX * 2, PIX);
            ctx.fillRect(x + PIX, y + PIX, PIX, TILE - PIX * 2);
            ctx.fillStyle = NES.grey;
            ctx.fillRect(x + PIX, y + TILE - PIX * 3, TILE - PIX * 2, PIX);
            ctx.fillRect(x + TILE - PIX * 3, y + PIX, PIX, TILE - PIX * 2);
            return;
        }
        if (t === WATER) {
            // Вода в оригинале — две горизонтальные волны, сдвинутые
            // друг относительно друга. Без анимации она выглядит
            // как обычный синий квадрат.
            ctx.fillStyle = COLORS.water;
            ctx.fillRect(x, y, TILE, TILE);
            const ph = Math.floor(G.tick / 24) % 4;
            ctx.fillStyle = COLORS.waterLight;
            for (let row = 0; row < 4; row++) {
                const yy = y + row * PIX * 3 + PIX;
                const off = ((row + ph) % 2) * PIX * 3;
                ctx.fillRect(x + off, yy, TILE - off - PIX * 2, PIX);
            }
            return;
        }
        if (t === ICE) {
            ctx.fillStyle = COLORS.water;
            ctx.fillRect(x, y, TILE, TILE);
            ctx.fillStyle = COLORS.waterLight;
            ctx.fillRect(x + PIX, y + PIX, TILE - PIX * 2, TILE - PIX * 2);
            // Лёд рисуется ровно, без сглаживания: диагональ из углов
            ctx.fillStyle = NES.white;
            for (let i = 0; i < 4; i++) {
                ctx.fillRect(x + i * PIX * 3 + PIX * 2, y + i * PIX * 3 + PIX, PIX, PIX);
                ctx.fillRect(x + TILE - i * PIX * 3 - PIX * 3, y + i * PIX * 3 + PIX, PIX, PIX);
            }
            return;
        }
        if (t === BASE) {
            // Орёл в рамке, как в оригинале. База — единственное место,
            // где игрок обязан защищать, и она должна читаться сразу.
            ctx.fillStyle = COLORS.baseDark;
            ctx.fillRect(x, y, TILE, TILE);
            ctx.fillStyle = COLORS.base;
            ctx.fillRect(x + PIX * 2, y + PIX * 2, TILE - PIX * 4, TILE - PIX * 4);

            const c0 = x + TILE / 2;
            // Крылья: два прямоугольника, расходящиеся от центра
            ctx.fillStyle = COLORS.baseDark;
            ctx.fillRect(c0 - PIX * 7, y + PIX * 7, PIX * 4, PIX * 3);
            ctx.fillRect(c0 + PIX * 3, y + PIX * 7, PIX * 4, PIX * 3);
            // Тело и голова
            ctx.fillStyle = NES.black;
            ctx.fillRect(c0 - PIX * 2, y + PIX * 5, PIX * 4, PIX * 7);
            ctx.fillRect(c0 - PIX, y + PIX * 3, PIX * 2, PIX * 3);
            // Клюв
            ctx.fillStyle = NES.orange;
            ctx.fillRect(c0 - PIX, y + PIX * 5, PIX * 2, PIX);
            return;
        }
        if (t === TREES) {
            // Кусты рисуются поверх танков — это и есть маскировка.
            // В оригинале это плотная зелёная гроздь без градиентов.
            ctx.fillStyle = COLORS.treesDark;
            ctx.fillRect(x, y, TILE, TILE);
            ctx.fillStyle = COLORS.trees;
            for (let i = 0; i < 4; i++) {
                const cx = x + (i % 2 ? PIX * 8 : PIX * 5);
                const cy = y + (i < 2 ? PIX * 5 : PIX * 10);
                ctx.fillRect(cx - PIX * 3, cy - PIX * 3, PIX * 6, PIX * 6);
            }
            ctx.fillStyle = COLORS.treesDark;
            for (let i = 0; i < 4; i++) {
                const cx = x + (i % 2 ? PIX * 8 : PIX * 5);
                const cy = y + (i < 2 ? PIX * 5 : PIX * 10);
                ctx.fillRect(cx - PIX, cy - PIX, PIX * 2, PIX * 2);
            }
        }
    }

/**
     * Танк в стиле 8-битного «Денди»: две гусеницы с прорезями, корпус
     * между ними, башня и ствол.
     *
     * Всё рисуется кратно PIX — так рисунок держится на пиксельной сетке
     * и не рассыпается, как было с произвольными координатами. Спрайт
     * всегда носом вверх, поворот делает вызывающий код.
     */
    function drawTank(t, color, isPlayer) {
        if (!t.active) return;
        const S = TILE - PIX * 2;            // 22 пикселя, запас по 2 с каждой стороны
        const half = S / 2;
        const TR = PIX * 2;                   // ширина гусеницы
        const BW = S - TR * 2;                // ширина корпуса

        ctx.save();
        ctx.translate(t.x, t.y);
        ctx.rotate(t.dir * Math.PI / 2);

        // ── Гусеницы ────────────────────────────────────────────────────────
        ctx.fillStyle = NES.grey;
        ctx.fillRect(-half, -half, TR, S);
        ctx.fillRect(half - TR, -half, TR, S);
        ctx.fillStyle = NES.silver;
        for (let y = -half + PIX; y < half - PIX; y += PIX * 2) {
            ctx.fillRect(-half + PIX, y, TR - PIX * 2, PIX);
            ctx.fillRect(half - TR + PIX, y, TR - PIX * 2, PIX);
        }

        // ── Корпус ──────────────────────────────────────────────────────────
        // Корпус короче спрайта спереди: иначе ствол оказывается внутри
        // него и танк выглядит просто прямоугольником без оружия
        const bodyTop = -half + PIX * 3;
        ctx.fillStyle = color;
        ctx.fillRect(-BW / 2, bodyTop, BW, half - bodyTop);

        // Броневые танки в оригинале помечены полосами — по ним игрок
        // видит, сколько попаданий выдержит противник
        if (t.kind === 'armor' && t.hp < 4) {
            ctx.fillStyle = 'rgba(0,0,0,0.35)';
            const stripes = 4 - t.hp;
            for (let i = 0; i < stripes; i++) {
                ctx.fillRect(-BW / 2 + PIX, bodyTop + PIX * 4 + i * PIX * 4, BW - PIX * 2, PIX);
            }
        }

        // ── Ствол и башня ───────────────────────────────────────────────────
        // Ствол выступает перед корпусом — именно он делает силуэт
        // узнаваемым с первого взгляда
        ctx.fillStyle = color;
        ctx.fillRect(-PIX / 2, -half, PIX, PIX * 3);
        ctx.fillRect(-PIX * 1.5, bodyTop, PIX * 3, PIX * 3);
        ctx.fillStyle = 'rgba(0,0,0,0.30)';
        ctx.fillRect(-PIX * 1.5, bodyTop + PIX * 3, PIX * 3, PIX);

        // ── Щит игрока ──────────────────────────────────────────────────────
        if (isPlayer && t.shield > 0) {
            // Мигает: в оригинале щит заметно пульсирует, иначе его
            // не видно на фоне кирпича
            if (Math.floor(G.tick / 6) % 2 === 0) {
                ctx.fillStyle = COLORS.power;
                ctx.fillRect(-half - PIX, -half - PIX, PIX, S + PIX * 2);
                ctx.fillRect(half, -half - PIX, PIX, S + PIX * 2);
                ctx.fillRect(-half - PIX, -half - PIX, S + PIX * 2, PIX);
                ctx.fillRect(-half - PIX, half, S + PIX * 2, PIX);
            }
        }
        ctx.restore();
    }

    function draw() {
        ctx.fillStyle = COLORS.bg;
        ctx.fillRect(0, 0, W, H);

        if (G.state === 'menu') {
            ctx.fillStyle = COLORS.player;
            ctx.font = 'bold 22px monospace';
            ctx.textAlign = 'center';
            ctx.fillText('ТАНКИ', W / 2, H / 2 - 30);
            ctx.font = '13px monospace';
            ctx.fillStyle = '#cbd5e0';
            ctx.fillText('Пробел или Enter — начать', W / 2, H / 2);
            ctx.fillText('Стрелки или WASD — ходить', W / 2, H / 2 + 20);
            return;
        }

        for (let r = 0; r < ROWS; r++) {
            for (let c = 0; c < COLS; c++) drawCell(c, r);
        }

        for (const e of G.enemies) {
            drawTank(e, { basic: COLORS.enemy, fast: COLORS.enemyFast, power: COLORS.enemyPower, armor: COLORS.enemyArmor }[e.kind], false);
        }
        if (G.player) drawTank(G.player, COLORS.player, true);

        for (const b of G.bullets) {
            // Снаряд в оригинале маленький и с тёмной обводкой: так его
            // видно и на кирпиче, и на чёрном фоне
            const d = DIRS[b.dir];
            const long = b.big ? PIX * 5 : PIX * 3;
            const wide = b.big ? PIX * 3 : PIX * 2;
            ctx.save();
            ctx.translate(b.x, b.y);
            ctx.rotate(b.dir * Math.PI / 2);
            ctx.fillStyle = NES.black;
            ctx.fillRect(-wide / 2 - PIX / 2, -long - PIX / 2, wide + PIX, long + PIX);
            ctx.fillStyle = b.big ? COLORS.power : COLORS.bullet;
            ctx.fillRect(-wide / 2, -long, wide, long * 2);
            ctx.restore();
            void d;
        }

        /**
     * Значки бонусов — те же шесть, что и в оригинале: шлем, звезда,
     * граната, лопата, часы и жизнь. Раньше поверх квадрата печаталась
     * буква monospace-шрифтом, и это выдавало браузер сразу.
     * Каждый значок нарисован символами: '#' — цвет, '+' — тень,
     * '.' — прозрачный. Читается прямо в коде.
     */
    const POWER_ICONS = {
        helmet: [
            '..####..',
            '.######.',
            '##.##.##',
            '########',
            '#..##..#',
        ],
        star: [
            '...##...',
            '..####..',
            '.######.',
            '########',
            '..#..#..',
        ],
        grenade: [
            '.....##.',
            '..#####.',
            '.#######',
            '####+###',
            '.#######',
            '..#####.',
        ],
        shovel: [
            '...##...',
            '...##...',
            '..####..',
            '.######.',
            '########',
            '###++###',
        ],
        clock: [
            '..####..',
            '.#....#.',
            '#..##..#',
            '#..##..#',
            '#......#',
            '.#....#.',
            '..####..',
        ],
        life: [
            '..#..#..',
            '.######.',
            '########',
            '.######.',
            '.##..##.',
            '..#..#..',
        ],
    };

    /** Рисует значок в точке (cx, cy) с центром посередине. */
    function drawIcon(icon, cx, cy, color) {
        const h = icon.length, w = icon[0].length;
        const ox = cx - (w * PIX) / 2;
        const oy = cy - (h * PIX) / 2;
        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                const ch = icon[y][x];
                if (ch === '.') continue;
                ctx.fillStyle = ch === '+' ? NES.black : color;
                ctx.fillRect(ox + x * PIX, oy + y * PIX, PIX, PIX);
            }
        }
    }

    for (const p of G.powerups) {
            // Мигание в последние секунды — предупреждение, что бонус исчезнет
            if (p.life < 3 && Math.floor(p.life * 6) % 2 === 0) continue;
            const icon = POWER_ICONS[p.kind];
            if (!icon) continue;
            // Подложка: тёмная рамка, как под иконками в оригинале
            ctx.fillStyle = NES.black;
            ctx.fillRect(p.x - PIX * 6, p.y - PIX * 6, PIX * 12, PIX * 12);
            drawIcon(icon, p.x, p.y, COLORS.power);
        }
    }

    // ── Экранные кнопки (телефон) ───────────────────────────────────────────
    function bindPad(id, onDown, onUp) {
        const el = document.getElementById(id);
        if (!el) return;
        const press = (e) => { e.preventDefault(); onDown(); };
        const release = (e) => { e.preventDefault(); onUp(); };
        el.addEventListener('touchstart', press, { passive: false });
        el.addEventListener('touchend', release, { passive: false });
        el.addEventListener('mousedown', press);
        el.addEventListener('mouseup', release);
        el.addEventListener('mouseleave', release);
    }

    function setupControls() {
        // Физические клавиши. По e.key буквы опознаются только в латинице:
        // с русской раскладкой или при включённом CapsLock WASD не работали
        // совсем. e.code от раскладки не зависит.
        const KEY_ALIAS = {
            KeyW: 'up', KeyS: 'down', KeyA: 'left', KeyD: 'right',
            ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
        };
        /** Имя управления по событию клавиатуры: сначала e.code, потом e.key. */
        function controlOf(e) {
            const byCode = KEY_ALIAS[e.code];
            if (byCode) return byCode;
            const byKey = KEY_ALIAS[e.key];
            if (byKey) return byKey;
            const lower = typeof e.key === 'string' ? e.key.toLowerCase() : '';
            if (lower === 'w') return 'up';
            if (lower === 's') return 'down';
            if (lower === 'a') return 'left';
            if (lower === 'd') return 'right';
            if (lower === ' ' || e.key === 'Enter') return 'fire';
            return null;
        }

        window.addEventListener('keydown', (e) => {
            const c = controlOf(e);
            if (c) { e.preventDefault(); G.keys[c] = true; }
            if (c === 'fire') startOrAdvance();
        });
        window.addEventListener('keyup', (e) => {
            const c = controlOf(e);
            if (c) G.keys[c] = false;
        });

        bindPad('pad-up', () => { G.touch.up = true; }, () => { G.touch.up = false; });
        bindPad('pad-down', () => { G.touch.down = true; }, () => { G.touch.down = false; });
        bindPad('pad-left', () => { G.touch.left = true; }, () => { G.touch.left = false; });
        bindPad('pad-right', () => { G.touch.right = true; }, () => { G.touch.right = false; });
        bindPad('pad-fire', () => { G.touch.fire = true; startOrAdvance(); }, () => { G.touch.fire = false; });

        // Кнопок старта две: крупная в оверлее и та, что рядом с позывным
        for (const id of ['start-btn', 'start-btn-main']) {
            const btn = document.getElementById(id);
            if (btn) btn.addEventListener('click', () => startOrAdvance());
        }
    }

    function startOrAdvance() {
        if (G.state === 'menu') {
            G.score = 0;
            G.lives = 3;
            submitted = false;
            loadLevel(1);
            G.state = 'play';
            hideOverlay();
        } else if (G.state === 'levelclear') {
            loadLevel(G.level + 1);
            G.state = 'play';
            hideOverlay();
        } else if (G.state === 'gameover') {
            // Сначала отправляем результат (если введён позывной), потом
            // сразу начинаем новую игру — лишнее нажатие не нужно.
            submitScore();
            G.score = 0;
            G.lives = 3;
            submitted = false;
            loadLevel(1);
            G.state = 'play';
            hideOverlay();
        }
    }

    // ── Лидерборд ───────────────────────────────────────────────────────────
    const API = '/panel-api/game/scores';

    function showOverlay(title, sub, showSubmit) {
        const ov = document.getElementById('overlay');
        const t = document.getElementById('ov-title');
        const s = document.getElementById('ov-sub');
        const form = document.getElementById('submit-form');
        if (!ov) return;
        t.textContent = title;
        s.textContent = sub;
        if (form) form.style.display = showSubmit ? 'block' : 'none';
        ov.style.display = 'block';
    }

    function hideOverlay() {
        const ov = document.getElementById('overlay');
        if (ov) ov.style.display = 'none';
    }

    async function loadScores() {
        try {
            const res = await fetch(API + '?limit=10');
            const data = await res.json();
            const list = document.getElementById('scores-list');
            if (!list) return;
            if (!data.scores || data.scores.length === 0) {
                list.innerHTML = '<li class="empty">Рекордов пока нет — будь первым</li>';
                return;
            }
            list.innerHTML = data.scores.map((s, i) =>
                `<li><span class="place ${i < 3 ? 'top' : ''}">${i + 1}</span>` +
                `<span class="nick">${escapeHtml(s.nickname)}</span>` +
                `<span class="sc">${s.score}</span></li>`
            ).join('');
        } catch {
            const list = document.getElementById('scores-list');
            if (list) list.innerHTML = '<li class="empty">Таблица рекордов недоступна</li>';
        }
    }

    function escapeHtml(s) {
        return String(s).replace(/[&<>"']/g, (ch) => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
        })[ch]);
    }

    let submitted = false;
    async function submitScore() {
        if (submitted) return;
        if (G.score < 100) return;
        const nick = (document.getElementById('nick') || {}).value;
        if (!nick || !nick.trim()) return;
        submitted = true;
        try {
            await fetch(API, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ nickname: nick.trim(), score: G.score, level: G.level }),
            });
            loadScores();
        } catch { /* таблица рекордов не критична для игры */ }
    }

    // ── Главный цикл ────────────────────────────────────────────────────────
    function loop(ts) {
        const dt = Math.min(0.05, (ts - G.lastTime) / 1000 || 0);
        G.lastTime = ts;
        G.tick++;
        update(dt);
        draw();
        updateHud();
        requestAnimationFrame(loop);
    }

    function updateHud() {
        const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
        set('hud-score', G.score);
        set('hud-level', G.level);
        set('hud-lives', G.lives);
        set('hud-best', G.best);

        if (G.state === 'gameover' && document.getElementById('overlay').style.display === 'none') {
            showOverlay('Игра окончена', `Очки: ${G.score}`, true);
        }
        if (G.state === 'levelclear' && document.getElementById('overlay').style.display === 'none') {
            showOverlay('Уровень пройден', `Очки: ${G.score} · Дальше — Enter`, false);
        }
    }

    // ── Запуск ──────────────────────────────────────────────────────────────
    // ── Полноэкранный режим ──────────────────────────────────────────────────
//
// Кнопка выводит игру на весь экран: поле растягивается, элементы страницы
// вокруг скрываются. Это удобно на телефоне — экран целиком занят игрой.
//
// Полноэкранный API требует жеста пользователя, поэтому вход возможен
// только из обработчика нажатия. На iOS Safari полноэкранный режим для
// произвольных элементов не поддерживается — там остаётся обычный вид
// с увеличенным полем, и кнопка честно сообщает об этом, а не молчит.
function setupFullscreen() {
    const root = document.getElementById('play');
    const btn = document.getElementById('fs-btn');
    if (!root || !btn) return;

    const supported = !!(document.fullscreenEnabled || document.webkitFullscreenEnabled);

    const sync = () => {
        const active = !!(document.fullscreenElement || document.webkitFullscreenElement);
        root.classList.toggle('is-fullscreen', active);
        btn.textContent = active ? '⛶' : '⛶';
        btn.setAttribute('aria-pressed', active ? 'true' : 'false');
    };

    if (!supported) {
        btn.disabled = true;
        btn.title = 'Полноэкранный режим недоступен в этом браузере';
        return;
    }

    btn.addEventListener('click', () => {
        const active = document.fullscreenElement || document.webkitFullscreenElement;
        if (active) {
            (document.exitFullscreen || document.webkitExitFullscreen).call(document);
        } else {
            const req = root.requestFullscreen || root.webkitRequestFullscreen;
            // Отказ браузера не должен ломать игру — просто остаёмся в обычном виде
            const p = req.call(root);
            if (p && typeof p.catch === 'function') p.catch(() => { /* остаёмся как есть */ });
        }
    });

    document.addEventListener('fullscreenchange', sync);
    document.addEventListener('webkitfullscreenchange', sync);
    sync();
}

function init() {
        setupControls();
        setupFullscreen();
        loadScores();
        // Год в подвале ставится здесь, а не инлайновым <script>:
        // инлайновые скрипты запрещены политикой безопасности заглушки.
        const year = document.getElementById('year');
        if (year) year.textContent = String(new Date().getFullYear());
        // Показываем первый экран, но поле уже собрано — фон не пустой
        loadLevel(1);
        G.state = 'menu';
        showOverlay('ТАНКИ', 'Пробел или Enter — начать игру', false);
        requestAnimationFrame((ts) => { G.lastTime = ts; loop(ts); });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();