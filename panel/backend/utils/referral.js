/**
 * @fileoverview Реферальная программа: персональные коды-инвайты,
 * начисление процента с платежей приглашённых на баланс реферера,
 * статистика для бота и панели.
 *
 * Модель (настройки → «Партнёрская программа»):
 *  - referral_mode = 'percent' — % от каждого платежа приглашённого капает
 *    на баланс реферера (по умолчанию);
 *  - referral_mode = 'days'    — легаси: бонусные дни рефереру за покупку;
 *  - referral_mode = 'off'     — программа выключена.
 *
 * Вознаграждение в режиме 'percent' начисляется только на «живые» деньги
 * (оплата шлюзом, пополнение): покупки с внутреннего баланса повторно
 * не вознаграждаются — % уже начислен при пополнении.
 * @module utils/referral
 */

const crypto = require('crypto');
const db = require('../db');
const logger = require('./logger');

/** Настройки рефералки (лениво, чтобы не зациклить импорты). */
function refSettings() {
    try {
        const s = require('../routes/settings').getAll();
        return {
            mode: s.referral_mode || 'percent',
            percent: Number(s.referral_percent ?? 10),
        };
    } catch {
        return { mode: 'percent', percent: 10 };
    }
}

/**
 * Код-инвайт клиента: генерируется лениво при первом запросе ссылки.
 * @param {number} clientId
 * @returns {string|null} код из 8 hex-символов или null (клиента нет)
 */
function ensureReferralCode(clientId) {
    const client = db.prepare('SELECT id, referral_code FROM clients WHERE id = ?').get(clientId);
    if (!client) return null;
    if (client.referral_code) return client.referral_code;
    for (let attempt = 0; attempt < 5; attempt++) {
        const code = crypto.randomBytes(4).toString('hex'); // 8 hex-символов
        try {
            db.prepare('UPDATE clients SET referral_code = ? WHERE id = ? AND referral_code IS NULL')
                .run(code, clientId);
            return code;
        } catch (e) {
            if (!/UNIQUE/i.test(e.message)) throw e; // коллизия кода — пробуем снова
        }
    }
    // Не смогли за 5 попыток — читаем, что успело записаться
    return db.prepare('SELECT referral_code AS c FROM clients WHERE id = ?').get(clientId)?.c || null;
}

/**
 * Разбор реферальной метки payload из ?start=ref_XXX.
 * Поддерживает новые случайные коды и легаси ref_<telegram_id>.
 * @param {string} payload
 * @returns {number|null} id клиента-реферера
 */
function resolveRefPayload(payload) {
    const raw = String(payload || '');
    if (!raw.startsWith('ref_')) return null;
    const key = raw.slice(4);
    if (!key) return null;

    // Новый формат: персональный код
    const byCode = db.prepare('SELECT id FROM clients WHERE referral_code = ?').get(key);
    if (byCode) return byCode.id;

    // Легаси: ref_<telegram_id> (старые ссылки не должны умереть)
    const legacyTgId = Number(key);
    if (Number.isInteger(legacyTgId) && legacyTgId > 0) {
        const byTg = db.prepare('SELECT id FROM clients WHERE telegram_id = ?').get(legacyTgId);
        if (byTg) return byTg.id;
    }
    return null;
}

/**
 * Начисляет рефереру вознаграждение за платёж приглашённого (режим 'percent').
 * Безопасно вызывать на любом платеже: без реферера/в режиме off — просто no-op.
 * @param {object} p
 * @param {number|null} [p.referredClientId] - клиент, который заплатил
 * @param {number|null} [p.referredTgId] - его telegram_id (если клиента ещё нет)
 * @param {number} p.amount - сумма платежа
 * @param {string} [p.kind] - purchase | renewal | deposit
 * @param {string} [p.currency]
 * @returns {{credited: boolean, bonus: number, referrer: object|null}}
 */
function payReferral({ referredClientId = null, referredTgId = null, amount, kind = 'purchase', currency = '' } = {}) {
    const { mode, percent } = refSettings();
    const none = { credited: false, bonus: 0, referrer: null };
    if (mode !== 'percent' || !(percent > 0) || !(amount > 0)) return none;

    // Кто пригласил того, кто платит
    let referred = null;
    if (referredClientId) {
        referred = db.prepare('SELECT id, telegram_id, referrer_id FROM clients WHERE id = ?').get(referredClientId) || null;
    } else if (referredTgId) {
        referred = db.prepare('SELECT id, telegram_id, referrer_id FROM clients WHERE telegram_id = ?').get(referredTgId)
            || db.prepare('SELECT NULL AS id, ? AS telegram_id, referrer_id FROM referral_pending WHERE telegram_id = ?')
                .get(referredTgId, referredTgId) || null;
    }
    const referrerId = referred?.referrer_id || null;
    if (!referrerId) return none;

    const referrer = db.prepare('SELECT id, telegram_id, username FROM clients WHERE id = ?').get(referrerId);
    if (!referrer) return none;

    // Самоприглашение исключается на этапе захвата перехода — перестраховка
    if (referred?.telegram_id && referrer.telegram_id && Number(referred.telegram_id) === Number(referrer.telegram_id)) {
        return none;
    }

    // Округление до копеек: 12.345 → 12.35
    const bonus = Math.round(amount * percent) / 100;
    if (!(bonus > 0)) return { credited: false, bonus: 0, referrer };

    const { creditBalance } = require('./balance');
    if (!referrer.telegram_id || !creditBalance(referrer.telegram_id, bonus)) {
        logger.warn('Рефералка: не удалось начислить на баланс', { referrerId, bonus, kind });
        return { credited: false, bonus, referrer };
    }

    db.prepare('INSERT INTO referral_earnings (referrer_id, referred_id, amount, kind) VALUES (?, ?, ?, ?)')
        .run(referrer.id, referred?.id ?? null, bonus, kind);
    logger.info('Рефералка: начисление на баланс', { referrerId, referredId: referred?.id ?? null, bonus, kind });

    // Уведомление рефереру — вне критического пути платежа
    if (referrer.telegram_id) {
        try {
            const bot = require('../services/bot');
            if (bot.isRunning()) {
                const sign = currency === 'RUB' ? '₽' : currency === 'USD' ? '$'
                    : currency === 'EUR' ? '€' : currency === 'STAR' ? '⭐' : currency || '';
                bot.sendMessageTo(
                    referrer.telegram_id,
                    `🤝 <b>Реферальное начисление</b>\n\n` +
                    `Приглашённый оплатил — вам <b>+${bonus}${sign ? ' ' + sign : ''}</b> на баланс.\n` +
                    `Баланс доступен в «📱 Личном кабинете».`
                ).catch(() => {});
            }
        } catch { /* уведомление не критично */ }
    }

    return { credited: true, bonus, referrer };
}

/** Статистика одного реферера (для бота). */
function userStats(clientId) {
    const invited = db.prepare('SELECT COUNT(*) AS c FROM clients WHERE referrer_id = ?').get(clientId).c;
    const earned = db.prepare('SELECT COALESCE(SUM(amount),0) AS s FROM referral_earnings WHERE referrer_id = ?').get(clientId).s;
    const pending = db.prepare('SELECT COUNT(*) AS c FROM referral_pending WHERE referrer_id = ?').get(clientId).c;
    return { invited, earned, pending };
}

/** Общая статистика для страницы панели: итоги, топ-10, последние начисления. */
function adminStats() {
    const totals = {
        invited: db.prepare('SELECT COUNT(*) AS c FROM clients WHERE referrer_id IS NOT NULL').get().c,
        referrers: db.prepare('SELECT COUNT(DISTINCT referrer_id) AS c FROM clients WHERE referrer_id IS NOT NULL').get().c,
        paid_out: db.prepare('SELECT COALESCE(SUM(amount),0) AS s FROM referral_earnings').get().s,
        earnings_count: db.prepare('SELECT COUNT(*) AS c FROM referral_earnings').get().c,
    };
    const top = db.prepare(`
        SELECT r.id, r.username, r.telegram_id,
               COUNT(c.id) AS invited,
               COALESCE((SELECT SUM(e.amount) FROM referral_earnings e WHERE e.referrer_id = r.id), 0) AS earned
        FROM clients r
        JOIN clients c ON c.referrer_id = r.id
        GROUP BY r.id
        ORDER BY earned DESC, invited DESC
        LIMIT 10
    `).all();
    const recent = db.prepare(`
        SELECT e.id, e.amount, e.kind, e.created_at,
               r.username AS referrer_username,
               cl.username AS referred_username
        FROM referral_earnings e
        JOIN clients r ON r.id = e.referrer_id
        LEFT JOIN clients cl ON cl.id = e.referred_id
        ORDER BY e.id DESC
        LIMIT 20
    `).all();
    return { totals, top, recent };
}

module.exports = { ensureReferralCode, resolveRefPayload, payReferral, userStats, adminStats };
