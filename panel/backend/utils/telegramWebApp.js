/**
 * @fileoverview Проверка подписи Telegram WebApp (initData).
 * Мини-апп открывается из Telegram с initData, подписанной ботом: сверяем
 * HMAC-SHA256 с секретом, выведенным из токена бота — так пользователь
 * авторизуется без пароля, а подделать запрос нельзя.
 * @module utils/telegramWebApp
 */

const crypto = require('crypto');

/** Свежесть initData: старше суток не принимаем (анти-реплей). */
const MAX_AGE_SEC = 24 * 60 * 60;

/**
 * Валидирует initData из Telegram WebApp.
 * @param {string} initData - строка query-формата от Telegram.WebApp.initData
 * @param {string} botToken - токен того бота, из которого открыт мини-апп
 * @returns {{id:number, first_name?:string, username?:string}|null}
 *          пользователь Telegram или null (подпись/свежесть не сошлись)
 */
function validateInitData(initData, botToken, maxAgeSec = MAX_AGE_SEC) {
    if (!initData || !botToken) return null;

    // data-check-string: все поля кроме hash, отсортированные, через \n
    const params = new URLSearchParams(String(initData));
    const hash = params.get('hash');
    if (!hash) return null;
    params.delete('hash');

    const dataCheckString = [...params.entries()]
        .map(([k, v]) => `${k}=${v}`)
        .sort()
        .join('\n');

    const secret = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
    const computed = crypto.createHmac('sha256', secret).update(dataCheckString).digest('hex');
    if (computed !== hash) return null;

    // Анти-реплей: initData старше суток не доверяем
    const authDate = Number(params.get('auth_date'));
    if (!Number.isInteger(authDate) || Date.now() / 1000 - authDate > maxAgeSec) return null;

    let user = null;
    try { user = JSON.parse(params.get('user') || 'null'); } catch { return null; }
    if (!user || !Number.isInteger(user.id) || user.id <= 0) return null;
    return user;
}

module.exports = { validateInitData };
