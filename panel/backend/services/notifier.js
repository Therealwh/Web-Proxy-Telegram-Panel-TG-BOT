/**
 * @fileoverview Уведомления администратору в Telegram и отправка
 * QR/ссылок клиентам. Использует Bot API напрямую через fetch.
 * @module services/notifier
 */

const QRCode = require('qrcode');
const config = require('../config');
const { clientLinks } = require('./links');
const logger = require('../utils/logger');

/**
 * Отправляет сообщение через Telegram Bot API.
 * @param {string} token - токен бота
 * @param {number|string} chatId - chat id получателя
 * @param {string} text - текст (HTML)
 * @param {object} [extra] - дополнительные поля (reply_markup и т.п.)
 */
async function sendMessage(token, chatId, text, extra = {}) {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML', ...extra }),
        signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(`Telegram API: ${body.description || res.status}`);
    }
}

/**
 * Отправляет фото (QR) через Bot API.
 * @param {string} token
 * @param {number|string} chatId
 * @param {Buffer} photo - PNG-буфер
 * @param {string} [caption]
 */
async function sendPhoto(token, chatId, photo, caption) {
    const form = new FormData();
    form.append('chat_id', String(chatId));
    form.append('caption', caption || '');
    form.append('photo', new Blob([photo], { type: 'image/png' }), 'qr.png');
    const res = await fetch(`https://api.telegram.org/bot${token}/sendPhoto`, {
        method: 'POST',
        body: form,
        signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) throw new Error('Не удалось отправить QR в Telegram');
}

/**
 * Уведомление админу (настройки: tg_bot_token + tg_admin_chat_id).
 * Тихо игнорируется, если не настроено.
 * @param {object} settings - настройки панели
 * @param {string} text - текст сообщения
 */
async function notifyAdmin(settings, text) {
    if (!settings.tg_bot_token || !settings.tg_admin_chat_id) return;
    try {
        await sendMessage(settings.tg_bot_token, settings.tg_admin_chat_id, text);
    } catch (err) {
        logger.warn('Не удалось отправить уведомление админу в TG', { error: err.message });
    }
}

/**
 * Отправляет клиенту QR-коды обоих протоколов.
 * Токен берётся из настроек бота продаж (tg_bot_token).
 * @param {object} client - клиент из БД (нужен telegram_id)
 * @param {string} maskDomain
 */
async function sendQrToClient(client, maskDomain) {
    const db = require('../db');
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get('tg_bot_token');
    const token = row ? JSON.parse(row.value) : null;
    if (!token) throw new Error('Не настроен токен Telegram-бота (Настройки → Уведомления)');

    const links = clientLinks(client, maskDomain);
    if (links.web) {
        const png = await QRCode.toBuffer(links.web, { width: 512 });
        await sendPhoto(token, client.telegram_id, png, '🌐 Web Proxy — наведите камеру или нажмите на ссылку:\n' + links.web_https);
    }
    if (links.mtproto) {
        const png = await QRCode.toBuffer(links.mtproto, { width: 512 });
        await sendPhoto(token, client.telegram_id, png, '🔌 MTProto — наведите камеру или нажмите на ссылку:\n' + links.mtproto_https);
    }
}

module.exports = { sendMessage, sendPhoto, notifyAdmin, sendQrToClient };
