/**
 * @fileoverview Сбор информации о версиях: панель, Telemt, последние релизы
 * с GitHub, срок SSL. Работает всегда (не зависит от cron и versions.json),
 * результаты кэшируются на 5 минут, чтобы не дёргать GitHub при каждом запросе.
 * @module services/versionInfo
 */

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const logger = require('../utils/logger');

const PANEL_REPO_API = 'https://api.github.com/repos/Therealwh/Web-Proxy-Telegram-Panel-TG-BOT/releases';
const TELEMT_REPO_API = 'https://api.github.com/repos/telemt/telemt/releases';
const VERSIONS_FILE = '/etc/tggate/versions.json';

const CACHE_TTL = 10 * 60 * 1000;        // свежий кэш: 10 минут
const STALE_TTL = 24 * 60 * 60 * 1000;   // устаревший кэш отдаём при сбоях GitHub

let cache = null;
let cacheTime = 0;

/**
 * Кэш списков релизов в БД (settings.gh_cache) — переживает рестарты
 * и спасает при исчерпании лимита GitHub API.
 */
function readDbCache() {
    try {
        const db = require('../db');
        const row = db.prepare('SELECT value FROM settings WHERE key = ?').get('gh_cache');
        return row ? JSON.parse(row.value) : null;
    } catch {
        return null;
    }
}

function writeDbCache(data) {
    try {
        const db = require('../db');
        db.prepare(
            'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
        ).run('gh_cache', JSON.stringify(data));
    } catch { /* кэш не критичен */ }
}

/** Текущая версия панели: файл VERSION в корне репозитория. */
function getPanelVersion() {
    try {
        const v = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'VERSION'), 'utf8').trim();
        return v || null;
    } catch {
        return null;
    }
}

/**
 * Версия Telemt из бинарника: `telemt --version`.
 * @returns {Promise<string|null>}
 */
function getTelemtVersion() {
    return new Promise((resolve) => {
        execFile('/usr/local/bin/telemt', ['--version'], { timeout: 5000 }, (err, stdout) => {
            if (err) return resolve(null);
            const m = String(stdout).match(/\d+\.\d+\.\d+/);
            resolve(m ? m[0] : null);
        });
    });
}

/**
 * Список последних релизов репозитория с GitHub.
 * При сбое/лимите — отдаём последний успешный кэш из БД (до 24 ч).
 */
async function getReleases(apiUrl, limit = 10) {
    const cacheKey = `releases:${apiUrl}`;

    // Кэш в БД свежее 10 минут — GitHub не дёргаем
    const cached = readDbCache()?.[cacheKey];
    if (cached && Date.now() - cached.ts < CACHE_TTL) {
        return cached.releases.slice(0, limit);
    }

    try {
        const res = await fetch(`${apiUrl}?per_page=20`, {
            headers: { 'User-Agent': 'TGGATE-Panel', Accept: 'application/vnd.github+json' },
            signal: AbortSignal.timeout(10000),
        });
        if (!res.ok) throw new Error(`GitHub HTTP ${res.status}`);
        const list = await res.json();
        const releases = (Array.isArray(list) ? list : []).map((r) => ({
            tag: String(r.tag_name || '').replace(/^v/, ''),
            raw: String(r.tag_name || ''),          // исходный тег (v1.0.6) — для git fetch
            prerelease: !!r.prerelease,
            date: r.published_at || null,
            notes: String(r.body || '').slice(0, 2000),
        }));

        // Сохраняем успешный ответ в БД-кэш
        const all = readDbCache() || {};
        all[cacheKey] = { ts: Date.now(), releases };
        writeDbCache(all);

        return releases.slice(0, limit);
    } catch (err) {
        // GitHub недоступен/лимит: отдаём устаревший кэш, если он есть
        if (cached && Date.now() - cached.ts < STALE_TTL) {
            logger.warn('GitHub API недоступен — отдаю кэш релизов', { error: err.message });
            return cached.releases.slice(0, limit);
        }
        logger.warn('GitHub API недоступен, кэша нет', { error: err.message });
        return [];
    }
}

/** Последний стабильный (не prerelease) релиз. */
async function getLatestRelease(apiUrl) {
    const releases = await getReleases(apiUrl, 20);
    return releases.find((r) => !r.prerelease) || releases[0] || null;
}

/**
 * Срок действия SSL-сертификата домена (openssl s_client).
 * @param {string} domain
 * @returns {Promise<{expires:string, daysLeft:number}|null>}
 */
function getSslExpiry(domain) {
    return new Promise((resolve) => {
        execFile('bash', ['-c',
            `echo | openssl s_client -servername ${domain} -connect ${domain}:443 2>/dev/null | openssl x509 -noout -enddate`],
        { timeout: 10000 }, (err, stdout) => {
            if (err) return resolve(null);
            const dateStr = String(stdout).split('=')[1]?.trim();
            if (!dateStr) return resolve(null);
            const expires = new Date(dateStr);
            if (Number.isNaN(expires.getTime())) return resolve(null);
            resolve({
                expires: expires.toISOString(),
                daysLeft: Math.round((expires - Date.now()) / 86400000),
            });
        });
    });
}

/**
 * Полный статус версий. versions.json (от cron) используется как дополнение,
 * но всё недостающее собирается на месте — страница обновлений всегда живая.
 * @returns {Promise<object>}
 */
async function getStatus() {
    const now = Date.now();
    if (cache && now - cacheTime < CACHE_TTL) return cache;

    const [panelLatest, telemtLatest, telemtCurrent, ssl] = await Promise.all([
        getLatestRelease(PANEL_REPO_API),
        getLatestRelease(TELEMT_REPO_API),
        getTelemtVersion(),
        getSslExpirySafe(),
    ]);

    // Панель текущая: из файла VERSION (реальный код на диске) — самый надёжный
    // источник; versions.json от cron — только фолбэк
    let panelCurrent = getPanelVersion();
    if (!panelCurrent) {
        try {
            const stored = JSON.parse(fs.readFileSync(VERSIONS_FILE, 'utf8'));
            panelCurrent = stored?.panel?.current || null;
        } catch { /* файла нет — не страшно */ }
    }

    const result = {
        panel: { current: panelCurrent, latest: panelLatest?.tag || null },
        telemt: { current: telemtCurrent, latest: telemtLatest?.tag || null },
        ssl,
        last_check: new Date().toISOString(),
    };

    cache = result;
    cacheTime = now;
    return result;
}

/** SSL с безопасным доменом (из .env). */
function getSslExpirySafe() {
    const config = require('../config');
    return getSslExpiry(config.domain);
}

/** Список релизов панели или Telemt. @param {'panel'|'telemt'} component */
async function getAvailableReleases(component) {
    const apiUrl = component === 'panel' ? PANEL_REPO_API : TELEMT_REPO_API;
    return getReleases(apiUrl, 10);
}

module.exports = { getStatus, getAvailableReleases, getPanelVersion };
