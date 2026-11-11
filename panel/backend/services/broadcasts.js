/**
 * @fileoverview Массовые рассылки из панели: текст (HTML) + опциональная
 * картинка, цели (все / активные / истёкшие / без прокси), отложенный запуск
 * по времени МСК. Отправка идёт последовательно с лимитом скорости Telegram.
 * @module services/broadcasts
 */

const fs = require('fs');
const path = require('path');
const db = require('../db');
const config = require('../config');
const logger = require('../utils/logger');

const BROADCAST_DIR = path.join(config.dataDir, 'broadcast');
/** Пауза между сообщениями: ~20 сообщений/сек — безопасно для Bot API. */
const SEND_DELAY_MS = 50;

let running = false; // одновременно уходит одна рассылка

/** Готовит каталог под картинки рассылок. */
function ensureDir() {
    fs.mkdirSync(BROADCAST_DIR, { recursive: true });
}

/**
 * Получатели по цели рассылки.
 * @param {'all'|'active'|'expired'|'noproxy'} target
 * @returns {number[]}
 */
function recipients(target) {
    if (target === 'active') {
        return db.prepare(
            `SELECT DISTINCT telegram_id FROM clients
             WHERE telegram_id IS NOT NULL AND status = 'active'`
        ).all().map((r) => r.telegram_id);
    }
    if (target === 'expired') {
        return db.prepare(
            `SELECT DISTINCT telegram_id FROM clients
             WHERE telegram_id IS NOT NULL AND status IN ('expired', 'blocked')`
        ).all().map((r) => r.telegram_id);
    }
    if (target === 'noproxy') {
        return db.prepare(
            `SELECT telegram_id FROM bot_users
             WHERE telegram_id NOT IN (SELECT DISTINCT telegram_id FROM clients WHERE telegram_id IS NOT NULL)`
        ).all().map((r) => r.telegram_id);
    }
    // all: все, кто взаимодействовал с ботом + все владельцы прокси
    return db.prepare(
        `SELECT DISTINCT telegram_id FROM (
            SELECT telegram_id FROM bot_users WHERE telegram_id IS NOT NULL
            UNION
            SELECT telegram_id FROM clients WHERE telegram_id IS NOT NULL
        ) WHERE telegram_id IS NOT NULL`
    ).all().map((r) => r.telegram_id);
}

/**
 * Запускает рассылку (фоново, не блокирует вызывателя).
 * @param {number} id - id рассылки в БД
 */
function startBroadcast(id) {
    if (running) {
        logger.warn('Рассылка уже идёт — запуск отложен', { id });
        setTimeout(() => startBroadcast(id), 60 * 1000);
        return;
    }
    running = true;
    runBroadcast(id).catch((e) => logger.error('Рассылка: ошибка выполнения', { id, error: e.message }))
        .finally(() => { running = false; });
}

/** Тело рассылки: последовательно отправляет сообщения получателям. */
async function runBroadcast(id) {
    const bot = require('./bot');
    if (!bot.isRunning()) {
        db.prepare("UPDATE broadcasts SET status = 'failed' WHERE id = ?").run(id);
        logger.error('Рассылка отменена — бот не запущен', { id });
        return;
    }
    const row = db.prepare('SELECT * FROM broadcasts WHERE id = ?').get(id);
    if (!row || row.status !== 'pending') return;

    const recipientsList = recipients(row.target);
    db.prepare(
        "UPDATE broadcasts SET status = 'sending', total_count = ?, sent_count = 0, fail_count = 0 WHERE id = ?"
    ).run(recipientsList.length, id);
    logger.info('Рассылка начата', { id, recipients: recipientsList.length, hasImage: !!row.image_path });

    const api = bot.getApi();
    let sent = 0, fails = 0, fileIdCached = row.image_file_id || null;

    for (const tgId of recipientsList) {
        try {
            if (row.image_path && fs.existsSync(row.image_path)) {
                const payload = {
                    caption: row.text, parse_mode: 'HTML',
                    ...(fileIdCached ? { photo: fileIdCached } : { photo: new (require('grammy').InputFile)(row.image_path) }),
                };
                const msg = await api.sendPhoto(tgId, payload.photo, {
                    caption: payload.caption, parse_mode: 'HTML',
                });
                if (!fileIdCached) {
                    const ph = msg?.photo?.[msg.photo.length - 1]?.file_id;
                    if (ph) {
                        fileIdCached = ph;
                        db.prepare('UPDATE broadcasts SET image_file_id = ? WHERE id = ?').run(ph, id);
                    }
                }
            } else {
                await api.sendMessage(tgId, row.text, { parse_mode: 'HTML' });
            }
            sent += 1;
        } catch (e) {
            fails += 1;
            logger.warn('Рассылка: доставка не удалась', { id, tgId, error: e.message });
        }
        if ((sent + fails) % 25 === 0) {
            db.prepare('UPDATE broadcasts SET sent_count = ?, fail_count = ? WHERE id = ?').run(sent, fails, id);
        }
        await new Promise((r) => setTimeout(r, SEND_DELAY_MS));
    }

    db.prepare(
        "UPDATE broadcasts SET status = 'sent', sent_count = ?, fail_count = ?, sent_at = datetime('now') WHERE id = ?"
    ).run(sent, fails, id);
    logger.info('Рассылка завершена', { id, sent, fails });
}

/** Отложенные рассылки: запускает те, чей срок наступил (вызывается раз в минуту). */
function checkScheduled() {
    try {
        const due = db.prepare(
            `SELECT id FROM broadcasts
             WHERE status = 'pending' AND scheduled_at IS NOT NULL AND scheduled_at <= datetime('now')`
        ).all();
        for (const r of due) startBroadcast(r.id);
    } catch (e) {
        logger.warn('Рассылки: ошибка планировщика', { error: e.message });
    }
}

/** Удаляет файл картинки рассылки. */
function removeImage(id) {
    const row = db.prepare('SELECT image_path FROM broadcasts WHERE id = ?').get(id);
    if (row?.image_path) {
        try { fs.unlinkSync(row.image_path); } catch { /* уже нет */ }
    }
}

module.exports = { startBroadcast, checkScheduled, removeImage, recipients, ensureDir, BROADCAST_DIR };
