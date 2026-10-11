/**
 * @fileoverview Чек-лист первоначальной настройки.
 * После установки панели обязательные шаги разбросаны по разным страницам
 * (домен, токен бота, тарифы, первый клиент), и легко забыть часть —
 * тогда панель стоит, но ничего не работает. Этот эндпоинт собирает
 * готовность в одном месте, чтобы карточка на дашборде могла исчезнуть
 * сама, когда всё настроено.
 *
 * Тексты подписей живут во фронтенде (i18n), здесь только идентификаторы.
 * @module routes/onboarding
 */

const express = require('express');
const db = require('../db');
const config = require('../config');

const router = express.Router();

/** Домен считается настроенным, если он не заглушка установщика. */
function domainConfigured() {
    const d = String(config.domain || '').toLowerCase();
    return !!d && d !== 'localhost' && !d.includes('example.com');
}

router.get('/', (req, res) => {
    const setting = (key) => {
        const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
        if (!row) return null;
        try {
            return JSON.parse(row.value);
        } catch {
            return row.value;
        }
    };

    const clientsCount = db.prepare('SELECT COUNT(*) AS c FROM clients').get().c;
    const tariffsCount = db.prepare('SELECT COUNT(*) AS c FROM tariffs WHERE enabled = 1').get().c;

    const steps = [
        { id: 'domain', done: domainConfigured(), href: '/settings' },
        { id: 'tgToken', done: !!setting('tg_bot_token'), href: '/settings' },
        { id: 'tgChat', done: !!setting('tg_admin_chat_id'), href: '/settings' },
        { id: 'tariffs', done: tariffsCount > 0, href: '/bot' },
        { id: 'client', done: clientsCount > 0, href: '/clients' },
        { id: 'backup', done: setting('backup_auto') !== false, href: '/settings' },
    ];

    const done = steps.filter((s) => s.done).length;
    res.json({
        steps,
        done,
        total: steps.length,
        complete: done === steps.length,
        domain: config.domain,
        clients: clientsCount,
    });
});

module.exports = router;