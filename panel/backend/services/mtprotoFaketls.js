/**
 * @fileoverview Готовность маскировочного домена для MTProto Fake TLS.
 *
 * Fake TLS работает, только если:
 *   1) домен из настройки mask_domain поддерживает TLS 1.3;
 *   2) домен резолвится в IP нашего прокси — иначе DPI видит «нестыковку»
 *      (сертификат чужого домена выдаётся с нашего IP) и прокси выдаёт себя.
 *
 * Проверка требует сети, поэтому она выполняется отдельно и кладётся в БД.
 * Генератор ссылок читает результат синхронно — блокировать выдачу ссылок
 * на сетевую проверку нельзя.
 *
 * Пока готовность не подтверждена, ee-ссылки не выдаются вообще: лучше
 * показать клиенту рабочую dd-ссылку, чем молча сломанную.
 * @module services/mtprotoFaketls
 */

const dns = require('dns').promises;
const tls = require('tls');
const db = require('../db');
const config = require('../config');
const logger = require('../utils/logger');

const CACHE_KEY = 'faketls:status';
const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 часов

/** Текущий статус из БД. */
function getStatus() {
    try {
        const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(CACHE_KEY);
        if (!row) return { ready: false, checkedAt: null, domain: null, reason: 'not_checked' };
        const parsed = JSON.parse(row.value);
        if (Date.now() - new Date(parsed.checkedAt || 0).getTime() > CACHE_TTL_MS) {
            return { ...parsed, stale: true };
        }
        return parsed;
    } catch {
        return { ready: false, checkedAt: null, domain: null, reason: 'not_checked' };
    }
}

/** Готов ли домен для выдачи ee-ссылок (без сетевых запросов). */
function isReady() {
    return getStatus().ready === true;
}

function saveStatus(status) {
    try {
        db.prepare(
            'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
        ).run(CACHE_KEY, JSON.stringify(status));
    } catch (e) {
        logger.warn('Не удалось сохранить статус Fake TLS', { error: e.message });
    }
}

/** Проверяет, что домен принимает TLS 1.3. */
function checkTls13(domain) {
    return new Promise((resolve) => {
        const socket = tls.connect(
            {
                host: domain,
                port: 443,
                servername: domain,
                timeout: 8000,
                rejectUnauthorized: false,
            },
            () => {
                const proto = socket.getProtocol();
                socket.destroy();
                resolve(proto === 'TLSv1.3');
            }
        );
        socket.on('error', () => resolve(false));
        socket.on('timeout', () => { socket.destroy(); resolve(false); });
    });
}

/** Диапазоны, узнаваемые по характерным подсетям. */
const CDN_RANGES = [
    { name: 'Cloudflare', test: (ip) => /^2606:4700:|^104\.1[6-9]\.|^104\.2[0-9]\.|^172\.64\.|^173\.245\./.test(ip) },
    { name: 'Amazon CloudFront', test: (ip) => /^13\.|^18\.|^54\.182\.|^54\.192\./.test(ip) },
    { name: 'Fastly', test: (ip) => /^23\.235\.|^151\.101\./.test(ip) },
];

/**
 * Опознаёт, стоят ли адреса домена за CDN.
 *
 * Для Fake TLS это важно: если домен закрыт оранжевым облаком, в DNS он
 * отдаёт адреса CDN, а не адрес сервера. Рукопожатие идёт напрямую на
 * сервер, а SNI указывает на домен — DPI видит расхождение и безошибочно
 * определяет прокси. Лечится только переводом домена в режим «только DNS».
 *
 * @param {string[]} ips - адреса, которые вернул DNS
 * @returns {string|null} имя CDN либо null
 */
function detectCdn(ips) {
    for (const ip of ips) {
        for (const cdn of CDN_RANGES) {
            if (cdn.test(ip)) return cdn.name;
        }
    }
    return null;
}

/**
 * Выполняет полную проверку и кладёт результат в БД.
 * @returns {Promise<{ready: boolean, domain: string|null, reason: string, checkedAt: string}>}
 */
async function check({ force = false } = {}) {
    const current = getStatus();
    if (!force && current.ready && !current.stale) return current;

    const domain = String(current.domain || readMaskDomain() || '').trim().toLowerCase();
    const checkedAt = new Date().toISOString();

    if (!domain) {
        const s = { ready: false, domain: null, reason: 'no_domain', checkedAt };
        saveStatus(s);
        return s;
    }

    // 1. IP домена должен совпадать с IP прокси
    let ips = [];
    try {
        ips = await dns.lookup(domain, { all: true });
    } catch {
        const s = { ready: false, domain, reason: 'dns_fail', checkedAt };
        saveStatus(s);
        return s;
    }
    const serverIp = String(config.serverIp || '').trim();
    const matches = ips.some((r) => r.address === serverIp);
    if (serverIp && !matches) {
        // Отдельно опознаём CDN и прокси: там причина не «домен настроен не туда»,
        // а «домен закрыт оранжевым облаком», и это лечится иначе. Без такой
        // подсказки администратор смотрит на список адресов и не понимает,
        // что́ именно нужно поменять.
        const cdn = detectCdn(ips.map((r) => r.address));
        const s = {
            ready: false,
            domain,
            reason: cdn ? 'behind_cdn' : 'ip_mismatch',
            detail: ips.map((r) => r.address).join(', '),
            cdn,
            serverIp,
            checkedAt,
        };
        saveStatus(s);
        logger.warn('Fake TLS: IP маскировочного домена не совпадает с IP прокси', {
            domain, ips: s.detail, serverIp, cdn: cdn || undefined,
        });
        return s;
    }

    // 2. Домен должен поддерживать TLS 1.3
    const tlsOk = await checkTls13(domain);
    const s = tlsOk
        ? { ready: true, domain, reason: 'ok', checkedAt }
        : { ready: false, domain, reason: 'no_tls13', checkedAt };
    saveStatus(s);
    logger.info(`Fake TLS: домен ${domain} — ${s.reason}`);
    return s;
}

function readMaskDomain() {
    try {
        const row = db.prepare('SELECT value FROM settings WHERE key = ?').get('mask_domain');
        return row ? JSON.parse(row.value) : null;
    } catch {
        return null;
    }
}

module.exports = { check, getStatus, isReady, detectCdn };