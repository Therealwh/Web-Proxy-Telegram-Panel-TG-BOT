/**
 * @fileoverview Роуты настроек панели (key-value хранилище с типизацией
 * по категориям: сеть, безопасность, уведомления, внешний вид, обновления).
 * @module routes/settings
 */

const express = require('express');
const { z } = require('zod');
const dns = require('dns').promises;
const db = require('../db');
const config = require('../config');
const logger = require('../utils/logger');
const { httpError } = require('../middleware/errorHandler');

const router = express.Router();

const DOMAIN_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;

// Дефолтные значения всех настроек с описанием категорий
const DEFAULTS = {
    // 🌐 Сеть и протоколы
    mask_domain: 'www.cloudflare.com',   // домен маскировки Fake-TLS
    ad_tag_global: null,                 // глобальный Ad Tag
    web_proxy_enabled: true,             // Web Proxy вкл/выкл
    mtproto_enabled: true,               // MTProto вкл/выкл

    // 🔒 Безопасность: лимит попыток входа фиксируется в коде (routes/auth.js),
    // а ip_whitelist требует доступа к sudoers — поэтому здесь не настраиваются.

    // 🔔 Уведомления
    tg_bot_token: null,                  // токен бота администратора
    tg_admin_chat_id: null,              // chat id администратора
    notify_disk: true,                   // мало места на диске
    notify_services: true,               // падение сервисов
    notify_new_client: true,             // новый клиент
    notify_quota: true,                  // превышение квоты

    // ♻️ Обслуживание клиентов
    auto_renew_enabled: true,            // автопродление с баланса (клиент включает в боте)
    backup_tg_enabled: true,             // присылать бэкап базы ботом админу раз в сутки

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

    // 🛰 DC-монитор
    dc_monitor_enabled: true,           // следить за доступностью DC Telegram
    dc_coverage_threshold: 50,          // покрытие ниже — деградация DC (%)
    dc_auto_restart: true,              // авторестарт Telemt при тотальной деградации
    dc_cooldown_min: 30,                // пауза между авторестартами (минут)

    // 🌍 Внешняя доступность (Globalping)
    avail_enabled: true,                // периодические замеры видимости из РФ
    avail_interval_min: 15,             // период замеров (минут)
    avail_probes: 10,                  // зондов на замер (1 кредит = 1 зонд)
    avail_threshold: 50,               // доля успеха ниже — алерт (%)
    avail_target: null,                // цель (по умолчанию — домен панели)
    avail_port: null,                  // порт (по умолчанию — порт MTProto)
    avail_token: null,                 // токен Globalping (квота 500/час вместо 250)
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

        const all = getAll();
        if (all.tg_bot_token) all.tg_bot_token = '••••••' + String(all.tg_bot_token).slice(-4);
        if (all.bot_settings?.bot_token) {
            all.bot_settings = { ...all.bot_settings };
            for (const sk of ['bot_token', 'cryptobot_token', 'yookassa_secret_key']) {
                if (all.bot_settings[sk]) all.bot_settings[sk] = '••••••' + String(all.bot_settings[sk]).slice(-4);
            }
        }
        res.json({ ok: true, settings: all });
    } catch (err) {
        next(err);
    }
});

// --- Текущий домен панели ---
router.get('/domain', (req, res) => {
    res.json({ domain: config.domain });
});

// --- Смена домена (через root-Helper, без переустановки) ---
router.post('/domain', async (req, res, next) => {
    try {
        const schema = z.object({ domain: z.string().min(4).max(253).regex(DOMAIN_RE, 'Некорректный домен') });
        const { domain } = schema.parse(req.body);
        const newDomain = domain.toLowerCase().trim();

        if (newDomain === config.domain) throw httpError(400, 'Этот домен уже установлен');

        // DNS-проверка: без A-записи смена отрежет доступ к панели
        let ips = [];
        try { ips = await dns.resolve4(newDomain); } catch { /* DNS ещё не обновился */ }
        if (ips.length === 0 && !req.body?.force) {
            return res.status(400).json({
                error: 'Домен ещё не указывает на сервер (A-запись не найдена). Обновите DNS у регистратора и повторите через 5–30 минут, либо включите «Принудительно».',
            });
        }

        if (!config.helperUrl || !config.helperSecret) {
            throw httpError(500, 'Хелпер не настроен. Выполните на сервере: bash /opt/tggate/scripts/install-helper.sh');
        }

        const hres = await fetch(`${config.helperUrl}/run`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ secret: config.helperSecret, key: 'domain', domain: newDomain }),
            signal: AbortSignal.timeout(10000),
        });
        if (!hres.ok) {
            const text = await hres.text().catch(() => '');
            throw httpError(502, `Хелпер отклонил запрос: HTTP ${hres.status} ${text.slice(0, 100)}`);
        }

        logger.info('Смена домена запущена через хелпер', { from: config.domain, to: newDomain });
        res.json({
            ok: true,
            message: 'Смена домена запущена. Панель перезапустится через несколько секунд — обновите страницу через 30–60 секунд.',
        });
    } catch (err) {
        next(err);
    }
});

// --- Рассылка новых ссылок активным клиентам (после смены домена) ---
router.post('/domain/notify', async (req, res, next) => {
    try {
        const bot = require('../services/bot');
        const result = await bot.broadcastNewLinks();
        res.json({ ok: true, ...result });
    } catch (err) {
        next(err);
    }
});

module.exports = { router, getAll, DEFAULTS };
