/**
 * Синхронизация WEB-профилей Telemt с клиентами панели.
 *
 * Telemt требует: у каждого vhost должен быть хотя бы один [[web.vhosts.profiles]],
 * причём user профиля должен существовать в [access.users]. Создание пользователя
 * через /v1/users НЕ создаёт WEB-профиль — панель управляет профилями сама
 * через PATCH /v1/config (arrays заменяются целиком).
 *
 * Профиль "welcome" — служебный, всегда остаётся первым (fallback на случай
 * пустого списка, чтобы reload не падал на валидации).
 *
 * Лимит: Telemt отклоняет конфиг, когда профилей больше web.limits.max_profiles.
 * Панель хранит лимит в settings (web_max_profiles) и перед синхронизацией
 * применяет его в конфиг движка — иначе после превышения начинались
 * минутные ошибки «WEB profiles exceed web.limits.max_profiles».
 * @module services/webProfiles
 */

const db = require('../db');
const telemt = require('./telemtApi');
const config = require('../config');
const logger = require('../utils/logger');

/** Служебный профиль-заглушка (всегда первый в списке). */
const WELCOME_PROFILE = {
    user: 'welcome',
    secret_mode: 'dd',
    max_sessions: 1,
    max_streams: 8,
    max_streams_per_session: 8,
};

/** Лимиты профиля клиента по умолчанию. */
const CLIENT_PROFILE_DEFAULTS = {
    secret_mode: 'dd',
    max_sessions: 8,
    max_streams: 512,
    max_streams_per_session: 64,
};

/** Лимит профилей по умолчанию в движке. */
const DEFAULT_LIMIT = 32;

/** Кэш последнего применённого списка, чтобы не слать лишние PATCH. */
let lastSyncedJson = null;

/** Сохранённый в панели лимит профилей (или дефолт движка). */
function configuredLimit() {
    try {
        const row = db.prepare('SELECT value FROM settings WHERE key = ?').get('web_max_profiles');
        const v = row ? Number(JSON.parse(row.value)) : NaN;
        return Number.isInteger(v) && v > 0 ? v : DEFAULT_LIMIT;
    } catch {
        return DEFAULT_LIMIT;
    }
}

/**
 * Синхронизирует WEB-профили Telemt со списком клиентов панели
 * (все клиенты с включённым Web Proxy). Не бросает исключений наружу —
 * ошибки логируются: клиент продолжит работать по MTProto.
 */
async function syncWebProfiles(excludeUsername = null) {
    try {
        // Клиенты с включённым Web Proxy
        const users = db.prepare(
            'SELECT username FROM clients WHERE web_enabled = 1 AND username != ? ORDER BY id'
        ).all(excludeUsername || '').map((r) => r.username);

        // Лимит из настроек панели: применяем в движок, если отличается
        const limit = configuredLimit();
        let currentLimit = null;
        const cfg = await telemt.getConfig();
        const vhosts = cfg?.web?.vhosts;
        if (!Array.isArray(vhosts) || vhosts.length === 0) {
            logger.warn('WEB: в конфиге Telemt нет vhosts — профили не синхронизированы');
            return;
        }
        const idx = vhosts.findIndex((v) => v.host === config.domain);
        const target = idx >= 0 ? idx : 0;
        currentLimit = cfg?.web?.limits?.max_profiles;

        // Наш vhost по домену (или первый)
        const profiles = vhosts[target].profiles || [];
        const cap = Math.max(1, limit - 1); // минус служебный welcome
        const trimmedUsers = users.slice(0, cap);

        const wanted = [
            WELCOME_PROFILE,
            ...trimmedUsers.map((u) => ({ user: u, ...CLIENT_PROFILE_DEFAULTS })),
        ];

        if (users.length > trimmedUsers.length) {
            logger.warn('WEB: клиентов с Web Proxy больше лимита — лишние остались без WEB-профиля', {
                limit, clients: users.length, skipped: users.length - trimmedUsers.length,
            });
        }

        // Лимит меняем только когда он отличается: лишний PATCH = reload
        if (Number.isInteger(currentLimit) && currentLimit !== limit) {
            try {
                await telemt.patchConfig({ web: { limits: { max_profiles: limit } } });
                logger.info('WEB: лимит профилей применён в движок', { limit });
            } catch (e) {
                logger.warn('WEB: не удалось применить лимит профилей', { limit, error: e.message });
            }
        }

        // Сравниваем без лишних PATCH
        const currentJson = JSON.stringify(profiles);
        const wantedJson = JSON.stringify(wanted);
        if (currentJson === wantedJson) return;

        vhosts[target].profiles = wanted;
        await telemt.patchConfig({ web: { vhosts } });
        lastSyncedJson = wantedJson;
        logger.info('WEB-профили синхронизированы', { profiles: wanted.length, limit });
    } catch (err) {
        logger.warn('Не удалось синхронизировать WEB-профили', { error: err.message });
    }
}

/** Сброс кэша (например, после ручной правки конфига). */
function invalidateCache() {
    lastSyncedJson = null;
}

module.exports = { syncWebProfiles, invalidateCache, configuredLimit, DEFAULT_LIMIT };