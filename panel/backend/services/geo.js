/**
 * @fileoverview Геолокация IP-адресов через бесплатный ip-api.com (без ключа,
 * лимит 45 запросов/мин). Результаты кэшируются в БД (таблица settings,
 * ключи geo:<ip>) навсегда — страна у IP не меняется часто.
 * @module services/geo
 */

const db = require('../db');

// Приватные/локальные диапазоны — геолокации нет
const PRIVATE_RE = /^(10\.|127\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|::1|fc00:|fd00:|fe80:)/i;

/**
 * Определяет страну по IP (с кэшем в БД).
 * @param {string} ip
 * @returns {Promise<{country: string, code: string}>}
 */
async function lookup(ip) {
    if (!ip || PRIVATE_RE.test(ip)) {
        return { country: 'Локальная сеть', code: '—' };
    }

    // Кэш в БД
    const key = `geo:${ip}`;
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
    if (row) {
        try { return JSON.parse(row.value); } catch { /* битый кэш — перезапросим */ }
    }

    const result = await fetchRemote(ip);

    try {
        db.prepare(
            'INSERT INTO settings (key, value) VALUES (?, ?) ' +
            'ON CONFLICT(key) DO UPDATE SET value = excluded.value'
        ).run(key, JSON.stringify(result));
    } catch { /* кэш не критичен */ }

    return result;
}

/** Запрос к ip-api.com с понятным фолбэком. */
async function fetchRemote(ip) {
    try {
        const res = await fetch(`http://ip-api.com/json/${encodeURIComponent(ip)}?fields=country,countryCode`, {
            signal: AbortSignal.timeout(5000),
        });
        if (res.ok) {
            const data = await res.json();
            if (data.country) {
                return { country: data.country, code: data.countryCode || '—' };
            }
        }
    } catch { /* сеть недоступна — фолбэк */ }
    return { country: 'Неизвестно', code: '—' };
}

/** Поля расширенного запроса: добавляем город и автономную систему. */
const FIELDS = 'country,countryCode,city,as,asname';

/**
 * Расширенный поиск: страна, город, ASN и его оператор.
 *
 * Отдельная функция, а не расширение lookup(), потому что бесплатный ip-api
 * не даёт батчи и жёстко ограничен 45 запросами в минуту. Сборщик логов
 * вызывает её только для НОВЫХ подключений, а кэш в БД не даёт повторять
 * уже известные адреса.
 *
 * Старые записи кэша (со страной, но без города и ASN) считаются неполными
 * и один раз перезапрашиваются — иначе новые поля так и остались бы пустыми
 * у всех, кто пользовался панелью до этого обновления.
 *
 * @param {string} ip
 * @returns {Promise<{country: string, code: string, city: string, asn: number|null, asnOrg: string}>}
 */
async function lookupFull(ip) {
    const empty = { country: 'Неизвестно', code: '—', city: '', asn: null, asnOrg: '' };
    if (!ip || PRIVATE_RE.test(ip)) {
        return { country: 'Локальная сеть', code: '—', city: '', asn: null, asnOrg: '' };
    }

    const key = `geo:${ip}`;
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
    if (row) {
        try {
            const cached = JSON.parse(row.value);
            // Запись без ASN сделана старой версией панели — обновляем один раз
            if (cached.asn !== undefined || cached.city !== undefined) return cached;
        } catch { /* битый кэш — перезапросим */ }
    }

    let result = empty;
    try {
        const res = await fetch(`http://ip-api.com/json/${encodeURIComponent(ip)}?fields=${FIELDS}`, {
            signal: AbortSignal.timeout(5000),
        });
        if (res.ok) {
            const data = await res.json();
            if (data.country) {
                result = {
                    country: data.country,
                    code: data.countryCode || '—',
                    city: data.city || '',
                    asn: data.as ? Number(data.as) || null : null,
                    asnOrg: data.asname || '',
                };
            }
        }
    } catch { /* сеть недоступна или лимит API — фолбэк */ }

    // Негативный результат НЕ кэшируем: причина может быть временной (лимит),
    // и тогда адрес потерял бы геолокацию навсегда.
    if (result !== empty) {
        try {
            db.prepare(
                'INSERT INTO settings (key, value) VALUES (?, ?) ' +
                'ON CONFLICT(key) DO UPDATE SET value = excluded.value'
            ).run(key, JSON.stringify(result));
        } catch { /* кэш не критичен */ }
    }
    return result;
}

/**
 * Расширенный поиск по списку IP.
 * @param {string[]} ips
 * @returns {Promise<Object<string, object>>}
 */
async function lookupFullMany(ips) {
    const unique = [...new Set(ips.filter(Boolean))].slice(0, 30);
    const out = {};
    for (const ip of unique) {
        out[ip] = await lookupFull(ip);
        // Пауза между запросами: бесплатный лимит 45/мин, запас не даёт упереться
        if (unique.length > 5) await new Promise((r) => setTimeout(r, 120));
    }
    return out;
}

/**
 * Геолокация списка IP (последовательно, чтобы не превысить лимит API).
 * @param {string[]} ips
 * @returns {Promise<Object<string, {country: string, code: string}>>}
 */
async function lookupMany(ips) {
    const unique = [...new Set(ips.filter(Boolean))].slice(0, 50);
    const out = {};
    for (const ip of unique) {
        out[ip] = await lookup(ip);
    }
    return out;
}

module.exports = { lookup, lookupMany, lookupFull, lookupFullMany };
