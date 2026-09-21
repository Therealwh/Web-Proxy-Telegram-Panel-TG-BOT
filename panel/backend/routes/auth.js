/**
 * @fileoverview Роуты аутентификации администратора.
 * POST /api/auth/login   — вход (JWT access + refresh cookie)
 * POST /api/auth/refresh — обновление access-токена
 * POST /api/auth/logout  — выход (отзыв refresh-токена)
 * GET  /api/auth/me      — текущий пользователь
 * @module routes/auth
 */

const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const { z } = require('zod');
const config = require('../config');
const db = require('../db');
const logger = require('../utils/logger');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

const REFRESH_COOKIE = 'tggate_refresh';

// Строгий лимит на попытки входа: 10 за 15 минут с одного IP
const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Слишком много попыток входа. Попробуйте через 15 минут.' },
});

const loginSchema = z.object({
    login: z.string().min(1, 'Введите логин').max(64),
    password: z.string().min(1, 'Введите пароль').max(128),
});

/** Хэширует refresh-токен для хранения в БД (сам токен не храним). */
const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');

/**
 * Создаёт пару токенов: access (короткий) + refresh (длинный, в БД).
 * @param {object} admin - запись администратора
 * @returns {{accessToken: string, refreshToken: string}}
 */
function issueTokens(admin) {
    const accessToken = jwt.sign(
        { sub: admin.id, login: admin.login },
        config.jwtSecret,
        { expiresIn: config.jwtAccessTtl }
    );
    const refreshToken = crypto.randomBytes(48).toString('hex');
    // Сессия на 30 дней (согласовано с cookie maxAge и config.jwtRefreshTtl)
    const expiresAt = new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString();
    // Чистим просроченные/отозванные токены (таблица не должна расти бесконечно)
    db.prepare("DELETE FROM refresh_tokens WHERE expires_at < datetime('now') OR (revoked = 1 AND created_at < datetime('now', '-7 days'))").run();
    db.prepare(
        'INSERT INTO refresh_tokens (admin_id, token_hash, expires_at) VALUES (?, ?, ?)'
    ).run(admin.id, hashToken(refreshToken), expiresAt);
    return { accessToken, refreshToken };
}

/** Ставит httpOnly-cookie с refresh-токеном. */
function setRefreshCookie(res, refreshToken) {
    res.cookie(REFRESH_COOKIE, refreshToken, {
        httpOnly: true,
        secure: config.isProd,
        sameSite: 'strict',
        path: '/api/auth',
        maxAge: 30 * 24 * 3600 * 1000,
    });
}

// --- Вход ---
router.post('/login', loginLimiter, (req, res, next) => {
    try {
        const { login, password } = loginSchema.parse(req.body);
        const admin = db.prepare('SELECT * FROM admins WHERE login = ?').get(login);

        // Единое сообщение — не раскрываем, что именно неверно
        if (!admin || !bcrypt.compareSync(password, admin.password_hash)) {
            logger.warn('Неудачная попытка входа', { login, ip: req.ip });
            return res.status(401).json({ error: 'Неверный логин или пароль' });
        }

        const { accessToken, refreshToken } = issueTokens(admin);
        setRefreshCookie(res, refreshToken);
        logger.info('Администратор вошёл в панель', { login, ip: req.ip });
        res.json({ accessToken, login: admin.login });
    } catch (err) {
        next(err);
    }
});

// --- Обновление access-токена ---
router.post('/refresh', (req, res) => {
    const token = req.cookies[REFRESH_COOKIE];
    if (!token) return res.status(401).json({ error: 'Сессия не найдена. Войдите заново.' });

    const row = db
        .prepare('SELECT * FROM refresh_tokens WHERE token_hash = ? AND revoked = 0')
        .get(hashToken(token));

    if (!row || new Date(row.expires_at) < new Date()) {
        return res.status(401).json({ error: 'Сессия истекла. Войдите заново.' });
    }

    const admin = db.prepare('SELECT * FROM admins WHERE id = ?').get(row.admin_id);
    if (!admin) return res.status(401).json({ error: 'Пользователь не найден' });

    // Ротация refresh-токена: старый отзываем, новый выдаём
    db.prepare('UPDATE refresh_tokens SET revoked = 1 WHERE id = ?').run(row.id);
    const { accessToken, refreshToken } = issueTokens(admin);
    setRefreshCookie(res, refreshToken);
    res.json({ accessToken, login: admin.login });
});

// --- Выход ---
router.post('/logout', (req, res) => {
    const token = req.cookies[REFRESH_COOKIE];
    if (token) {
        db.prepare('UPDATE refresh_tokens SET revoked = 1 WHERE token_hash = ?')
            .run(hashToken(token));
    }
    res.clearCookie(REFRESH_COOKIE, { path: '/api/auth' });
    res.json({ ok: true });
});

// --- Текущий пользователь ---
router.get('/me', requireAuth, (req, res) => {
    res.json({ login: req.admin.login });
});

module.exports = router;
