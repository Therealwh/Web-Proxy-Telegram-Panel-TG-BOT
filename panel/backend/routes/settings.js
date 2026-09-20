/**
 * @fileoverview Роуты настроек панели (key-value хранилище с типизацией
 * по категориям: сеть, безопасность, уведомления, внешний вид, обновления).
 * @module routes/settings
 */

const express = require('express');
const { z } = require('zod');
const db = require('../db');

const router = express.Router();

// Дефолтные значения всех настроек с описанием категорий
const DEFAULTS = {
    // 🌐 Сеть и протоколы
    mask_domain: 'www.cloudflare.com',   // домен маскировки Fake-TLS
    ad_tag_global: null,                 // глобальный Ad Tag
    web_proxy_enabled: true,             // Web Proxy вкл/выкл
    mtproto_enabled: true,               // MTProto вкл/выкл

    // 🔒 Безопасность
    ip_whitelist: [],                    // whitelist IP для админки (пусто = все)
    login_rate_limit: 10,                // попыток входа за 15 минут

    // 🔔 Уведомления
    tg_bot_token: null,                  // токен бота администратора
    tg_admin_chat_id: null,              // chat id администратора
    notify_disk: true,                   // мало места на диске
    notify_services: true,               // падение сервисов
    notify_new_client: true,             // новый клиент
    notify_quota: true,                  // превышение квоты

    // 🎨 Внешний вид
    theme: 'dark',                       // dark | light
    language: 'ru',                      // ru | en
    brand_name: 'TGGATE',                // название в шапке

    // 📊 Резервные копии
    backup_auto: true,                   // ежедневные бэкапы
    backup_keep_days: 14,                // сколько дней хранить

    // 🔄 Обновления
    updates_auto_check: true,
    updates_frequency: 'daily',          // hourly | daily | weekly | monthly
    updates_channel: 'stable',           // stable | beta | latest
    updates_auto_install: false,         // только уведомлять / автоустановка
    updates_notify: ['panel', 'telegram'],
};

/** Читает все настройки, подставляя дефолты. */
function getAll() {
    const rows = db.prepare('SELECT key, value FROM settings').all();
    const stored = {};
    for (const row of rows) {
        try { stored[row.key] = JSON.parse(row.value); } catch { stored[row.key] = row.value; }
    }
    return { ...DEFAULTS, ...stored };
}

// --- Получить все настройки ---
router.get('/', (req, res) => {
    const settings = getAll();
    // Секреты отдаём частично (только признак «задано»)
    if (settings.tg_bot_token) settings.tg_bot_token = '••••••' + String(settings.tg_bot_token).slice(-4);
    if (settings.bot_settings) {
        settings.bot_settings = { ...settings.bot_settings };
        for (const secretKey of ['bot_token', 'cryptobot_token', 'yookassa_secret_key']) {
            if (settings.bot_settings[secretKey]) {
                settings.bot_settings[secretKey] = '••••••' + String(settings.bot_settings[secretKey]).slice(-4);
            }
        }
    }
    res.json({ settings, defaults: DEFAULTS });
});

// --- Обновить настройки (массово) ---
router.put('/', (req, res, next) => {
    try {
        const schema = z.record(z.unknown());
        const data = schema.parse(req.body);

        const upsert = db.prepare(
            'INSERT INTO settings (key, value) VALUES (?, ?) ' +
            'ON CONFLICT(key) DO UPDATE SET value = excluded.value'
        );

        // Разрешаем менять только известные ключи; секрет «••••» не перезаписываем
        const allowed = new Set(Object.keys(DEFAULTS));
        db.transaction(() => {
            for (const [key, value] of Object.entries(data)) {
                if (!allowed.has(key)) continue;
                if (key === 'tg_bot_token' && String(value).startsWith('••••')) continue;
                upsert.run(key, JSON.stringify(value));
            }
        })();

        res.json({ ok: true, settings: getAll() });
    } catch (err) {
        next(err);
    }
});

module.exports = { router, getAll, DEFAULTS };
