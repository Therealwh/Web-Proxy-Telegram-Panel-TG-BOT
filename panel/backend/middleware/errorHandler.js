/**
 * @fileoverview Обработчики ошибок и «мягкий» 404 для API TGGATE.
 * Все ошибки пользователю — на русском языке.
 * @module middleware/errorHandler
 */

const logger = require('../utils/logger');

/**
 * 404 для несуществующих API-эндпоинтов.
 */
function notFound(req, res) {
    res.status(404).json({ error: 'Эндпоинт не найден' });
}

/**
 * Централизованный обработчик ошибок Express.
 * Zod-ошибки → 400 с описанием полей; остальные → 500 без утечки деталей.
 * @param {Error} err
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} _next
 */
// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, _next) {
    // Ошибки валидации zod — показываем, что именно не так
    if (err.name === 'ZodError') {
        const fields = err.errors.map((e) => `${e.path.join('.')}: ${e.message}`);
        return res.status(400).json({
            error: 'Ошибка валидации данных',
            details: fields,
        });
    }

    // Ошибка синтаксиса JSON в теле запроса
    if (err.type === 'entity.parse.failed') {
        return res.status(400).json({ error: 'Некорректный JSON в теле запроса' });
    }

    // Ошибки с явным статусом (бизнес-логика)
    if (err.statusCode) {
        return res.status(err.statusCode).json({ error: err.message });
    }

    // Непредвиденные ошибки — логируем, детали не раскрываем
    logger.error('Непредвиденная ошибка API', {
        error: err.message,
        stack: err.stack,
        url: req.originalUrl,
    });
    res.status(500).json({ error: 'Внутренняя ошибка сервера. Попробуйте позже.' });
}

/**
 * Создаёт ошибку с HTTP-статусом для проброса в errorHandler.
 * @param {number} statusCode - HTTP статус
 * @param {string} message - сообщение на русском
 * @returns {Error}
 */
function httpError(statusCode, message) {
    const err = new Error(message);
    err.statusCode = statusCode;
    return err;
}

module.exports = { notFound, errorHandler, httpError };
