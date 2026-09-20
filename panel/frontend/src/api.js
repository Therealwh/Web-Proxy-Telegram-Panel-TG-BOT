// API-клиент панели: обёртка над fetch с JWT, авто-refresh и CSRF-заголовком
import { useAuthStore } from './store';

const API_BASE = '/api';

/**
 * Выполняет запрос к API с авторизацией. При 401 пробует обновить
 * access-токен через refresh-cookie и повторяет запрос один раз.
 * @param {string} path - путь относительно /api
 * @param {RequestInit} [options]
 * @returns {Promise<any>} распарсенный JSON ответа
 * @throws {Error} с русским сообщением об ошибке
 */
export async function api(path, options = {}) {
    const { accessToken, setAuth, clearAuth } = useAuthStore.getState();

    const doFetch = (token) =>
        fetch(`${API_BASE}${path}`, {
            ...options,
            headers: {
                'Content-Type': 'application/json',
                'X-Requested-With': 'XMLHttpRequest', // CSRF-защита
                ...(token ? { Authorization: `Bearer ${token}` } : {}),
                ...(options.headers || {}),
            },
            body: options.body && typeof options.body !== 'string'
                ? JSON.stringify(options.body)
                : options.body,
        });

    let response = await doFetch(accessToken);

    // Пробуем обновить токен один раз при 401
    if (response.status === 401 && accessToken) {
        const refresh = await fetch(`${API_BASE}/auth/refresh`, { method: 'POST' });
        if (refresh.ok) {
            const data = await refresh.json();
            setAuth(data.accessToken, data.login);
            response = await doFetch(data.accessToken);
        } else {
            clearAuth();
            window.location.hash = '#/login';
            throw new Error('Сессия истекла. Войдите заново.');
        }
    }

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
        let message = data.error || `Ошибка сервера (${response.status})`;
        // Детали валидации (какое поле не прошло) — показываем пользователю
        if (Array.isArray(data.details) && data.details.length > 0) {
            message += ': ' + data.details.join('; ');
        }
        throw new Error(message);
    }
    return data;
}

/** GET-запрос */
export const get = (path) => api(path);
/** POST-запрос с JSON-телом */
export const post = (path, body) => api(path, { method: 'POST', body });
/** PATCH-запрос */
export const patch = (path, body) => api(path, { method: 'PATCH', body });
/** PUT-запрос */
export const put = (path, body) => api(path, { method: 'PUT', body });
/** DELETE-запрос */
export const del = (path) => api(path, { method: 'DELETE' });
