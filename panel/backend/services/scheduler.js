/**
 * @fileoverview Фоновые задачи панели: проверка доступности прокси,
 * напоминания об истечении доступа, автоудаление просроченных, автобэкапы,
 * мониторинг диска и сервисов с TG-уведомлениями.
 * @module services/scheduler
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const db = require('../db');
const config = require('../config');
const { getAll } = require('../routes/settings');
const notifier = require('./notifier');
const logger = require('../utils/logger');

// Счётчик последовательных сбоев сервисов (для алертов без спама)
let downStreak = 0;

/** Проверка доступности прокси: MTProto (TCP) и Web (HTTPS через домен). */
async function checkProxies() {
    try {
        // MTProto: TCP-порт открыт?
        let mtOk = 0;
        try {
            execSync(`timeout 5 bash -c "echo > /dev/tcp/127.0.0.1/${config.mtprotoPort}"`);
            mtOk = 1;
        } catch { mtOk = 0; }

        // Web: домен отвечает?
        let webOk = 0;
        let webLatency = null;
        try {
            const start = Date.now();
            const res = await fetch(`https://${config.domain}/`, { signal: AbortSignal.timeout(8000) });
            webLatency = Date.now() - start;
            webOk = res.status < 500 ? 1 : 0;
        } catch { webOk = 0; }

        const insert = db.prepare('INSERT INTO uptime_checks (service, ok, latency_ms) VALUES (?, ?, ?)');
        insert.run('mtproto', mtOk, null);
        insert.run('web', webOk, webLatency);

        // Telemt Control API здоров?
        let apiOk = 0;
        try {
            const telemt = require('./telemtApi');
            await telemt.getHealth();
            apiOk = 1;
        } catch { apiOk = 0; }
        insert.run('api', apiOk, null);

        // Чистим старые проверки (храним 35 дней)
        db.prepare("DELETE FROM uptime_checks WHERE created_at < datetime('now','-35 days')").run();

        // Алерты: падение — после 2 проверок подряд (без спама каждые 5 минут),
        // восстановление — сразу
        const settings = getAll();
        const down = !mtOk || !webOk || !apiOk;
        if (down) {
            downStreak += 1;
            if (downStreak === 2 && settings.notify_services) {
                notifier.notifyAdmin(settings,
                    `🚨 <b>Сервис недоступен!</b>\nMTProto: ${mtOk ? '✅' : '❌'}\nWeb Proxy: ${webOk ? '✅' : '❌'}\nTelemt API: ${apiOk ? '✅' : '❌'}`
                );
            }
        } else {
            if (downStreak >= 2 && settings.notify_services) {
                notifier.notifyAdmin(settings, '✅ <b>Сервис восстановлен</b> — всё работает.');
            }
            downStreak = 0;
        }
    } catch (err) {
        logger.error('Ошибка проверки прокси', { error: err.message });
    }
}

/** Напоминания об истечении доступа за 3 и 1 день. */
function checkExpiring() {
    const settings = getAll();
    // Токен бота продаж приоритетнее (клиенты общаются именно с ним)
    const botSettings = require('./bot').getBotSettings();
    const token = botSettings.bot_token || settings.tg_bot_token;
    if (!token) return;

    for (const days of [3, 1]) {
        const rows = db.prepare(
            `SELECT c.* FROM clients c
             WHERE c.status = 'active' AND c.expires_at IS NOT NULL
               AND date(c.expires_at) = date('now', '+${days} days')
               AND c.telegram_id IS NOT NULL`
        ).all();
        for (const client of rows) {
            // Не отправляем повторно: пометка в аудите на сегодня
            const sent = db.prepare(
                "SELECT COUNT(*) AS c FROM audit_log WHERE action = ? AND details LIKE ? AND created_at >= date('now')"
            ).get('notify.expiring', `%${client.username}%`).c;
            if (sent) continue;

            const msg = `⏰ <b>Доступ истекает через ${days} дн.!</b>\n\n` +
                `📅 Ваш прокси активен до ${new Date(client.expires_at).toLocaleDateString('ru-RU', { timeZone: 'Europe/Moscow' })} МСК.\n` +
                `Продлите заранее, чтобы не терять связь — /start`;
            notifier.sendMessage(token, client.telegram_id, msg).catch(() => {});
            db.prepare("INSERT INTO audit_log (admin, action, details) VALUES ('system', 'notify.expiring', ?)")
                .run(`Напоминание об истечении: ${client.username}`);
        }
    }
}

/** Автоматическая блокировка просроченных клиентов. */
async function disableExpired() {
    const rows = db.prepare(
        "SELECT * FROM clients WHERE status = 'active' AND expires_at IS NOT NULL AND expires_at < datetime('now')"
    ).all();
    const telemt = require('./telemtApi');
    for (const client of rows) {
        try {
            await telemt.disableUser(client.username);
            db.prepare("UPDATE clients SET status = 'expired' WHERE id = ?").run(client.id);
            logger.info('Клиент просрочен и отключён', { username: client.username });
        } catch (err) {
            logger.warn('Не удалось отключить просроченного клиента', { username: client.username });
        }
    }
}

/**
 * Удаление просроченных ТЕСТОВЫХ клиентов (username = test<tgId>):
 * через 24 часа после истечения удаляются из Telemt и из базы.
 * Удаляем в Telemt только при успехе — запись из базы.
 */
async function cleanupTestClients() {
    const rows = db.prepare(
        `SELECT * FROM clients
         WHERE username GLOB 'test[0-9]*'
           AND status IN ('expired', 'blocked')
           AND expires_at IS NOT NULL
           AND expires_at < datetime('now', '-24 hours')`
    ).all();
    const telemt = require('./telemtApi');
    const { syncWebProfiles } = require('./webProfiles');
    for (const client of rows) {
        try {
            // 1. Убираем WEB-профиль ДО удаления пользователя в Telemt,
            //    иначе Telemt отклонит удаление (profile references unknown user)
            await syncWebProfiles(client.username).catch(() => {});

            // 2. Удаляем в Telemt (с повтором через enable при отказе)
            await telemt.deleteUser(client.username).catch(async (e) => {
                // Пользователя могли удалить вручную из Telemt — тогда просто чистим базу
                if (/404|not found|not_found|no such/i.test(e.message)) return;
                await telemt.enableUser(client.username).catch(() => {});
                return telemt.deleteUser(client.username);
            });
            // 3. Удаляем из БД панели
            db.prepare('DELETE FROM clients WHERE id = ?').run(client.id);
            logger.info('Тестовый клиент удалён', { username: client.username });
        } catch (err) {
            // Telemt недоступен/упёрлось — повторим в следующий час;
            // старше 7 дней — удаляем из базы принудительно (в Telemt срок всё равно истёк)
            const ageDays = (Date.now() - new Date(client.expires_at).getTime()) / 86400000;
            if (ageDays > 7) {
                db.prepare('DELETE FROM clients WHERE id = ?').run(client.id);
                logger.warn('Тестовый клиент удалён из базы принудительно', { username: client.username, error: err.message });
            } else {
                logger.warn('Не удалось удалить тестового клиента — повторю через час', { username: client.username, error: err.message });
            }
        }
    }
}

/** Автопродление с баланса: клиент включил в боте, до конца ≤3 дней, баланс хватает. */
async function autoRenew() {
    const settings = getAll();
    if (!settings.auto_renew_enabled) return;
    const rows = db.prepare(
        `SELECT * FROM clients
         WHERE status = 'active' AND auto_renew = 1 AND telegram_id IS NOT NULL
           AND expires_at IS NOT NULL AND expires_at <= datetime('now', '+3 days')`
    ).all();
    if (rows.length === 0) return;

    const bot = require('./bot');
    const telemt = require('./telemtApi');
    const botSettings = bot.getBotSettings();
    const token = botSettings.bot_token || settings.tg_bot_token;

    for (const client of rows) {
        try {
            // Тариф последней успешной покупки этого прокси
            const last = db.prepare(
                `SELECT tariff_id FROM payments
                 WHERE client_id = ? AND status = 'success' AND tariff_id IS NOT NULL
                 ORDER BY paid_at DESC LIMIT 1`
            ).get(client.id);
            const tariff = last ? db.prepare('SELECT * FROM tariffs WHERE id = ?').get(last.tariff_id) : null;
            if (!tariff) continue;

            const balance = bot.totalBalance(client.telegram_id);
            if (balance < tariff.price) {
                // Уведомляем не чаще раза в сутки (пометка в аудите на сегодня)
                const sent = db.prepare(
                    "SELECT COUNT(*) AS c FROM audit_log WHERE action = 'notify.autorenew.fail' AND details LIKE ? AND created_at >= date('now')"
                ).get(`%${client.username}%`).c;
                if (!sent && token) {
                    notifier.sendMessage(token, client.telegram_id,
                        `⚠️ <b>Автопродление не сработало</b> — не хватает ${tariff.price} (баланс: ${balance.toFixed(2)}).\n` +
                        `Пополните счёт в личном кабинете — продлим автоматически.`
                    ).catch(() => {});
                    db.prepare("INSERT INTO audit_log (admin, action, details) VALUES ('system', 'notify.autorenew.fail', ?)")
                        .run(`Недостаточно баланса для автопродления: ${client.username}`);
                }
                continue;
            }

            bot.deductBalance(client.telegram_id, tariff.price);
            const base = client.expires_at && new Date(client.expires_at) > new Date()
                ? new Date(client.expires_at) : new Date();
            const newExpiry = new Date(base.getTime() + tariff.days * 86400000).toISOString();
            await telemt.patchUser(client.username, { expiration_rfc3339: newExpiry }).catch(() => {});
            db.prepare("UPDATE clients SET expires_at = ?, status = 'active' WHERE id = ?").run(newExpiry, client.id);

            if (token) {
                const until = new Date(newExpiry).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' }) + ' МСК';
                notifier.sendMessage(token, client.telegram_id,
                    `♻️ <b>Автопродление выполнено!</b>\n\n📦 ${client.username} — до <b>${until}</b>\n` +
                    `💳 Списано: ${tariff.price} · Баланс: ${(balance - tariff.price).toFixed(2)}`
                ).catch(() => {});
            }
            db.prepare("INSERT INTO audit_log (admin, action, details) VALUES ('system', 'autorenew', ?)")
                .run(`Автопродление ${client.username}: +${tariff.days} дн. за ${tariff.price}`);
            logger.info('Автопродление выполнено', { username: client.username, days: tariff.days });
        } catch (err) {
            logger.warn('Ошибка автопродления', { username: client.username, error: err.message });
        }
    }
}

/** Бэкап базы файлом админу в Telegram (через технического бота уведомлений). @returns {Promise<string>} имя файла */
async function backupToTelegram() {
    const settings = getAll();
    if (!settings.backup_tg_enabled) {
        throw new Error('Отправка бэкапа выключена в настройках панели');
    }
    if (!settings.tg_bot_token || !settings.tg_admin_chat_id) {
        throw new Error('Не настроены Токен бота и Chat ID администратора (Настройки → Уведомления)');
    }
    db.pragma('wal_checkpoint(TRUNCATE)');
    const filename = `tggate-backup-${new Date().toISOString().slice(0, 10)}.db.gz`;
    // Telegram принимает документы до 50 МБ — сжимаем (SQLite жмётся в разы)
    const gz = require('zlib').gzipSync(fs.readFileSync(config.dbPath), { level: 9 });
    if (gz.length > 45 * 1024 * 1024) {
        throw new Error('Бэкап слишком велик для Telegram — скачайте его в разделе «Резервное копирование»');
    }
    await notifier.sendDocument(
        settings.tg_bot_token,
        settings.tg_admin_chat_id,
        gz,
        filename
    );
    logger.info('Бэкап отправлен админу в Telegram', { filename });
    return filename;
}

/** Ежедневный автобэкап + ротация старых. */
async function autoBackup() {
    const settings = getAll();
    if (!settings.backup_auto) return;
    try {
        fs.mkdirSync(config.backupDir, { recursive: true });
        const dest = path.join(config.backupDir, `auto-${new Date().toISOString().slice(0, 10)}.db`);
        db.pragma('wal_checkpoint(TRUNCATE)');
        fs.copyFileSync(config.dbPath, dest);

        // Ротация: удаляем бэкапы старше N дней
        const keepDays = settings.backup_keep_days || 14;
        const cutoff = Date.now() - keepDays * 86400000;
        for (const f of fs.readdirSync(config.backupDir)) {
            if (!f.startsWith('auto-')) continue;
            const full = path.join(config.backupDir, f);
            if (fs.statSync(full).mtimeMs < cutoff) fs.rmSync(full);
        }
        logger.info('Автобэкап создан', { dest });

        // Копия бэкапа админу в Telegram: хранится в мессенджере, место на диске не тратит
        if (settings.backup_tg_enabled && settings.tg_admin_chat_id) {
            try {
                await backupToTelegram();
            } catch (err) {
                logger.warn('Бэкап в Telegram не отправлен', { error: err.message });
                notifier.notifyAdmin(settings, `⚠️ Не удалось отправить автобэкап в Telegram: ${err.message}`);
            }
        }
    } catch (err) {
        logger.error('Ошибка автобэкапа', { error: err.message });
    }
}

/** Мониторинг свободного места на диске. */
function checkDisk() {
    const settings = getAll();
    if (!settings.notify_disk) return;
    try {
        const out = execSync("df / --output=pcent | tail -1").toString().trim().replace('%', '');
        const used = parseInt(out, 10);
        if (used >= 90) {
            notifier.notifyAdmin(settings, `⚠️ <b>Диск заполнен на ${used}%!</b> Освободите место на сервере.`).catch(() => {});
        }
    } catch { /* df недоступен — пропускаем */ }
}

/** Запускает все фоновые задачи с их интервалами. */
function start() {
    // Проверка доступности каждые 5 минут
    setInterval(() => checkProxies().catch(() => {}), 5 * 60 * 1000).unref();
    checkProxies().catch(() => {});

    // Ежечасно: истечения, просроченные, тестовые, диск, автопродление
    setInterval(() => {
        try { checkExpiring(); } catch (e) { logger.error(e); }
        disableExpired().catch(() => {});
        cleanupTestClients().catch(() => {});
        try { checkDisk(); } catch (e) { logger.error(e); }
        autoRenew().catch((e) => logger.error('Ошибка автопродления', { error: e.message }));
    }, 60 * 60 * 1000).unref();
    // Первый прогон через 2 минуты после старта
    setTimeout(() => {
        try { checkExpiring(); } catch (e) { logger.error(e); }
        disableExpired().catch(() => {});
        cleanupTestClients().catch(() => {});
        autoRenew().catch((e) => logger.error('Ошибка автопродления', { error: e.message }));
    }, 2 * 60 * 1000).unref();

    // Ежедневно: автобэкап (в 03:30 по локальному времени)
    const now = new Date();
    const next330 = new Date(now);
    next330.setHours(3, 30, 0, 0);
    if (next330 <= now) next330.setDate(next330.getDate() + 1);
    setTimeout(() => {
        autoBackup();
        setInterval(autoBackup, 24 * 60 * 60 * 1000).unref();
    }, next330 - now).unref();

    logger.info('Планировщик фоновых задач запущен');
}

module.exports = { start, autoBackup, backupToTelegram };
