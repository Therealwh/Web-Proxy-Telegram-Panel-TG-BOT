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

        // Чистим старые проверки (храним 35 дней)
        db.prepare("DELETE FROM uptime_checks WHERE created_at < datetime('now','-35 days')").run();

        // Алерты при падении
        const settings = getAll();
        if (settings.notify_services && (!mtOk || !webOk)) {
            notifier.notifyAdmin(settings,
                `🚨 <b>Проблема с прокси!</b>\nMTProto: ${mtOk ? '✅' : '❌'}\nWeb Proxy: ${webOk ? '✅' : '❌'}`
            ).catch(() => {});
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
    for (const client of rows) {
        try {
            await telemt.deleteUser(client.username).catch(async (e) => {
                // Пользователя могли удалить вручную из Telemt — тогда просто чистим базу
                if (!/not found|404/i.test(e.message)) throw e;
            });
            db.prepare('DELETE FROM clients WHERE id = ?').run(client.id);
            logger.info('Тестовый клиент удалён', { username: client.username });
        } catch (err) {
            logger.warn('Не удалось удалить тестового клиента', { username: client.username });
        }
    }
}

/** Ежедневный автобэкап + ротация старых. */
function autoBackup() {
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

    // Ежечасно: истечения, просроченные, тестовые, диск
    setInterval(() => {
        try { checkExpiring(); } catch (e) { logger.error(e); }
        disableExpired().catch(() => {});
        cleanupTestClients().catch(() => {});
        try { checkDisk(); } catch (e) { logger.error(e); }
    }, 60 * 60 * 1000).unref();
    // Первый прогон через 2 минуты после старта
    setTimeout(() => {
        try { checkExpiring(); } catch (e) { logger.error(e); }
        disableExpired().catch(() => {});
        cleanupTestClients().catch(() => {});
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

module.exports = { start };
