/**
 * @fileoverview Middleware аутентификации администраторов по JWT.
 * Access-токен передаётся в заголовке Authorization: Bearer <token>.
 * @module middleware/auth
 */

const jwt = require('jsonwebtoken');
const config = require('../config');

/**
 * Проверяет JWT access-токен и добавляет req.admin = { id, login }.
 * Ответ 401 при отсутствии или невалидности токена.
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
function requireAuth(req, res, next) {
    const header = req.headers.authorization || '';
    let token = header.startsWith('Bearer ') ? header.slice(7) : null;

    // Для GET-запросов (экспорт CSV и т.п. через <a download>) токен можно
    // передать в query — <a> не отправляет заголовки. Только безопасные методы!
    if (!token && ['GET', 'HEAD'].includes(req.method) && req.query.token) {
        token = String(req.query.token);
    }

    if (!token) {
        return res.status(401).json({ error: 'Требуется авторизация' });
    }

    try {
        const payload = jwt.verify(token, config.jwtSecret);
        req.admin = { id: payload.sub, login: payload.login };
        next();
    } catch (err) {
        const message =
            err.name === 'TokenExpiredError'
                ? 'Сессия истекла. Войдите заново.'
                : 'Недействительный токен авторизации';
        return res.status(401).json({ error: message });
    }
}

/**
 * Проверка CSRF для изменяющих запросов: требуем пользовательский заголовок
 * (браузер не отправит его при простом cross-site запросе).
 */
function csrfProtection(req, res, next) {
    const safeMethods = ['GET', 'HEAD', 'OPTIONS'];
    if (safeMethods.includes(req.method)) return next();
    if (req.headers['x-requested-with'] === 'XMLHttpRequest') return next();
    return res.status(403).json({ error: 'Запрос отклонён системой защиты (CSRF)' });
}

/**
 * Записывает действие администратора в журнал аудита.
 * @param {import('better-sqlite3').Database} db
 * @returns {import('express').RequestHandler}
 */
function audit(db) {
    return (req, res, next) => {
        // Пишем в аудит только успешные изменяющие запросы
        res.on('finish', () => {
            if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) && res.statusCode < 400) {
                try {
                    // Маскируем секретные поля — в аудите им не место
                    const body = JSON.parse(JSON.stringify(req.body || {}));
                    for (const key of Object.keys(body)) {
                        if (/token|secret|password|key|card/i.test(key)) {
                            body[key] = '***';
                        }
                    }
                    db.prepare(
                        'INSERT INTO audit_log (admin, action, details, ip) VALUES (?, ?, ?, ?)'
                    ).run(
                        req.admin?.login || 'unknown',
                        `${req.method} ${req.originalUrl}`,
                        JSON.stringify(body).slice(0, 2000),
                        req.ip
                    );
                } catch {
                    // Аудит не должен ломать основной запрос
                }
            }
        });
        next();
    };
}

module.exports = { requireAuth, csrfProtection, audit };
