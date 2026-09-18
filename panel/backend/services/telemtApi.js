/**
 * @fileoverview Клиент Telemt Control API.
 * Инкапсулирует все запросы к API Telemt (http://127.0.0.1:9091).
 * Документация API: telemt/docs/Architecture/API/API.md
 * @module services/telemtApi
 */

const config = require('../config');
const logger = require('../utils/logger');

/**
 * Выполняет запрос к Telemt Control API.
 * @param {string} method - HTTP метод
 * @param {string} path - путь (например, /v1/users)
 * @param {object} [body] - тело запроса (JSON)
 * @returns {Promise<object>} поле data из конверта ответа API
 * @throws {Error} при сетевой ошибке или ошибке API
 */
async function apiRequest(method, path, body) {
    const url = `${config.telemt.apiUrl}${path}`;
    let response;
    try {
        response = await fetch(url, {
            method,
            headers: {
                Authorization: config.telemt.apiAuth,
                'Content-Type': 'application/json',
            },
            body: body !== undefined ? JSON.stringify(body) : undefined,
            signal: AbortSignal.timeout(10000), // таймаут 10 секунд
        });
    } catch (err) {
        logger.error('Telemt API недоступен', { url, error: err.message });
        throw new Error('Сервис прокси (Telemt) недоступен. Проверьте: systemctl status telemt');
    }

    let json;
    try {
        json = await response.json();
    } catch {
        throw new Error(`Telemt API вернул некорректный ответ (HTTP ${response.status})`);
    }

    if (!response.ok) {
        const apiError = json?.error?.message || json?.error || `HTTP ${response.status}`;
        throw new Error(`Ошибка Telemt API: ${apiError}`);
    }

    // Успешный конверт API: { ok: true, data: ... }
    return json.data !== undefined ? json.data : json;
}

// ---------------------------------------------------------------------------
// Пользователи (clients Telemt)
// ---------------------------------------------------------------------------

/** Получить список всех пользователей Telemt. @returns {Promise<Array>} */
const listUsers = () => apiRequest('GET', '/v1/users');

/**
 * Создать пользователя Telemt.
 * @param {object} data - поля CreateUserRequest (username, secret?, user_ad_tag?,
 *   max_tcp_conns?, expiration_rfc3339?, data_quota_bytes?,
 *   rate_limit_up_bps?, rate_limit_down_bps?, max_unique_ips?, enabled?)
 * @returns {Promise<object>} CreateUserResponse (включая сгенерированный secret)
 */
const createUser = (data) => apiRequest('POST', '/v1/users', data);

/** Получить пользователя по имени. @param {string} username */
const getUser = (username) => apiRequest('GET', `/v1/users/${encodeURIComponent(username)}`);

/** Обновить пользователя (PATCH-семантика, null — снять настройку). */
const patchUser = (username, data) =>
    apiRequest('PATCH', `/v1/users/${encodeURIComponent(username)}`, data);

/** Удалить пользователя. */
const deleteUser = (username) =>
    apiRequest('DELETE', `/v1/users/${encodeURIComponent(username)}`);

/** Включить пользователя. */
const enableUser = (username) =>
    apiRequest('POST', `/v1/users/${encodeURIComponent(username)}/enable`);

/** Отключить пользователя (сессии завершаются немедленно). */
const disableUser = (username) =>
    apiRequest('POST', `/v1/users/${encodeURIComponent(username)}/disable`);

/** Перегенерировать секрет пользователя. @returns {Promise<object>} новый секрет */
const rotateSecret = (username) =>
    apiRequest('POST', `/v1/users/${encodeURIComponent(username)}/rotate-secret`, {});

/** Сбросить счётчик квоты трафика. */
const resetQuota = (username) =>
    apiRequest('POST', `/v1/users/${encodeURIComponent(username)}/reset-quota`);

// ---------------------------------------------------------------------------
// Статистика и мониторинг
// ---------------------------------------------------------------------------

/** Сводные счётчики ядра. */
const getStatsSummary = () => apiRequest('GET', '/v1/stats/summary');

/** Статистика по пользователям (алиас /v1/users с рантайм-данными). */
const getUsersStats = () => apiRequest('GET', '/v1/stats/users');

/** Активные IP пользователей. */
const getUsersActiveIps = () => apiRequest('GET', '/v1/stats/users/active-ips');

/** Сводка по соединениям (top-N по трафику). */
const getConnectionsSummary = () => apiRequest('GET', '/v1/runtime/connections/summary');

/** Недавние события рантайма (для живых логов). @param {number} [limit=100] */
const getRecentEvents = (limit = 100) =>
    apiRequest('GET', `/v1/runtime/events/recent?limit=${limit}`);

// ---------------------------------------------------------------------------
// Система и конфигурация
// ---------------------------------------------------------------------------

/** Проверка живости API. */
const getHealth = () => apiRequest('GET', '/v1/health');

/** Информация о бинарнике: версия, аптайм, хэш конфига. */
const getSystemInfo = () => apiRequest('GET', '/v1/system/info');

/** Текущая конфигурация (без access.*) + revision. */
const getConfig = () => apiRequest('GET', '/v1/config');

/**
 * Применить sparse-патч конфигурации.
 * @param {object} patch - частичный объект конфигурации
 * @param {boolean} [reload=true] - сразу применить через runtime reload
 */
const patchConfig = (patch, reload = true) =>
    apiRequest('PATCH', `/v1/config${reload ? '?reload=true' : ''}`, patch);

/**
 * Перезагрузить конфигурацию рантайма (drain с откатом при ошибке).
 * @returns {Promise<object>} ReloadAccepted (с reload_id)
 */
const reload = () =>
    apiRequest('POST', '/v1/system/reload', {
        mode: 'drain',
        timeout_secs: 30,
        failure_policy: 'rollback',
    });

/** Статус операции reload. @param {string} reloadId */
const getReloadStatus = (reloadId) =>
    apiRequest('GET', `/v1/system/reload/${encodeURIComponent(reloadId)}`);

// ---------------------------------------------------------------------------
// WEB-прокси: статус и сессии (Pulse-диагностика)
// ---------------------------------------------------------------------------

/** Статус WEB-рантайма (lifecycle, capacity, counters). */
const getWebStatus = () => apiRequest('GET', '/v1/runtime/web/status');

/** Список активных WEB-сессий. @param {object} [query] фильтры */
const getWebSessions = (query = {}) => {
    const params = new URLSearchParams(query).toString();
    return apiRequest('GET', `/v1/runtime/web/sessions${params ? '?' + params : ''}`);
};

/** Закрыть WEB-сессии по фильтру. @param {object} selector CloseRequest */
const closeWebSessions = (selector) =>
    apiRequest('POST', '/v1/runtime/web/sessions/close', selector);

module.exports = {
    apiRequest,
    listUsers, createUser, getUser, patchUser, deleteUser,
    enableUser, disableUser, rotateSecret, resetQuota,
    getStatsSummary, getUsersStats, getUsersActiveIps,
    getConnectionsSummary, getRecentEvents,
    getHealth, getSystemInfo, getConfig, patchConfig, reload, getReloadStatus,
    getWebStatus, getWebSessions, closeWebSessions,
};
