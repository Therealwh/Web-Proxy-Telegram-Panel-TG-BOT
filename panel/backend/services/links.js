/**
 * @fileoverview Генерация ссылок подключения для клиентов.
 * Web Proxy: tg://webproxy?server=DOMAIN&secret=dd<16hex>
 * MTProto:   tg://proxy?server=DOMAIN&port=8443&secret=dd<secret>
 *            + Fake TLS:  ...&secret=ee<secret><tls_domain_hex>
 *
 * Обе формы MTProto выдаются одновременно и обе рабочие: движок не ограничен
 * allowed_protocols, поэтому клиент выбирает то, что работает у его оператора.
 * Старые dd-ссылки не выводятся из обращения и остаются у клиентов.
 * @module services/links
 */

const config = require('../config');

/**
 * Ленивое чтение настроек доменов из БД (через settings).
 * Лениво — чтобы избежать циклических зависимостей и работы без БД в тестах.
 */
function getProxyDomains() {
    try {
        const { getAll } = require('../routes/settings');
        const s = getAll();
        return {
            web: s.web_domain || null,
            mtproto: s.mtproto_domain || null,
            mask: s.mask_domain || null,
        };
    } catch {
        // Без БД (тесты) или ошибка — используем общий domain
        return { web: null, mtproto: null, mask: null };
    }
}

/**
 * Fake TLS: к секрету добавляется домен маскировки в hex.
 * Формат по спецификации MTProto: ee + 16 байт секрета + домен (latin1) в hex.
 * Требования, без которых такая ссылка не заработает, проверяет
 * routes/mtproto.js (проверка домена), сюда попадают только прошедшие.
 *
 * @param {string} secret - 32 hex символа
 * @param {string} maskDomain - домен маскировки из настроек
 * @returns {string} секрет с префиксом ee
 */
function fakeTlsSecret(secret, maskDomain) {
    const domain = String(maskDomain || '').trim().toLowerCase();
    if (!domain) return null;
    if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain)) return null;
    return `ee${secret}${Buffer.from(domain, 'latin1').toString('hex')}`;
}

/**
 * Формирует ссылку Web Proxy для клиента.
 * Секрет оборачивается префиксом dd (secure-режим) — единственный
 * поддерживаемый в WEB-режиме наряду с plain.
 * @param {string} secret - 32 hex символа
 * @param {string} [domain] - явный домен Web Proxy; null/undefined = общий domain
 * @returns {string} tg:// ссылка
 */
function webProxyLink(secret, domain) {
    const d = domain ?? config.domain;
    return `tg://webproxy?server=${d}&secret=dd${secret}`;
}

/**
 * Формирует ссылку Web Proxy (HTTPS-вариант для отправки в мессенджерах).
 * @param {string} secret - 32 hex символа
 * @param {string} [domain] - явный домен Web Proxy
 * @returns {string} https://t.me/ ссылка
 */
function webProxyLinkHttps(secret, domain) {
    const d = domain ?? config.domain;
    return `https://t.me/webproxy?server=${d}&secret=dd${secret}`;
}

/**
 * Формирует MTProto-ссылку (Secure, dd-префикс).
 * dd работает без SNI-проверок и зависит только от порта — самый надёжный формат.
 * @param {string} secret - 32 hex символа
 * @param {string} [domain] - явный домен MTProto; null/undefined = общий domain
 * @returns {string} tg:// ссылка
 */
function mtprotoLink(secret, domain) {
    const d = domain ?? config.domain;
    return `tg://proxy?server=${d}&port=${config.mtprotoPort}&secret=dd${secret}`;
}

/**
 * Формирует MTProto-ссылку с Fake TLS (ee-префикс).
 * Трафик выглядит для оператора как обычный HTTPS к домену маскировки —
 * это то, что обходит схемное распознавание и душение трафика у мобильных
 * операторов. Требует, чтобы домен маскировки поддерживал TLS 1.3.
 * @param {string} secret - 32 hex символа
 * @param {string} maskDomain - домен маскировки (обязателен)
 * @param {string} [domain] - сервер из ссылки; null/undefined = общий домен
 * @returns {string|null} ссылка или null, если домен непригоден
 */
function mtprotoLinkFakeTls(secret, maskDomain, domain) {
    const s = fakeTlsSecret(secret, maskDomain);
    if (!s) return null;
    const d = domain ?? config.domain;
    return `tg://proxy?server=${d}&port=${config.mtprotoPort}&secret=${s}`;
}

/**
 * Формирует MTProto-ссылку с Fake TLS (HTTPS-вариант для отправки в мессенджерах).
 * @param {string} secret - 32 hex символа
 * @param {string} maskDomain - домен маскировки
 * @param {string} [domain] - сервер из ссылки
 * @returns {string|null}
 */
function mtprotoLinkFakeTlsHttps(secret, maskDomain, domain) {
    const s = fakeTlsSecret(secret, maskDomain);
    if (!s) return null;
    const d = domain ?? config.domain;
    return `https://t.me/proxy?server=${d}&port=${config.mtprotoPort}&secret=${s}`;
}

/**
 * Формирует MTProto-ссылку (HTTPS-вариант для отправки в мессенджерах).
 * @param {string} secret - 32 hex символа
 * @param {string} [domain] - явный домен MTProto
 * @returns {string} https://t.me/ ссылка
 */
function mtprotoLinkHttps(secret, domain) {
    const d = domain ?? config.domain;
    return `https://t.me/proxy?server=${d}&port=${config.mtprotoPort}&secret=dd${secret}`;
}

/**
 * Собирает все ссылки клиента с учётом настроенных доменов.
 * Для MTProto отдаются обе формы: dd (как раньше) и ee/Fake TLS.
 * @param {object} client - запись клиента из БД
 * @param {object} [opts] - { fakeTls: boolean, domainsOverride: { web, mtproto, mask } }
 * @returns {{web: string|null, mtproto: string|null, web_https: string|null,
 *            mtproto_https: string|null, mtproto_faketls: string|null,
 *            mtproto_faketls_https: string|null}}
 */
function clientLinks(client, opts = {}) {
    // Готовность Fake TLS берём из кэшированной проверки домена: пока она
    // не пройдена, ee-ссылки не выдаются — вместо них клиент получает dd.
    const fakeTls = opts.fakeTls ?? require('./mtprotoFaketls').isReady();
    const domains = opts.domainsOverride ?? getProxyDomains();
    const { web: webDomain, mtproto: mtprotoDomain, mask: maskDomain } = domains;

    return {
        web: client.web_enabled ? webProxyLink(client.secret, webDomain) : null,
        mtproto: client.mtproto_enabled ? mtprotoLink(client.secret, mtprotoDomain) : null,
        web_https: client.web_enabled ? webProxyLinkHttps(client.secret, webDomain) : null,
        mtproto_https: client.mtproto_enabled ? mtprotoLinkHttps(client.secret, mtprotoDomain) : null,
        // Fake TLS показывается только когда домен прошёл проверку (fakeTls=true)
        mtproto_faketls: client.mtproto_enabled && fakeTls
            ? mtprotoLinkFakeTls(client.secret, maskDomain, mtprotoDomain)
            : null,
        mtproto_faketls_https: client.mtproto_enabled && fakeTls
            ? mtprotoLinkFakeTlsHttps(client.secret, maskDomain, mtprotoDomain)
            : null,
    };
}

module.exports = {
    webProxyLink, mtprotoLink, webProxyLinkHttps, mtprotoLinkHttps,
    mtprotoLinkFakeTls, mtprotoLinkFakeTlsHttps, fakeTlsSecret, clientLinks,
};