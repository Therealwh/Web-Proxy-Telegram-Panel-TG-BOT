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
const nodes = require('./nodes');
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

/** Лимиты профиля клиента по умолчанию.
 *  Подняты под публичные бесплатные профили: 128 одновременных сессий
 *  ≈ 100+ устройств в моменте. Платным клиентам тоже достаточно —
 *  реальную нагрузку ограничивает трафик, а не счётчик сессий. */
const CLIENT_PROFILE_DEFAULTS = {
    secret_mode: 'dd',
    max_sessions: 1000,
    max_streams: 16384,
    max_streams_per_session: 128,
};

/** Лимит профилей по умолчанию в движке (запас для продаж). */
const DEFAULT_LIMIT = 1024;

/** Тюнинг web.limits движка: панель патчит ВЕСЬ блок web.limits целиком
 *  (Telemt на частичный патч отвечает полной заменой блока на дефолты),
 *  поэтому продакшн-значения держатся здесь и уходят в движок одним патчем.
 *  Без этого каждое применение max_profiles затирает остальные лимиты. */
const WEB_LIMITS_TUNED = {
    max_sessions_global: 2048,
    max_http_connections: 4096,
    max_streams_global: 16384,
    max_bootstraps_global: 2048,
    max_http_overload_connections: 256,
    control_bytes_global: 268435456,
    pending_items_global: 1048576,
    pending_bytes_global: 402653184,
    max_tombstones_per_session: 128,
    max_header_bytes: 8192,
    max_body_bytes: 1048576,
    max_frame_payload_bytes: 524288,
    carrier_batch_bytes: 1048576,
    max_body_bytes_global: 33554432,
    websocket_bytes_global: 100663296,
    http_connection_capacity_action: 'wait',
};

/** Кэш последнего применённого списка, чтобы не слать лишние PATCH. */
let lastSyncedJson = null;
/** Пер-узловой кэш: узел (id) → JSON последнего применённого списка. */
const lastSyncedByNode = new Map();

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
    // Синхронизируем локальный движок и каждый включённый узел:
    // у узла свой конфиг, свой vhost (по домену узла) и свои клиенты.
    const targets = [{ id: null, api: telemt, host: config.domain }];
    for (const nd of nodes.listNodes({ enabledOnly: true })) {
        targets.push({ id: nd.id, api: nodes.getApiForNodeId(nd.id), host: nd.domain, nodeName: nd.name });
    }
    for (const t of targets) {
        await syncNodeProfiles(t, excludeUsername);
    }
}

/** Синхронизация профилей одного узла. */
async function syncNodeProfiles({ id, api, host, nodeName }, excludeUsername = null) {
    const label = nodeName ? `узел ${nodeName}` : 'локальный движок';
    try {
        // Клиенты узла с включённым Web Proxy (+ пер-клиентские лимиты, NULL = дефолт)
        const clients = db.prepare(
            `SELECT username, max_sessions, max_streams, max_streams_per_session
             FROM clients WHERE web_enabled = 1 AND username != ? AND node_id ${id ? '= ?' : 'IS NULL'} ORDER BY id`
        ).all(...(id ? [excludeUsername || '', id] : [excludeUsername || '']));

        // Лимит из настроек панели: применяем в движок, если отличается
        const limit = configuredLimit();
        let currentLimit = null;
        const cfg = await api.getConfig();
        const vhosts = cfg?.web?.vhosts;
        if (!Array.isArray(vhosts) || vhosts.length === 0) {
            logger.warn(`WEB (${label}): в конфиге Telemt нет vhosts — профили не синхронизированы`);
            return;
        }
        const idx = vhosts.findIndex((v) => v.host === host);
        const target = idx >= 0 ? idx : 0;
        currentLimit = cfg?.web?.limits?.max_profiles;

        // Наш vhost по домену (или первый)
        const profiles = vhosts[target].profiles || [];
        const cap = Math.max(1, limit - 1); // минус служебный welcome
        const trimmedClients = clients.slice(0, cap);

        // Пер-клиентские лимиты: NULL (не задано) = значения по умолчанию
        const wanted = [
            WELCOME_PROFILE,
            ...trimmedClients.map((c) => ({
                user: c.username,
                secret_mode: CLIENT_PROFILE_DEFAULTS.secret_mode,
                max_sessions: c.max_sessions ?? CLIENT_PROFILE_DEFAULTS.max_sessions,
                max_streams: c.max_streams ?? CLIENT_PROFILE_DEFAULTS.max_streams,
                max_streams_per_session: c.max_streams_per_session ?? CLIENT_PROFILE_DEFAULTS.max_streams_per_session,
            })),
        ];

        if (clients.length > trimmedClients.length) {
            logger.warn('WEB: клиентов с Web Proxy больше лимита — лишние остались без WEB-профиля', {
                limit, clients: clients.length, skipped: clients.length - trimmedClients.length,
            });
        }

        // Лимит меняем только когда он отличается: лишний PATCH = reload
        if (Number.isInteger(currentLimit) && currentLimit !== limit) {
            try {
                await api.patchConfig({
        web: { limits: { ...WEB_LIMITS_TUNED, max_profiles: limit } },
    }, false);
                logger.info(`WEB (${label}): лимит профилей применён в движок`, { limit });
            } catch (e) {
                logger.warn(`WEB (${label}): не удалось применить лимит профилей`, { limit, error: e.message });
            }
        }

        // Сравниваем без лишних PATCH (кэш пер-узловой)
        const currentJson = JSON.stringify(profiles);
        const wantedJson = JSON.stringify(wanted);
        if (currentJson === wantedJson) return;

        vhosts[target].profiles = wanted;
        await api.patchConfig({ web: { vhosts } });
        lastSyncedByNode.set(id ?? 'l', wantedJson);
        logger.info(`WEB-профили синхронизированы (${label})`, { profiles: wanted.length, limit });
    } catch (err) {
        logger.warn(`Не удалось синхронизировать WEB-профили (${label})`, { error: err.message });
    }
}

/** Сброс кэша (например, после ручной правки конфига). */
function invalidateCache() {
    lastSyncedJson = null;
    lastSyncedByNode.clear();
}

module.exports = { syncWebProfiles, invalidateCache, configuredLimit, DEFAULT_LIMIT, WEB_LIMITS_TUNED };