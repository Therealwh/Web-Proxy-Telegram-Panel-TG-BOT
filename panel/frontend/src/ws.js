// WebSocket-подключение с автоматическим переподключением
import { useAuthStore } from './store';

/**
 * Подключается к /ws и переподключается при обрыве
 * (экспоненциальная задержка: 1с, 2с, 4с ... максимум 30с).
 * @param {(msg: {type: string, data: any}) => void} onMessage
 * @returns {() => void} функция закрытия соединения
 */
export function connectLive(onMessage) {
    let ws = null;
    let closed = false;
    let attempt = 0;
    let timer = null;

    const connect = () => {
        if (closed) return;
        const accessToken = useAuthStore.getState().accessToken;
        if (!accessToken) return;

        const proto = location.protocol === 'https:' ? 'wss' : 'ws';
        try {
            ws = new WebSocket(`${proto}://${location.host}/ws?token=${accessToken}`);
        } catch {
            scheduleReconnect();
            return;
        }

        ws.onmessage = (ev) => {
            try {
                onMessage(JSON.parse(ev.data));
            } catch { /* битые сообщения пропускаем */ }
        };

        ws.onopen = () => { attempt = 0; };
        // 4001 = «Требуется авторизация» — токен истёк, повторять бессмысленно
        ws.onclose = (ev) => {
            if (closed) return;
            if (ev.code === 4001) {
                useAuthStore.getState().clearAuth();
                window.location.hash = '#/login';
                return;
            }
            scheduleReconnect();
        };
        ws.onerror = () => { try { ws.close(); } catch { /* игнорируем */ } };
    };

    const scheduleReconnect = () => {
        if (closed) return;
        attempt += 1;
        const delay = Math.min(30000, 1000 * 2 ** Math.min(attempt, 5));
        timer = setTimeout(connect, delay);
    };

    connect();

    // Возврат функции очистки
    return () => {
        closed = true;
        if (timer) clearTimeout(timer);
        if (ws) { try { ws.close(); } catch { /* игнорируем */ } }
    };
}
