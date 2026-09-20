/**
 * @fileoverview WebSocket-хаб для real-time обновлений фронтенда:
 * живая статистика (раз в секунду) и живые логи подключений.
 * Клиенты авторизуются access-токеном через query-параметр.
 * @module services/wsHub
 */

const { WebSocketServer } = require('ws');
const jwt = require('jsonwebtoken');
const config = require('../config');
const logger = require('../utils/logger');

/** @type {Set<import('ws').WebSocket>} */
const clients = new Set();

/**
 * Подключает WebSocket-сервер к HTTP-серверу Express (путь /ws).
 * @param {import('http').Server} server
 */
function init(server) {
    const wss = new WebSocketServer({ server, path: '/ws' });

    wss.on('connection', (ws, req) => {
        // Авторизация: токен в query (?token=...) — браузерный WS не шлёт заголовки
        const url = new URL(req.url, 'http://localhost');
        const token = url.searchParams.get('token');
        try {
            jwt.verify(token || '', config.jwtSecret);
        } catch {
            ws.close(4001, 'Требуется авторизация');
            return;
        }

        clients.add(ws);
        ws.on('close', () => clients.delete(ws));
        ws.on('error', () => clients.delete(ws));
        ws.send(JSON.stringify({ type: 'hello', message: 'Подключено к TGGATE' }));
    });

    logger.info('WebSocket-сервер запущен на /ws');
}

/**
 * Рассылает событие всем подключённым клиентам.
 * @param {string} type - тип события (stats | log | ...)
 * @param {object} data - полезная нагрузка
 */
function broadcast(type, data) {
    if (clients.size === 0) return;
    const message = JSON.stringify({ type, data, ts: Date.now() });
    for (const ws of clients) {
        if (ws.readyState === ws.OPEN) {
            ws.send(message);
        }
    }
}

module.exports = { init, broadcast, closeAll };
