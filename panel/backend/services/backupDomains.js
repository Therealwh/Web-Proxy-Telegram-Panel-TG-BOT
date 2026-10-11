/**
 * @fileoverview Запасные домены для Web Proxy.
 *
 * Схема простая: все домены работают на одном IP и одном секрете клиента.
 * Если основной домен заблокируют, клиент переключается на резервный —
 * Telegram хранит у клиента несколько прокси, и это самый дешёвый обход
 * блокировки по конкретному имени.
 *
 * Ограничения движка, которые нельзя игнорировать:
 *   - максимум 8 vhost (`web.limits.max_vhosts`), и каждый требует свой decoy
 *     и свои профили — иначе движок не стартует;
 *   - максимум 32 профиля на ВСЕ vhost'ы (`web.limits.max_profiles`).
 *     То есть добавление второго домена удваивает число профилей. При
 *     десятках клиентов штатный лимит переполняется, и поднимать его
 *     приходится в `web.limits`, а это уже требует перезапуска.
 *
 * Из-за этого домены хранятся в панели (настройка backup_domains), а
 * профили пересобираются и раскладываются по всем vhost'ам сразу —
 * иначе клиент потеряет доступ на резервном домене.
 * @module services/backupDomains
 */

const db = require('../db');
const telemt = require('./telemtApi');
const config = require('../config');
const logger = require('../utils/logger');

/** Жёсткие пределы движка. */
const MAX_DOMAINS = 8;        // web.limits.max_vhosts

/** Настройка, в которой панель хранит список резервных доменов. */
const SETTINGS_KEY = 'backup_domains';

const DOMAIN_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;

/** Убирает дубликаты, основной домен и мусор. */
function normalize(list, primary) {
    const arr = Array.isArray(list) ? list : [];
    const out = [];
    for (const raw of arr) {
        const d = String(raw || '').trim().toLowerCase();
        if (!d || !DOMAIN_RE.test(d)) continue;
        if (d === primary) continue;      // основной домен и так есть
        if (out.includes(d)) continue;
        out.push(d);
    }
    return out.slice(0, MAX_DOMAINS - 1); // основной занимает один из 8
}

/** Текущее состояние: основной, резервные и прогноз по лимитам. */
function getState() {
    let stored = [];
    try {
        const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(SETTINGS_KEY);
        if (row) stored = JSON.parse(row.value);
    } catch { /* настройка ещё не задана */ }

    const backups = normalize(stored, config.domain);
    const profiles = estimateProfiles();

    return {
        primary: config.domain,
        backups,
        maxDomains: MAX_DOMAINS,
        // Предупреждение видно до применения, а не после отказа движка
        profilesEstimate: profiles.total,
        maxProfiles: 32,
        exceedsProfiles: profiles.total > 32,
        domainsAfterAdd: profiles.domainsAfterAdd,
    };
}

/**
 * Считает, сколько профилей (клиентов) нужно разложить по доменам.
 * Профиль создаётся на КАЖДЫЙ vhost, поэтому с добавлением домена
 * количество профилей растёт линейно.
 */
function estimateProfiles() {
    let clients = 0;
    try {
        const row = db.prepare('SELECT COUNT(*) AS c FROM clients WHERE web_enabled = 1').get();
        clients = row?.c ?? 0;
    } catch { /* таблицы может не быть */ }

    let stored = [];
    try {
        const r = db.prepare('SELECT value FROM settings WHERE key = ?').get(SETTINGS_KEY);
        if (r) stored = JSON.parse(r.value);
    } catch { /* ignore */ }

    const backups = normalize(stored, config.domain);
    const current = 1 + backups.length;          // сколько доменов сейчас
    // Плюс служебный профиль welcome на каждом домене
    const total = (clients + 1) * current;
    return {
        clients,
        domains: current,
        total,
        domainsAfterAdd: current + 1,
        totalAfterAdd: (clients + 1) * (current + 1),
    };
}

/** Сохраняет список в настройках. */
function save(list) {
    db.prepare(
        'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
    ).run(SETTINGS_KEY, JSON.stringify(list));
}

/**
 * Применяет резервные домены: добавляет vhost'ы в Telemt и раскладывает
 * по ним профили клиентов.
 *
 * Сертификаты для новых доменов должен выпустить Caddy — если A-записи
 * ещё не указывают на сервер, Let's Encrypt не выдаст сертификат, и клиент
 * не сможет подключиться по HTTPS. Поэтому перед применением проверяем,
 * что домен уже резолвится в наш IP.
 *
 * @param {string[]} list - резервные домены
 * @returns {Promise<{ok: boolean, domains?: string[], error?: string, warning?: string}>}
 */
async function apply(list) {
    const backups = normalize(list, config.domain);
    if (backups.length === 0) {
        return removeAll();
    }

    // Проверяем DNS: домен без сертификата бесполезен и только вводит в заблуждение
    const dns = require('dns').promises;
    const bad = [];
    for (const d of backups) {
        try {
            const ips = await dns.lookup(d, { all: true });
            if (!ips.some((i) => i.address === config.serverIp)) bad.push(d);
        } catch {
            bad.push(d);
        }
    }
    if (bad.length > 0) {
        return {
            ok: false,
            error: `Домены ещё не указывают на IP этого сервера (${config.serverIp}): ${bad.join(', ')}. Обновите A-записи и повторите.`,
        };
    }

    try {
        const cfg = await telemt.getConfig();
        const vhosts = Array.isArray(cfg?.web?.vhosts) ? cfg.web.vhosts : [];
        const primary = vhosts.find((v) => v.host === config.domain) || vhosts[0];
        if (!primary) return { ok: false, error: 'В конфиге Telemt нет ни одного vhost' };

        // Копия основного vhost со сменой host — сохраняем decoy и лимиты
        const wanted = [config.domain, ...backups].map((host) =>
            host === config.domain ? primary : { ...structuredClone(primary), host });

        await telemt.patchConfig({ web: { vhosts: wanted } });

        // Профили должны быть на каждом домене, иначе клиент не подключится
        await require('./webProfiles').syncWebProfiles();

        save(backups);
        logger.info('Резервные домены применены', { domains: backups });
        return { ok: true, domains: backups };
    } catch (err) {
        logger.error('Не удалось применить резервные домены', { error: err.message });
        return { ok: false, error: err.message };
    }
}

/** Убирает резервные домены, оставляя только основной. */
async function removeAll() {
    try {
        const cfg = await telemt.getConfig();
        const vhosts = (Array.isArray(cfg?.web?.vhosts) ? cfg.web.vhosts : [])
            .filter((v) => v.host === config.domain);
        if (vhosts.length === 0) {
            save([]);
            return { ok: true, domains: [] };
        }
        await telemt.patchConfig({ web: { vhosts } });
        await require('./webProfiles').syncWebProfiles();
        save([]);
        logger.info('Резервные домены удалены');
        return { ok: true, domains: [] };
    } catch (err) {
        logger.error('Не удалось удалить резервные домены', { error: err.message });
        return { ok: false, error: err.message };
    }
}

module.exports = { MAX_DOMAINS, normalize, getState, estimateProfiles, apply, removeAll };