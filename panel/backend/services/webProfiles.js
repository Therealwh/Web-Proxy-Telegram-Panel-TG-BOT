/**
 * @fileoverview Синхронизация WEB-профилей Telemt с клиентами панели.
 *
 * Telemt требует: у каждого vhost должен быть хотя бы один [[web.vhosts.profiles]],
 * причём user профиля должен существовать в [access.users]. Создание пользователя
 * через /v1/users НЕ создаёт WEB-профиль — панель управляет профилями сама
 * через PATCH /v1/config (arrays заменяются целиком).
 *
 * Профиль "welcome" — служебный, всегда остаётся первым (fallback на случай
 * пустого списка, чтобы reload не падал на валидации).
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

/** Кэш последнего применённого списка, чтобы не слать лишние PATCH. */
let lastSyncedJson = null;

/**
 * Синхронизирует WEB-профили Telemt со списком клиентов панели
 * (все клиенты с включённым Web Proxy). Не бросает исключений наружу —
 * ошибки логируются: клиент продолжит работать по MTProto.
 */
async function syncWebProfiles() {
    try {
        // Клиенты с включённым Web Proxy
        const users = db.prepare(
            'SELECT username FROM clients WHERE web_enabled = 1 ORDER BY id'
        ).all().map((r) => r.username);

        const wanted = [
            WELCOME_PROFILE,
            ...users.map((u) => ({ user: u, ...CLIENT_PROFILE_DEFAULTS })),
        ];

        // Текущая конфигурация Telemt
        const cfg = await telemt.getConfig();
        const vhosts = cfg?.web?.vhosts;
        if (!Array.isArray(vhosts) || vhosts.length === 0) {
            logger.warn('WEB: в конфиге Telemt нет vhosts — профили не синхронизированы');
            return;
        }

        // Наш vhost по домену (или первый)
        const idx = vhosts.findIndex((v) => v.host === config.domain);
        const target = idx >= 0 ? idx : 0;

        // Сравниваем без лишних PATCH
        const currentJson = JSON.stringify(vhosts[target].profiles || []);
        const wantedJson = JSON.stringify(wanted);
        if (currentJson === wantedJson) return;

        vhosts[target].profiles = wanted;
        await telemt.patchConfig({ web: { vhosts } });
        lastSyncedJson = wantedJson;
        logger.info('WEB-профили синхронизированы', { profiles: wanted.length });
    } catch (err) {
        logger.warn('Не удалось синхронизировать WEB-профили', { error: err.message });
    }
}

/** Сброс кэша (например, после ручной правки конфига). */
function invalidateCache() {
    lastSyncedJson = null;
}

module.exports = { syncWebProfiles, invalidateCache };
