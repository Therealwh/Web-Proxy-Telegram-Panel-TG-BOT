/**
 * @fileoverview Генерация ссылок подключения для клиентов.
 * Web Proxy: tg://webproxy?server=DOMAIN&secret=dd<16hex>
 * MTProto:   tg://proxy?server=DOMAIN&port=8443&secret=ee<secret><tls_domain_hex>
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
        };
    } catch {
        // Без БД (тесты) или ошибка — используем общий domain
        return { web: null, mtproto: null };
    }
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
 * @param {object} client - запись клиента из БД
 * @param {string} _maskDomain - зарезервировано (для ee-ссылок)
 * @param {object} [domainsOverride] - явное переопределение { web, mtproto } (для тестов)
 * @returns {{web: string|null, mtproto: string|null, web_https: string|null, mtproto_https: string|null}}
 */
function clientLinks(client, _maskDomain, domainsOverride) {
    const { web: webDomain, mtproto: mtprotoDomain } = domainsOverride ?? getProxyDomains();
    return {
        web: client.web_enabled ? webProxyLink(client.secret, webDomain) : null,
        mtproto: client.mtproto_enabled ? mtprotoLink(client.secret, mtprotoDomain) : null,
        web_https: client.web_enabled ? webProxyLinkHttps(client.secret, webDomain) : null,
        mtproto_https: client.mtproto_enabled ? mtprotoLinkHttps(client.secret, mtprotoDomain) : null,
    };
}

module.exports = { webProxyLink, mtprotoLink, webProxyLinkHttps, mtprotoLinkHttps, clientLinks };