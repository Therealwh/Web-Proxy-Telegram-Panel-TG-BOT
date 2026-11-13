/**
 * @fileoverview Промокоды v3: два типа — «дни» (мгновенный подарок)
 * и «скидка %» (активируется на следующую покупку), аудитории
 * «новеньким / стареньким / всем», защита «1 человек — 1 раз» через
 * promo_uses, выбор прокси при продлении (targetClientId).
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

/**
 * Есть ли у пользователя КУПЛЕННЫЙ прокси (любого статуса).
 * Тестовые (test<tgId>) не считаются — они бесплатны и не признак «старенького».
 */
function hasBoughtProxy(telegramId) {
    return !!db.prepare(
        "SELECT 1 FROM clients WHERE telegram_id = ? AND username NOT GLOB 'test[0-9]*' LIMIT 1"
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
 * kind='days':
 *   'new' — у пользователя НЕТ активного прокси;
 *   'all' — есть хотя бы один активный;
 *   'old' — есть купленный прокси (активный или истёкший, тесты не считаются).
 * kind='percent':
 *   'new' — нет успешных покупок;
 *   'all' — без ограничений;
 *   'old' — есть хотя бы один купленный клиент в панели.
 */
function checkAudience(promo, telegramId) {
    const isNew = promo.audience === 'new';
    const isOld = promo.audience === 'old';
    if (promo.kind === 'days') {
        const has = hasActiveProxy(telegramId);
        if (isNew && has) return { ok: false, error: 'Этот промокод только для новых пользователей — у вас уже есть активный прокси' };
        if (isOld) {
            if (!hasBoughtProxy(telegramId)) {
                return { ok: false, error: 'Этот промокод для «стареньких» — у кого уже есть купленный прокси' };
            }
            return { ok: true };
        }
        if (!isNew && !has) return { ok: false, error: 'Нет активного прокси для продления — промокод для действующих пользователей' };
        return { ok: true };
    }
    const paid = hasPayments(telegramId);
    if (isNew && paid) return { ok: false, error: 'Этот промокод только для первой покупки' };
    if (isOld && !hasBoughtProxy(telegramId)) {
        return { ok: false, error: 'Этот промокод для «стареньких» — у кого уже есть купленный прокси' };
    }
    return { ok: true };
}

/**
 * Прокси-кандидаты для days-промокода (для экрана выбора в боте).
 * 'new' → пусто (создаётся новый прокси);
 * 'all' → активные прокси (как раньше продлевались все);
 * 'old' → купленные прокси любого статуса (истёкшие продлятся и активируются).
 * @returns {Array<{id, username, expires_at, status}>}
 */
function daysPromoTargets(promo, telegramId) {
    if (!promo || promo.kind !== 'days' || promo.audience === 'new') return [];
    if (promo.audience === 'old') {
        return db.prepare(
            "SELECT id, username, expires_at, status FROM clients WHERE telegram_id = ? AND username NOT GLOB 'test[0-9]*' ORDER BY id"
        ).all(telegramId);
    }
    return db.prepare(
        "SELECT id, username, expires_at, status FROM clients WHERE telegram_id = ? AND status = 'active' ORDER BY id"
    ).all(telegramId);
}

/**
 * Применяет промокод-«дни»:
 *   new → создаёт прокси на N дней;
 *   all → продлевает ВСЕ активные прокси (или один — если задан targetClientId);
 *   old → продлевает купленные прокси (активные и истёкшие; истёкший
 *         продлевается и активируется; тестовые не трогаем).
 * Записывает использование. Вызывать после validate+checkAudience.
 * @param {object} promo - запись промокода
 * @param {number} telegramId
 * @param {number|null} [targetClientId] - продлить только этот прокси
 *   (выбор в боте, когда у пользователя несколько). Должен принадлежать
 *   пользователю и входить в набор аудитории — иначе отказ.
 * @returns {Promise<{ok, error?, created?: string, extended?: number, until?: string, target?: string}>}
 */
async function applyDaysPromo(promo, telegramId, targetClientId = null) {
    const telemt = require('./telemtApi');
    const nodesService = require('./nodes');
    const days = Math.min(MAX_DAYS, Math.max(1, Number(promo.days) || 0));
    if (!days) return { ok: false, error: 'У промокода не задано количество дней' };

    // Аудитория — дублируем здесь: прямой вызов мимо checkAudience не должен
    // ни создать прокси действующему, ни отказать новому без прокси
    if (promo.audience === 'new') {
        const active = db.prepare(
            "SELECT COUNT(*) AS c FROM clients WHERE telegram_id = ? AND status = 'active'"
        ).get(telegramId).c;
        if (active > 0) return { ok: false, error: 'Этот промокод только для новых пользователей' };
    }
    const isOld = promo.audience === 'old';
    const proxies = isOld
        ? db.prepare(
            "SELECT * FROM clients WHERE telegram_id = ? AND username NOT GLOB 'test[0-9]*' ORDER BY id"
        ).all(telegramId)
        : db.prepare(
            "SELECT * FROM clients WHERE telegram_id = ? AND status = 'active' ORDER BY id"
        ).all(telegramId);
    if (isOld && proxies.length === 0) {
        return { ok: false, error: 'Нет купленного прокси для продления' };
    }
    if (promo.audience === 'all' && proxies.length === 0) {
        return { ok: false, error: 'Нет активного прокси для продления' };
    }

    // Выбор конкретного прокси: только свой и только из набора аудитории
    let targets = proxies;
    if (targetClientId != null) {
        targets = proxies.filter((p) => p.id === Number(targetClientId));
        if (targets.length === 0) {
            return { ok: false, error: 'Этот прокси нельзя продлить этим промокодом' };
        }
    }

    // Резервируем использование ДО сетевых вызовов (TOCTOU: два параллельных
    // применения проходят валидацию до записи). При неудаче — откат.
    if (!recordUse(promo.code, telegramId)) {
        return { ok: false, error: 'Вы уже применяли этот промокод' };
    }
    if (promo.max_uses !== null && promo.max_uses !== undefined && usesCount(promo.code) > promo.max_uses) {
        rollbackUse(promo.code, telegramId);
        return { ok: false, error: 'Лимит применений промокода исчерпан' };
    }

    try {
        // Новенький: создаём бесплатный прокси на срок промокода
        if (promo.audience === 'new' && proxies.length === 0) {
            const count = db.prepare('SELECT COUNT(*) AS c FROM clients WHERE telegram_id = ?').get(telegramId).c;
            const expires = new Date(Date.now() + days * 86400000).toISOString();
            let username = `tg${telegramId}x${count + 1}`;
            let created = null;
            for (let attempt = 0; attempt < 25; attempt++) {
                try {
                    created = await telemt.createUser({
                        username, expiration_rfc3339: expires, max_unique_ips: 2,
                    });
                    break;
                } catch (e) {
                    if (/already exists/i.test(e.message)) {
                        attempt += 1;
                        username = `tg${telegramId}x${count + 1 + attempt}`;
                        continue;
                    }
                    throw e;
                }
            }
            if (!created) throw new Error('Не удалось подобрать имя для нового прокси');
            db.prepare(
                `INSERT INTO clients (username, secret, expires_at, telegram_id, web_enabled, mtproto_enabled, max_ips, status)
                 VALUES (?, ?, ?, ?, 1, 1, 2, 'active')`
            ).run(username, created.secret, expires, telegramId);
            logger.info('Промокод: новому пользователю создан прокси', { code: promo.code, username, days });
            return { ok: true, created: username, until: expires };
        }

        // Продлеваем каждый целевой прокси (на узле конкретного прокси).
        // Истёкшие (аудитория 'old') продлеваются и активируются заново.
        const untils = [];
        for (const p of targets) {
            const base = p.expires_at && new Date(p.expires_at) > new Date()
                ? new Date(p.expires_at) : new Date();
            const newExpiry = new Date(base.getTime() + days * 86400000).toISOString();
            await nodesService.getApiForClient(p).patchUser(p.username, { expiration_rfc3339: newExpiry }).catch(() => {});
            db.prepare("UPDATE clients SET expires_at = ?, status = 'active' WHERE id = ?").run(newExpiry, p.id);
            untils.push(newExpiry);
        }
        logger.info('Промокод: продлены прокси', { code: promo.code, count: targets.length, days, audience: promo.audience });
        return {
            ok: true,
            extended: targets.length,
            until: untils.sort().pop(),
            target: targets.length === 1 ? targets[0].username : undefined,
        };
    } catch (e) {
        // Откат резерва: применение не состоялось
        rollbackUse(promo.code, telegramId);
        throw e;
    }
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
    // Снимаем pending ТОЛЬКО если он соответствует промокоду (не чужой активации)
    db.prepare('UPDATE bot_users SET pending_promo = NULL WHERE telegram_id = ? AND pending_promo = ?')
        .run(telegramId, code);
    recordUse(code, telegramId);
    logger.info('Промокод: скидка использована', { code, telegramId });
}

/** Откат резерва использования (применение не состоялось). */
function rollbackUse(code, telegramId) {
    db.prepare('DELETE FROM promo_uses WHERE promo_code = ? AND telegram_id = ?').run(code, telegramId);
    db.prepare('UPDATE promo_codes SET used_count = MAX(0, used_count - 1) WHERE code = ?').run(code);
}

/** Журналирует использование (уникальность на уровне БД). */
function recordUse(code, telegramId) {
    // Инкремент used_count только при фактической вставке (повторный вызов
    // не должен накручивать счётчик)
    const r = db.prepare(
        `INSERT INTO promo_uses (promo_code, telegram_id) VALUES (?, ?)
         ON CONFLICT(promo_code, telegram_id) DO NOTHING`
    ).run(code, telegramId);
    if (r.changes > 0) {
        db.prepare('UPDATE promo_codes SET used_count = used_count + 1 WHERE code = ?').run(code);
    }
    return r.changes > 0;
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
    daysPromoTargets, applyDaysPromo, activatePercent, consumePercent, discountedPrice,
    usesCount, usedByUser, hasActiveProxy, hasBoughtProxy,
};
