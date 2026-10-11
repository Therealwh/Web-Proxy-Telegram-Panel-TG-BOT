/**
 * @fileoverview Тесты логики резервного маршрута WARP (node:test).
 *
 * Здесь важна корректность правил маршрутизации: лишнее правило уводит в
 * туннель чужой трафик, а недостающее правило оставляет резерв бесполезным.
 * Запуск: node --test tests/warp.test.js
 */

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-for-unit-tests';

const { test, describe } = require('node:test');
const assert = require('node:assert');

const {
    TELEGRAM_DC_CIDRS, TELEGRAM_DC_CIDRS_V6, ROUTE_TABLE, ROUTE_TABLE_V6, RULE_PRIORITY,
    splitByFamily, buildEnableCommands, buildDisableCommands,
    parseWarpStatus, routeEffective,
} = require('../services/warp');

describe('подсети Telegram DC', () => {
    test('список не пуст и без пустых значений', () => {
        assert.ok(TELEGRAM_DC_CIDRS.length >= 8);
        assert.ok(TELEGRAM_DC_CIDRS_V6.length >= 6);
        assert.ok([...TELEGRAM_DC_CIDRS, ...TELEGRAM_DC_CIDRS_V6].every((c) => c && !c.includes(' ')));
    });

    test('подсети IPv4 действительно IPv4', () => {
        for (const c of TELEGRAM_DC_CIDRS) {
            assert.ok(!c.includes(':'), `${c} не должен быть IPv6`);
            assert.match(c, /^\d+\.\d+\.\d+\.\d+\/\d+$/, `${c} выглядит некорректно`);
        }
    });

    test('подсети IPv6 действительно IPv6', () => {
        for (const c of TELEGRAM_DC_CIDRS_V6) assert.ok(c.includes(':'), `${c} должен быть IPv6`);
    });

    test('дубликатов нет', () => {
        const all = [...TELEGRAM_DC_CIDRS, ...TELEGRAM_DC_CIDRS_V6];
        assert.equal(new Set(all).size, all.length);
    });

    test('разделение по семейству корректно', () => {
        const { v4, v6 } = splitByFamily([...TELEGRAM_DC_CIDRS, ...TELEGRAM_DC_CIDRS_V6]);
        assert.equal(v4.length, TELEGRAM_DC_CIDRS.length);
        assert.equal(v6.length, TELEGRAM_DC_CIDRS_V6.length);
    });
});

describe('включение маршрута', () => {
    const { v4, v6 } = buildEnableCommands('warp0');

    test('маршрут по умолчанию задаётся для каждой таблицы', () => {
        assert.ok(v4.includes(`ip route replace default dev warp0 table ${ROUTE_TABLE}`));
        assert.ok(v6.some((c) => c.includes(ROUTE_TABLE_V6) && c.includes('default dev warp0')));
    });

    test('правило создаётся на каждую подсеть', () => {
        const rules4 = v4.filter((c) => c.startsWith('ip rule add'));
        assert.equal(rules4.length, TELEGRAM_DC_CIDRS.length);
    });

    test('каждая подсеть Telegram получает правило', () => {
        for (const cidr of TELEGRAM_DC_CIDRS) {
            assert.ok(v4.some((c) => c.includes(`to ${cidr} lookup`)), `нет правила для ${cidr}`);
        }
    });

    test('правила помечены приоритетом, чтобы снимать точечно', () => {
        for (const c of v4.filter((x) => x.startsWith('ip rule add'))) {
            assert.ok(c.includes(`priority ${RULE_PRIORITY}`));
        }
    });

    test('чужие таблицы не затрагиваются', () => {
        for (const c of [...v4, ...v6]) {
            assert.ok(!/table main\b/.test(c));
            assert.ok(!/flush/.test(c));
        }
    });

    test('включение не трогает трафик вне подсетей Telegram', () => {
        // Ни одно правило не должно быть без "to" — иначе ушёл бы весь трафик
        for (const c of v4.filter((x) => x.startsWith('ip rule add'))) {
            assert.match(c, / to \S+ /, `правило без адреса назначения: ${c}`);
        }
    });
});

describe('выключение маршрута', () => {
    const { v4, v6 } = buildDisableCommands();

    test('снимается правило для каждой подсети', () => {
        assert.equal(v4.length, TELEGRAM_DC_CIDRS.length);
        assert.equal(v6.length, TELEGRAM_DC_CIDRS_V6.length);
    });

    test('используется del, а не flush', () => {
        for (const c of [...v4, ...v6]) {
            assert.match(c, /^ip( -6)? rule del /);
            assert.ok(!/flush/.test(c));
        }
    });

    test('снимается ровно те правила, что ставились', () => {
        const enabled = buildEnableCommands('warp0');
        const disabled = buildDisableCommands();
        for (const cidr of TELEGRAM_DC_CIDRS) {
            assert.ok(
                enabled.v4.some((c) => c.includes(`to ${cidr} lookup`)),
                `не включается ${cidr}`
            );
            assert.ok(
                disabled.v4.some((c) => c.includes(`to ${cidr} lookup`)),
                `не снимается ${cidr}`
            );
        }
    });
});

describe('разбор статуса WARP', () => {
    test('пустой вывод — клиент не установлен', () => {
        const s = parseWarpStatus('');
        assert.equal(s.installed, false);
        assert.equal(s.connected, false);
    });

    test('команда не найдена', () => {
        assert.equal(parseWarpStatus('bash: warp-cli: command not found').installed, false);
    });

    test('подключённое состояние распознаётся', () => {
        const s = parseWarpStatus('Status update: Connected');
        assert.equal(s.connected, true);
        assert.equal(s.installed, true);
    });

    test('отключённое состояние не считается подключением', () => {
        const s = parseWarpStatus('Status update: Disconnected');
        assert.equal(s.connected, false);
    });

    test('Disconnected не перебивается словом connected', () => {
        // Регекс «connected» внутри «Disconnected» — ловушка наивного поиска
        assert.equal(parseWarpStatus('Status update: Disconnected').connected, false);
    });
});

describe('эффективность маршрута', () => {
    test('маршрут работает только при установленном и подключённом клиенте', () => {
        assert.equal(routeEffective({ installed: true, connected: true }), true);
        assert.equal(routeEffective({ installed: true, connected: false }), false);
        assert.equal(routeEffective({ installed: false, connected: true }), false);
    });

    test('без туннеля маршрут считается нерабочим', () => {
        // Ключевой случай: правила есть, но трафик уходит в никуда
        assert.equal(routeEffective({ installed: false, connected: false }), false);
    });
});