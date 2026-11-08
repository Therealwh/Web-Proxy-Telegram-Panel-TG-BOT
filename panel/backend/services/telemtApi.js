/**
 * @fileoverview Клиент Telemt Control API.
 * Инкапсулирует все запросы к API Telemt (http://127.0.0.1:9091).
 * Документация API: telemt/docs/Architecture/API/API.md
 *
 * Мульти-сервер: createTelemtClient({ apiUrl, apiAuth }) создаёт клиент
 * для любого узла; экспорт модуля — клиент ЛОКАЛЬНОГО движка главной панели,
 * поэтому все существующие вызовы telemt.X работают без изменений.
 * @module services/telemtApi
 */

const config = require('../config');
const logger = require('../utils/logger');

/**
 * Фабрика клиентов Telemt Control API.
 * @param {{apiUrl: string, apiAuth: string}} opts
 */
function createTelemtClient({ apiUrl, apiAuth }) {
    /**
     * Выполняет запрос к Telemt Control API.
     * @param {string} method - HTTP метод
     * @param {string} path - путь (например, /v1/users)
     * @param {object} [body] - тело запроса (JSON)
     * @returns {Promise<object>} поле data из конверта ответа API
     * @throws {Error} при сетевой ошибке или ошибке API
     */
    async function apiRequest(method, path, body) {
        const url = `${apiUrl}${path}`;
        let response;
        try {
            response = await fetch(url, {
                method,
                headers: {
                    Authorization: apiAuth,
                    'Content-Type': 'application/json',
                },
                body: body !== undefined ? JSON.stringify(body) : undefined,
                signal: AbortSignal.timeout(10000), // таймаут 10 секунд
            });
        } catch (err) {
            logger.error('Telemt API недоступен', { url, error: err.message });
            const e = new Error('Сервис прокси (Telemt) недоступен. Проверьте: systemctl status telemt');
            e.statusCode = 502;
            throw e;
        }

        let json;
        try {
            json = await response.json();
        } catch {
            const e = new Error(`Telemt API вернул некорректный ответ (HTTP ${response.status})`);
            e.statusCode = 502;
            throw e;
        }

        if (!response.ok) {
            const apiError = json?.error?.message || json?.error || `HTTP ${response.status}`;
            const e = new Error(`Ошибка Telemt API: ${apiError}`);
            // 404 пробрасываем как есть, остальные ошибки Telemt — 502 Bad Gateway
            e.statusCode = response.status === 404 ? 404 : 502;
            throw e;
        }

        // Успешный конверт API: { ok: true, data: ... }
        return json.data !== undefined ? json.data : json;
    }

    return {
        apiRequest,
        // Пользователи
        listUsers: () => apiRequest('GET', '/v1/users'),
        createUser: (data) => apiRequest('POST', '/v1/users', data),
        getUser: (username) => apiRequest('GET', `/v1/users/${encodeURIComponent(username)}`),
        patchUser: (username, data) =>
            apiRequest('PATCH', `/v1/users/${encodeURIComponent(username)}`, data),
        deleteUser: (username) =>
            apiRequest('DELETE', `/v1/users/${encodeURIComponent(username)}`),
        enableUser: (username) =>
            apiRequest('POST', `/v1/users/${encodeURIComponent(username)}/enable`),
        disableUser: (username) =>
            apiRequest('POST', `/v1/users/${encodeURIComponent(username)}/disable`),
        rotateSecret: (username) =>
            apiRequest('POST', `/v1/users/${encodeURIComponent(username)}/rotate-secret`, {}),
        resetQuota: (username) =>
            apiRequest('POST', `/v1/users/${encodeURIComponent(username)}/reset-quota`),
        // Статистика и мониторинг
        getStatsSummary: () => apiRequest('GET', '/v1/stats/summary'),
        getStatsDcs: () => apiRequest('GET', '/v1/stats/dcs'),
        getMeQuality: () => apiRequest('GET', '/v1/runtime/me_quality'),
        getRuntimeGates: () => apiRequest('GET', '/v1/runtime/gates'),
        getMePoolState: () => apiRequest('GET', '/v1/runtime/me_pool_state'),
        getNatStun: () => apiRequest('GET', '/v1/runtime/nat_stun'),
        getMeSelftest: () => apiRequest('GET', '/v1/runtime/me-selftest'),
        getUpstreams: () => apiRequest('GET', '/v1/stats/upstreams'),
        getHealthReady: () => apiRequest('GET', '/v1/health/ready'),
        getTlsFingerprints: (limit = 1000) =>
            apiRequest('GET', `/v1/runtime/tls-fingerprints?limit=${limit}`),
        getUsersStats: () => apiRequest('GET', '/v1/stats/users'),
        getUsersActiveIps: () => apiRequest('GET', '/v1/stats/users/active-ips'),
        getConnectionsSummary: () => apiRequest('GET', '/v1/runtime/connections/summary'),
        getRecentEvents: (limit = 100) =>
            apiRequest('GET', `/v1/runtime/events/recent?limit=${limit}`),
        // Система и конфигурация
        getHealth: () => apiRequest('GET', '/v1/health'),
        getSystemInfo: () => apiRequest('GET', '/v1/system/info'),
        getConfig: () => apiRequest('GET', '/v1/config'),
        patchConfig: (patch, reload = 'instant') =>
            apiRequest('PATCH', `/v1/config${reload ? `?reload=${reload}` : ''}`, patch),
        reload: () =>
            apiRequest('POST', '/v1/system/reload', {
                mode: 'drain',
                timeout_secs: 30,
                failure_policy: 'rollback',
            }),
        getReloadStatus: (reloadId) =>
            apiRequest('GET', `/v1/system/reload/${encodeURIComponent(reloadId)}`),
        // WEB-прокси: статус и сессии (Pulse-диагностика)
        getWebStatus: () => apiRequest('GET', '/v1/runtime/web/status'),
        getWebSessions: (query = {}) => {
            const params = new URLSearchParams(query).toString();
            return apiRequest('GET', `/v1/runtime/web/sessions${params ? '?' + params : ''}`);
        },
        closeWebSessions: (selector) =>
            apiRequest('POST', '/v1/runtime/web/sessions/close', selector),
    };
}

// Локальный движок главной панели — экспорт модуля (все старые вызовы работают)
const defaultClient = createTelemtClient({
    apiUrl: config.telemt.apiUrl,
    apiAuth: config.telemt.apiAuth,
});

module.exports = defaultClient;
module.exports.createTelemtClient = createTelemtClient;
