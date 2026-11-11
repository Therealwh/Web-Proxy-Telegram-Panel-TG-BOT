/**
 * @fileoverview Промокоды v2: два типа — «дни» (мгновенный подарок)
 * и «скидка %» (активируется на следующую покупку), аудитория
 * «новеньким/всем», защита «1 человек — 1 раз» через promo_uses.
 * @module services/promo
 */

const db = require('../db');
const logger = require('../utils/logger');

const MAX_DAYS = 3650;

/** Генерирует читаемый код: PROMO-XXXXX (5 символов без похожих знаков). */
function generateCode(prefix = 'PROMO') {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let tail = '';
    for (let i = 0; i < 5; i++) tail += alphabet[cryptoRand(alphabet.length)];
    return `${prefix.toUpperCase()}-${tail}`;
}

/** Криптостойкий rand int [0, max). */
function cryptoRand(max) {
    return require('crypto').randomInt(0, max);
}

function getPromo(code) {
    return db.prepare('SELECT * FROM promo_codes WHERE code = ?').get(String(code || '').toUpperCase()) || null;
}

/** Сколько человек уже применили промокод. */
function usesCount(code) {
    return db.prepare('SELECT COUNT(*) AS c FROM promo_uses WHERE promo_code = ?').get(code).c;
}

/** Применял ли уже этот пользователь промокод (для one_per_user). */
function usedByUser(code, telegramId) {
    return !!db.prepare(
        'SELECT 1 FROM promo_uses WHERE promo_code = ? AND telegram_id = ?'
    ).get(code, telegramId);
}

/** Есть ли у пользователя активный прокси. */
function hasActiveProxy(telegramId) {
    return !!db.prepare(
        "SELECT 1 FROM clients WHERE telegram_id = ? AND status = 'active' LIMIT 1"
    ).get(telegramId);
}

/** Есть ли у пользователя успешные покупки (для аудитории «новеньким» на скидку). */
function hasPayments(telegramId) {
    return !!db.prepare(
        "SELECT 1 FROM payments WHERE telegram_id = ? AND status = 'success' LIMIT 1"
    ).get(telegramId);
}

/**
 * Полная проверка промокода для пользователя.
 * @returns {{ok: boolean, error?: string, promo?: object}}
 */
function validate(code, telegramId) {
    const promo = getPromo(code);
    if (!promo || !promo.enabled) return { ok: false, error: 'Промокод не найден' };
    if (promo.expires_at && new Date(promo.expires_at) < new Date()) {
        return { ok: false, error: 'Срок действия промокода истёк' };
    }
    // Лимит: считаем и журнал применений, и счётчик в самой записи
    // (used_count могли задать вручную или накопить до перехода на promo_uses)
    const used = Math.max(Number(promo.used_count) || 0, usesCount(promo.code));
    if (promo.max_uses !== null && promo.max_uses !== undefined && used >= promo.max_uses) {
        return { ok: false, error: 'Лимит применений промокода исчерпан' };
    }
    if (promo.one_per_user && usedByUser(promo.code, telegramId)) {
        return { ok: false, error: 'Вы уже применяли этот промокод' };
    }
    return { ok: true, promo };
}

/**
 * Проверка правил аудитории.
 * kind='days':  audience 'new' — у пользователя НЕТ активного прокси; 'all' — есть хотя бы один активный.
 * kind='percent': audience 'new' — у пользователя нет успешных покупок; 'all' — без ограничений.
 */
function checkAudience(promo, telegramId) {
    const isNew = promo.audience === 'new';
    if (promo.kind === 'days') {
        const has = hasActiveProxy(telegramId);
        if (isNew && has) return { ok: false, error: 'Этот промокод только для новых пользователей — у вас уже есть активный прокси' };
        if (!isNew && !has) return { ok: false, error: 'Нет активного прокси для продления — промокод для действующих пользователей' };
        return { ok: true };
    }
    const paid = hasPayments(telegramId);
    if (isNew && paid) return { ok: false, error: 'Этот промокод только для первой покупки' };
    return { ok: true };
}

/**
 * Применяет промокод-«дни»: new → создаёт прокси на N дней,
 * all → продлевает ВСЕ активные прокси пользователя на N дней.
 * Записывает использование. Вызывать после validate+checkAudience.
 * @returns {Promise<{ok, error?, created?: string, extended?: number, until?: string}>}
 */
async function applyDaysPromo(promo, telegramId) {
    const telemt = require('./telemtApi');
    const days = Math.min(MAX_DAYS, Math.max(1, Number(promo.days) || 0));
    if (!days) return { ok: false, error: 'У промокода не задано количество дней' };

    const proxies = db.prepare(
        "SELECT * FROM clients WHERE telegram_id = ? AND status = 'active'"
    ).all(telegramId);

    // Аудитория — дублируем здесь: прямой вызов мимо checkAudience не должен
    // ни создать прокси действующему, ни отказать новому без прокси
    if (promo.audience === 'new' && proxies.length > 0) {
        return { ok: false, error: 'Этот промокод только для новых пользователей' };
    }
    if (promo.audience === 'all' && proxies.length === 0) {
        return { ok: false, error: 'Нет активного прокси для продления' };
    }

    // Новенький: создаём бесплатный прокси на срок промокода
    if (promo.audience === 'new' && proxies.length === 0) {
        const count = db.prepare('SELECT COUNT(*) AS c FROM clients WHERE telegram_id = ?').get(telegramId).c;
        const username = `tg${telegramId}x${count + 1}`;
        const expires = new Date(Date.now() + days * 86400000).toISOString();
        const created = await telemt.createUser({
            username, expiration_rfc3339: expires, max_unique_ips: 2,
        });
        db.prepare(
            `INSERT INTO clients (username, secret, expires_at, telegram_id, web_enabled, mtproto_enabled, max_ips, status)
             VALUES (?, ?, ?, ?, 1, 1, 2, 'active')`
        ).run(username, created.secret, expires, telegramId);
        recordUse(promo.code, telegramId);
        logger.info('Промокод: новому пользователю создан прокси', { code: promo.code, username, days });
        return { ok: true, created: username, until: expires };
    }

    // Всем: продлеваем каждый активный прокси
    if (proxies.length === 0) return { ok: false, error: 'Нет активного прокси для продления' };
    const untils = [];
    for (const p of proxies) {
        const base = p.expires_at && new Date(p.expires_at) > new Date()
            ? new Date(p.expires_at) : new Date();
        const newExpiry = new Date(base.getTime() + days * 86400000).toISOString();
        await telemt.patchUser(p.username, { expiration_rfc3339: newExpiry }).catch(() => {});
        db.prepare("UPDATE clients SET expires_at = ?, status = 'active' WHERE id = ?").run(newExpiry, p.id);
        untils.push(newExpiry);
    }
    recordUse(promo.code, telegramId);
    logger.info('Промокод: продлены прокси', { code: promo.code, count: proxies.length, days });
    return { ok: true, extended: proxies.length, until: untils.sort().pop() };
}

/**
 * Активирует промокод-скидку: сохраняет его как «ждущий покупки».
 * @returns {{ok, error?, percent?, code?}}
 */
function activatePercent(promo, telegramId) {
    const percent = Math.max(1, Math.min(99, Number(promo.discount_percent) || 0));
    if (!percent) return { ok: false, error: 'У промокода не задан процент скидки' };
    // Фиксированная скидка тоже поддерживается: считаем её эквивалентом процента
    // по факту покупки — в платёж уходит promo_code, расчёт в showPurchaseMethods.
    db.prepare('UPDATE bot_users SET pending_promo = ? WHERE telegram_id = ?').run(promo.code, telegramId);
    logger.info('Промокод: скидка активирована', { code: promo.code, telegramId, percent });
    return { ok: true, percent, code: promo.code, discount_fixed: promo.discount_fixed || null };
}

/** Списывает применение промокода-скидки при успешной покупке. */
function consumePercent(code, telegramId) {
    const promo = getPromo(code);
    if (!promo) return;
    recordUse(code, telegramId);
    db.prepare('UPDATE bot_users SET pending_promo = NULL WHERE telegram_id = ?').run(telegramId);
    logger.info('Промокод: скидка использована', { code, telegramId });
}

/** Журналирует использование (уникальность на уровне БД). */
function recordUse(code, telegramId) {
    db.prepare(
        `INSERT INTO promo_uses (promo_code, telegram_id) VALUES (?, ?)
         ON CONFLICT(promo_code, telegram_id) DO NOTHING`
    ).run(code, telegramId);
    db.prepare('UPDATE promo_codes SET used_count = used_count + 1 WHERE code = ?').run(code);
}

/**
 * Расчёт цены с промокодом-скидкой.
 * @returns {number} итоговая цена (>= 0)
 */
function discountedPrice(price, promo) {
    let final = Number(price) || 0;
    if (promo.discount_percent) final -= final * (promo.discount_percent / 100);
    if (promo.discount_fixed) final -= Number(promo.discount_fixed);
    return Math.max(0, Math.round(final * 100) / 100);
}

module.exports = {
    generateCode, getPromo, validate, checkAudience,
    applyDaysPromo, activatePercent, consumePercent, discountedPrice,
    usesCount, usedByUser, hasActiveProxy,
};
