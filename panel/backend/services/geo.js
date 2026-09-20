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

module.exports = { lookup, lookupMany };
