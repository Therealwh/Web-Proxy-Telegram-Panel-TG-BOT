/**
 * @fileoverview Резервный маршрут к Telegram DC через WARP.
 *
 * Зачем: если доступ с IP сервера к адресам Telegram DC закрывается,
 * клиенты подключаются к прокси, но ничего не грузится — обрыв на участке
 * «сервер → Telegram». Перезапуск движка не помогает, маршрут тот же.
 * DC-монитор такое состояние видит, но обойти не может.
 *
 * WARP (бесплатный клиент Cloudflare) даёт обходной путь: оператор видит
 * соединение с Cloudflare, а не с адресами Telegram, и содержимое туннеля
 * для него непрозрачно. Из инфраструктуры Cloudflare до Telegram DC маршрут
 * обычно есть.
 *
 * ВАЖНО: через туннель уходят ТОЛЬКО адреса Telegram DC. Весь остальной
 * трафик (панель, сайты, обновления) идёт напрямую — иначе WARP станет
 * обязательным и начнём платить задержкой и зависимостью на чужой сервис
 * вообще на всём.
 *
 * Всё выключено по умолчанию: включается только явным действием админа.
 * @module services/warp
 */

/**
 * Подсети Telegram DC по данным core.telegram.org.
 *
 * Движок получает актуальные адреса сам, но для маршрутизации нужны они
 * заранее: ip rule работает по таблице маршрутов, а не по факту соединения.
 * Если Telegram сменит подсети, резервный маршрут просто не сработает —
 * поэтому состояние показывается как «включён», а не «работает», и рядом
 * всегда виден способ перепроверить.
 */
const TELEGRAM_DC_CIDRS = [
    '149.154.160.0/20',
    '149.154.167.48/20',
    '149.154.175.0/24',
    '91.108.4.0/22',
    '91.108.8.0/22',
    '91.108.12.0/22',
    '91.108.20.0/22',
    '91.108.56.0/22',
    '95.161.64.0/20',
];

const TELEGRAM_DC_CIDRS_V6 = [
    '2001:b28:f23d:f001::/64',
    '2001:b28:f23d:f003::/64',
    '2001:b28:f23f:f001::/64',
    '2001:67c:4e8:f002::/64',
    '2001:67c:4e8:f004::/64',
    '2001:67c:4e8:f006::/64',
];

/** Имя таблицы маршрутизации: изолируем правила, не трогая main. */
const ROUTE_TABLE = 'tggate_warp';
const ROUTE_TABLE_V6 = 'tggate_warp6';

/** Метка правил — нужна, чтобы снимать только свои, не чужие. */
const RULE_PRIORITY = 1100;

/**
 * Разбивает список подсетей по семейству.
 * @param {string[]} cidrs
 * @returns {{v4: string[], v6: string[]}}
 */
function splitByFamily(cidrs) {
    const v4 = [];
    const v6 = [];
    for (const c of cidrs) {
        if (String(c).includes(':')) v6.push(c);
        else v4.push(c);
    }
    return { v4, v6 };
}

/**
 * Команды ip rule / ip route для включения резервного маршрута.
 *
 * Логика: для каждой подсети Telegram добавляется правило «перейти в
 * таблицу tggate_warp», в которой лежит маршрут по умолчанию через интерфейс
 * туннеля. Правила помечены приоритетом, чтобы снимать их можно было
 * точечно, не разбирая чужую маршрутизацию.
 *
 * @param {string} iface - интерфейс туннеля (например warp0)
 * @returns {{v4: string[], v6: string[]}} готовые команды
 */
function buildEnableCommands(iface = 'warp0') {
    const { v4, v6 } = splitByFamily([...TELEGRAM_DC_CIDRS, ...TELEGRAM_DC_CIDRS_V6]);

    const cmd4 = [`ip route replace default dev ${iface} table ${ROUTE_TABLE}`];
    for (const cidr of v4) {
        cmd4.push(`ip rule add priority ${RULE_PRIORITY} to ${cidr} lookup ${ROUTE_TABLE}`);
    }

    const cmd6 = [];
    if (v6.length > 0) {
        cmd6.push(`ip -6 route replace default dev ${iface} table ${ROUTE_TABLE_V6}`);
        for (const cidr of v6) {
            cmd6.push(`ip -6 rule add priority ${RULE_PRIORITY} to ${cidr} lookup ${ROUTE_TABLE_V6}`);
        }
    }

    return { v4: cmd4, v6: cmd6 };
}

/**
 * Команды для снятия резервного маршрута.
 *
 * Снимаем по одной подсети на всякий случай: если часть правил уже удалена
 * (например, после перезагрузки), падение одного delete не должно оставить
 * маршрут включённым наполовину.
 *
 * @returns {{v4: string[], v6: string[]}}
 */
function buildDisableCommands() {
    const { v4, v6 } = splitByFamily([...TELEGRAM_DC_CIDRS, ...TELEGRAM_DC_CIDRS_V6]);
    const cmd4 = v4.map((cidr) => `ip rule del priority ${RULE_PRIORITY} to ${cidr} lookup ${ROUTE_TABLE}`);
    const cmd6 = v6.map((cidr) => `ip -6 rule del priority ${RULE_PRIORITY} to ${cidr} lookup ${ROUTE_TABLE_V6}`);
    return { v4: cmd4, v6: cmd6 };
}

/**
 * Разбирает вывод `warp-cli status`.
 *
 * У разных версий клиента формат отличается, поэтому опираемся на признаки,
 * а не на позиции символов.
 *
 * @param {string} raw - вывод команды
 * @returns {{installed: boolean, connected: boolean, account: boolean}}
 */
function parseWarpStatus(raw) {
    const text = String(raw || '').toLowerCase();
    if (!text.trim()) return { installed: false, connected: false, account: false };
    return {
        installed: !/command not found|no such file|не найден/i.test(text),
        connected: /\bconnected\b|подключено|active connection/i.test(text)
            && !/disconnected|не подключено/i.test(text),
        account: /status update: connected|registered/i.test(text)
            || /\bconnected\b/i.test(text),
    };
}

/**
 * Есть ли в системе активное соединение WARP.
 * Отдельно от connected: маршрут без туннеля опаснее, чем без маршрута,
 * поэтому этот случай считаем за «маршрут не работает» и предлагаем снять.
 *
 * @param {{installed: boolean, connected: boolean}} st
 * @returns {boolean}
 */
function routeEffective(st) {
    return Boolean(st.installed && st.connected);
}

module.exports = {
    TELEGRAM_DC_CIDRS,
    TELEGRAM_DC_CIDRS_V6,
    ROUTE_TABLE,
    ROUTE_TABLE_V6,
    RULE_PRIORITY,
    splitByFamily,
    buildEnableCommands,
    buildDisableCommands,
    parseWarpStatus,
    routeEffective,
};