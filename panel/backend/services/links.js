/**
 * @fileoverview Генерация ссылок подключения для клиентов.
 * Web Proxy: tg://webproxy?server=DOMAIN&secret=dd<16hex>
 * MTProto:   tg://proxy?server=DOMAIN&port=8443&secret=ee<secret><tls_domain_hex>
 * @module services/links
 */

const config = require('../config');

/**
 * Формирует ссылку Web Proxy для клиента.
 * Секрет оборачивается префиксом dd (secure-режим) — единственный
 * поддерживаемый в WEB-режиме наряду с plain.
 * @param {string} secret - 32 hex символа
 * @returns {string} tg:// ссылка
 */
function webProxyLink(secret) {
    return `tg://webproxy?server=${config.domain}&secret=dd${secret}`;
}

/**
 * Формирует MTProto-ссылку (Fake TLS, ee-префикс).
 * @param {string} secret - 32 hex символа
 * @param {string} maskDomain - домен маскировки TLS (hex в конце ссылки)
 * @returns {string} tg:// ссылка
 */
function mtprotoLink(secret, maskDomain) {
    const domainHex = Buffer.from(maskDomain, 'utf8').toString('hex');
    return `tg://proxy?server=${config.domain}&port=${config.mtprotoPort}&secret=ee${secret}${domainHex}`;
}

/**
 * HTTPS-варианты ссылок (для отправки в мессенджеры).
 */
function webProxyLinkHttps(secret) {
    return `https://t.me/webproxy?server=${config.domain}&secret=dd${secret}`;
}

function mtprotoLinkHttps(secret, maskDomain) {
    const domainHex = Buffer.from(maskDomain, 'utf8').toString('hex');
    return `https://t.me/proxy?server=${config.domain}&port=${config.mtprotoPort}&secret=ee${secret}${domainHex}`;
}

/**
 * Собирает все ссылки клиента с учётом включённых протоколов.
 * @param {object} client - запись клиента из БД
 * @param {string} maskDomain - домен маскировки из настроек
 * @returns {{web: string|null, mtproto: string|null}}
 */
function clientLinks(client, maskDomain) {
    return {
        web: client.web_enabled ? webProxyLink(client.secret) : null,
        mtproto: client.mtproto_enabled ? mtprotoLink(client.secret, maskDomain) : null,
        web_https: client.web_enabled ? webProxyLinkHttps(client.secret) : null,
        mtproto_https: client.mtproto_enabled ? mtprotoLinkHttps(client.secret, maskDomain) : null,
    };
}

module.exports = { webProxyLink, mtprotoLink, webProxyLinkHttps, mtprotoLinkHttps, clientLinks };
