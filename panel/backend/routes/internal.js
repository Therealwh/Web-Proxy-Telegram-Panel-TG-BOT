/**
 * @fileoverview Внутренние эндпоинты (только с loopback — для install.sh,
 * tggate.sh и cron-скриптов). НЕ доступны извне: Nginx не проксирует /api/internal.
 * Дополнительно проверяем, что запрос пришёл с 127.0.0.1.
 * @module routes/internal
 */

const express = require('express');
const bcrypt = require('bcryptjs');
const { z } = require('zod');
const db = require('../db');
const logger = require('../utils/logger');

const router = express.Router();

/**
 * Пропускает запросы только с loopback-интерфейса.
 * req.ip с trust proxy='loopback' корректно извлекает реального клиента
 * из X-Forwarded-For и НЕ доверяет подделкам: внешний запрос получит
 * свой внешний IP и будет отклонён.
 */
function loopbackOnly(req, res, next) {
    const ip = req.ip || '';
    if (ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1') return next();
    return res.status(403).json({ error: 'Доступ запрещён' });
}

router.use(loopbackOnly);

// --- Первичное создание администратора (вызывается из install.sh) ---
router.post('/setup-admin', (req, res, next) => {
    try {
        const schema = z.object({
            login: z.string().regex(/^[A-Za-z0-9_]{3,32}$/, 'Некорректный логин'),
            password: z.string().min(8, 'Пароль минимум 8 символов'),
        });
        const { login, password } = schema.parse(req.body);

        const existing = db.prepare('SELECT COUNT(*) AS c FROM admins').get().c;
        if (existing > 0) {
            return res.status(409).json({ error: 'Администратор уже существует' });
        }

        db.prepare('INSERT INTO admins (login, password_hash) VALUES (?, ?)')
            .run(login, bcrypt.hashSync(password, 12));
        logger.info('Создан первичный администратор', { login });
        res.status(201).json({ ok: true });
    } catch (err) {
        next(err);
    }
});

// --- Сброс логина/пароля (вызывается из sudo TGGATE) ---
router.post('/reset-admin', (req, res, next) => {
    try {
        const schema = z.object({
            login: z.string().regex(/^[A-Za-z0-9_]{3,32}$/).optional(),
            password: z.string().min(8).optional(),
        });
        const data = schema.parse(req.body);
        const admin = db.prepare('SELECT * FROM admins ORDER BY id LIMIT 1').get();
        if (!admin) return res.status(404).json({ error: 'Администратор не найден' });

        if (data.login) {
            db.prepare('UPDATE admins SET login = ?, updated_at = datetime(\'now\') WHERE id = ?')
                .run(data.login, admin.id);
        }
        if (data.password) {
            db.prepare('UPDATE admins SET password_hash = ?, updated_at = datetime(\'now\') WHERE id = ?')
                .run(bcrypt.hashSync(data.password, 12), admin.id);
            // Отзываем все активные сессии
            db.prepare('UPDATE refresh_tokens SET revoked = 1 WHERE admin_id = ?').run(admin.id);
        }
        logger.info('Учётные данные администратора обновлены через CLI');
        res.json({ ok: true });
    } catch (err) {
        next(err);
    }
});

// --- Приём результата проверки обновлений (от check-updates.sh) ---
router.post('/updates-status', (req, res) => {
    try {
        db.prepare(
            'INSERT INTO settings (key, value) VALUES (?, ?) ' +
            'ON CONFLICT(key) DO UPDATE SET value = excluded.value'
        ).run('versions', JSON.stringify(req.body));
        res.json({ ok: true });
    } catch (err) {
        logger.error('Не удалось сохранить статус обновлений', { error: err.message });
        res.status(500).json({ error: 'Ошибка сохранения' });
    }
});

module.exports = router;
