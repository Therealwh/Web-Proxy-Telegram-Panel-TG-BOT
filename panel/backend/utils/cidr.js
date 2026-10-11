/**
 * @fileoverview Разбор и проверка адресов и подсетей (CIDR).
 *
 * Вынесено отдельно от логики блокировки, потому что ошибка здесь опасна
 * обоих видов: принять мусор — значит написать в Nginx или nftables правило,
 * которое молча ничего не блокирует; принять слишком широкий диапазон —
 * значит отрезать доступ к прокси половине интернета вместе с нарушителем.
 * Обе ошибки делаем явными и проверяемыми.
 * @module utils/cidr
 */

/** Преобразует IPv4 в 32-битное число. */
function ipv4ToInt(ip) {
    const parts = String(ip).trim().split('.');
    if (parts.length !== 4) return null;
    let n = 0;
    for (const p of parts) {
        if (!/^\d{1,3}$/.test(p)) return null;
        const v = Number(p);
        if (v > 255) return null;
        // Запрещаем ведущие нули: «01» неоднозначен и в разных системах
        // читается по-разному, из-за чего правило может не сработать.
        if (p.length > 1 && p.startsWith('0')) return null;
        n = (n << 8) | v;
    }
    return n >>> 0;
}

/** Разбирает IPv6 в BigInt (включая сжатие `::` и внутренний IPv4). */
function ipv6ToBigInt(ip) {
    let s = String(ip).trim();
    if (s.startsWith('[') && s.endsWith(']')) s = s.slice(1, -1);
    if (!s.includes(':')) return null;

    // Внутренний IPv4 вида ::ffff:1.2.3.4
    let tail = 0n;
    const lastColon = s.lastIndexOf(':');
    const maybeV4 = s.slice(lastColon + 1);
    if (maybeV4.includes('.')) {
        const v4 = ipv4ToInt(maybeV4);
        if (v4 === null) return null;
        tail = BigInt(v4);
        s = s.slice(0, lastColon + 1) + '0:0';
    }

    const dbl = s.indexOf('::');
    if (dbl !== -1 && s.indexOf('::', dbl + 1) !== -1) return null; // две сжатые группы

    const expand = (part) => (part === '' ? [] : part.split(':'));
    let head, rear;
    if (dbl === -1) {
        head = expand(s);
        rear = [];
    } else {
        head = expand(s.slice(0, dbl));
        rear = expand(s.slice(dbl + 2));
    }
    const total = head.length + rear.length;
    if (total > 8) return null;

    const groups = [...head, ...Array(8 - total).fill('0'), ...rear];
    let n = 0n;
    for (const g of groups) {
        if (g === '' || !/^[0-9a-fA-F]{1,4}$/.test(g)) return null;
        n = (n << 16n) | BigInt(parseInt(g, 16));
    }
    return n;
}

/**
 * Нормализует адрес или подсеть и проверяет корректность.
 *
 * @param {string} raw - «1.2.3.4», «10.0.0.0/8», «2001:db8::/32»
 * @returns {{ok: true, cidr: string, family: 4|6, base: bigint, prefix: number}
 *          | {ok: false, error: string}}
 */
function parseCidr(raw) {
    const value = String(raw || '').trim().toLowerCase();
    if (!value) return { ok: false, error: 'Пустое значение' };

    let addr = value;
    let prefix = null;
    const slash = value.indexOf('/');
    if (slash !== -1) {
        addr = value.slice(0, slash);
        const p = value.slice(slash + 1);
        if (!/^\d{1,3}$/.test(p)) return { ok: false, error: `Неверная маска: ${p}` };
        prefix = Number(p);
    }

    // Пробуем IPv4, затем IPv6
    const v4 = ipv4ToInt(addr);
    if (v4 !== null) {
        const bits = prefix === null ? 32 : prefix;
        if (bits > 32) return { ok: false, error: 'Маска больше /32 для IPv4' };
        const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
        const base = (v4 & mask) >>> 0;
        return {
            ok: true,
            family: 4,
            cidr: `${intToIpv4(base)}/${bits}`,
            base: BigInt(base),
            prefix: bits,
        };
    }

    const v6 = ipv6ToBigInt(addr);
    if (v6 !== null) {
        const bits = prefix === null ? 128 : prefix;
        if (bits > 128) return { ok: false, error: 'Маска больше /128 для IPv6' };
        const mask = bits === 0 ? 0n : ((1n << BigInt(bits)) - 1n) << BigInt(128 - bits);
        const base = v6 & mask;
        return {
            ok: true,
            family: 6,
            cidr: `${bigIntToIpv6(base)}/${bits}`,
            base,
            prefix: bits,
        };
    }

    return { ok: false, error: `Не распознан адрес: ${addr}` };
}

/**
 * Проверяет, что подсеть не слишком широкая.
 *
 * Для IPv4 шире /8 запрещаем: это миллионы адресов, и такая «блокировка»
 * на практике всегда означает ошибку или злоупотребление — она отрежет
 * прокси огромной части клиентов вместо того, чтобы кого-то исключить.
 * /8 остаётся верхней границей и требует явного подтверждения вызывающим.
 *
 * @param {{family: number, prefix: number}} parsed
 * @param {number} [minPrefix] - минимально допустимая длина маски
 * @returns {{ok: boolean, error?: string, warning?: string}}
 */
function checkScope(parsed, minPrefix = 8) {
    if (parsed.family === 4 && parsed.prefix < minPrefix) {
        return { ok: false, error: `Подсеть шире /${minPrefix}: под неё попадёт слишком много адресов` };
    }
    if (parsed.family === 6 && parsed.prefix < 16) {
        return { ok: false, error: 'Подсеть IPv6 шире /16 — скорее всего, это ошибка ввода' };
    }
    if (parsed.family === 4 && parsed.prefix === 8) {
        return { ok: true, warning: '/8 — целый блок адресов. Проверьте, что это действительно нужно' };
    }
    return { ok: true };
}

/** Проверяет вхождение адреса в подсеть. */
function contains(parsed, ip) {
    const v4 = ipv4ToInt(ip);
    if (v4 !== null && parsed.family === 4) {
        const mask = parsed.prefix === 0 ? 0 : (0xffffffff << (32 - parsed.prefix)) >>> 0;
        return (((v4 & mask) >>> 0) === Number(parsed.base));
    }
    const v6 = ipv6ToBigInt(ip);
    if (v6 !== null && parsed.family === 6) {
        const mask = parsed.prefix === 0 ? 0n : ((1n << BigInt(parsed.prefix)) - 1n) << BigInt(128 - parsed.prefix);
        return (v6 & mask) === parsed.base;
    }
    return false;
}

/** Суммарное число адресов в подсети (для показа админу). */
function addressCount(parsed) {
    if (parsed.family === 4) return 2 ** (32 - parsed.prefix);
    return 2 ** (128 - parsed.prefix);
}

function intToIpv4(n) {
    return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.');
}

function bigIntToIpv6(n) {
    const parts = [];
    for (let i = 7; i >= 0; i--) parts.push(Number((n >> BigInt(i * 16)) & 0xffffn).toString(16));
    // Сжимаем самый длинный нулевой отрезок, как это делает стандартная запись
    let bestStart = -1, bestLen = 0, curStart = -1, curLen = 0;
    for (let i = 0; i < 8; i++) {
        if (parts[i] === '0') {
            if (curStart === -1) { curStart = i; curLen = 1; } else { curLen++; }
            if (curLen > bestLen) { bestLen = curLen; bestStart = curStart; }
        } else { curStart = -1; curLen = 0; }
    }
    if (bestLen < 2) return parts.join(':');
    return `${parts.slice(0, bestStart).join(':')}::${parts.slice(bestStart + bestLen).join(':')}`;
}

module.exports = { parseCidr, checkScope, contains, addressCount, ipv4ToInt, ipv6ToBigInt };