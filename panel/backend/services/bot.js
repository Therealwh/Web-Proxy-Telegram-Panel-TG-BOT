/**
 * @fileoverview Telegram-бот продаж TGGATE (grammY) с админ-панелью.
 *
 * Порядок регистрации middleware строгий:
 *   1. Гейт обязательной подписки на канал (первым!)
 *   2. Кнопка проверки подписки
 *   3. Все остальные хендлеры
 *
 * Покупка: выбор способа (баланс / CryptoBot / ЮKassa / карта админа),
 * ленивое создание инвойса, чек админу, рефералка, личный кабинет.
 * @module services/bot
 */

const { Bot, InlineKeyboard, Keyboard } = require('grammy');
const db = require('../db');
const telemt = require('./telemtApi');
const { clientLinks } = require('./links');
const { getAll } = require('../routes/settings');
const logger = require('../utils/logger');

/** @type {Bot|null} */
let bot = null;

// Реферальные переходы: tgId -> id клиента-реферера (RAM + referral_pending в БД)
const refPending = new Map();
// Состояние рассылки: tgId админа -> true (ждём текст)
const broadcastState = new Map();
// Ожидание чека: tgId -> paymentId
const receiptState = new Map();
// Ожидание своей суммы пополнения: tgId -> true
const depositCustom = new Map();

/** Юзернейм поддержки. */
const SUPPORT_USERNAME = '@tggatetopsupport';

/** Красивое приветствие по умолчанию (меняется в панели). */
const DEFAULT_WELCOME =
    `👋 <b>Привет, {имя}!</b>\n\n` +
    `🚀 <b>TGGATE</b> — быстрый и стабильный прокси для Telegram\n` +
    `⚡️ Высокая скорость · 🌍 Работает всегда · 🔒 Полная приватность\n\n` +
    `👇 <b>Выбери тариф</b> — доступ откроется сразу после оплаты:`;

/** Подставляет переменные {имя}, {ссылка}, {дата}. */
function renderTemplate(text, vars = {}) {
    return String(text || '')
        .replaceAll('{имя}', vars.name || '')
        .replaceAll('{ссылка}', vars.link || '')
        .replaceAll('{дата}', vars.date || '');
}

/** Знак валюты. */
function currencySign(code) {
    return { RUB: '₽', USD: '$', EUR: '€', USDT: '₮' }[code] || code;
}

/**
 * Формат времени по Москве с точностью до секунды.
 * Пример: 20.09.26 15:34:39 МСК
 */
function fmtMSK(date) {
    return new Date(date).toLocaleString('ru-RU', {
        timeZone: 'Europe/Moscow',
        day: '2-digit', month: '2-digit', year: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
    }) + ' МСК';
}

/** Клавиатура с тарифами: кнопки открывают описание (info), плюс кастомные кнопки из панели. */
function tariffsKeyboard() {
    const settings = getBotSettings();
    const tariffs = db.prepare('SELECT * FROM tariffs WHERE enabled = 1 ORDER BY days').all();
    const kb = new InlineKeyboard();
    for (const t of tariffs) {
        kb.text(`${t.name} — ${t.price} ${currencySign(t.currency)}`, `info:${t.id}`).row();
    }
    kb.text('📱 Мой доступ', 'my').row();
    kb.text('💬 Поддержка', 'support').row();
    for (const b of settings.custom_buttons || []) {
        if (b.enabled !== false && b.name && b.url) kb.url(b.name.slice(0, 64), b.url).row();
    }
    return kb;
}

/** Красивое автогенерируемое описание тарифа. */
function tariffDescription(t) {
    const proto = t.protocols === 'web' ? '🌐 Web Proxy'
        : t.protocols === 'mtproto' ? '🔌 MTProto'
        : '🌐 Web Proxy + 🔌 MTProto';
    const ips = t.max_ips
        ? `👥 Одновременных подключений: <b>${t.max_ips} IP</b>`
        : '👥 Одновременных подключений: <b>без ограничений</b>';
    const quota = t.quota_gb
        ? `📊 Трафик: <b>${t.quota_gb} ГБ</b>`
        : '📊 Трафик: <b>без ограничений</b>';
    return (
        `📦 <b>${t.name}</b>\n\n` +
        `⏱ Срок: <b>${t.days} дн.</b>\n` +
        `${proto}\n${ips}\n${quota}\n` +
        `💵 Цена: <b>${t.price} ${currencySign(t.currency)}</b>`
    );
}

/** Проверяет, что пользователь — админ. */
function isAdmin(ctx) {
    const settings = getAll();
    const adminId = Number(settings.tg_admin_chat_id) || null;
    return adminId !== null && ctx.from?.id === adminId;
}

/** Reply-клавиатура снизу (постоянная). */
function mainReplyKeyboard(ctx) {
    const kb = new Keyboard().resized().persistent()
        .text('🚀 Тарифы').row()
        .text('🎁 Тест 3 часа').text('📱 Личный кабинет').row()
        .text('🤝 Рефералы').text('🛟 Поддержка').row();
    if (isAdmin(ctx)) kb.text('👑 Админ-панель').row();
    return kb;
}

/** Мини-дашборд для админа. */
function adminStatsText() {
    const users = db.prepare('SELECT COUNT(*) AS c FROM clients').get().c;
    const active = db.prepare("SELECT COUNT(*) AS c FROM clients WHERE status = 'active'").get().c;
    const online = db.prepare(
        "SELECT COUNT(DISTINCT username) AS c FROM connection_logs WHERE datetime(created_at) >= datetime('now', '-5 minutes')"
    ).get().c;
    const revenueToday = db.prepare(
        "SELECT COALESCE(SUM(amount),0) AS s FROM payments WHERE status = 'success' AND date(paid_at) = date('now')"
    ).get().s;
    const revenueMonth = db.prepare(
        "SELECT COALESCE(SUM(amount),0) AS s FROM payments WHERE status = 'success' AND paid_at >= datetime('now','-30 days')"
    ).get().s;
    const salesTotal = db.prepare("SELECT COUNT(*) AS c FROM payments WHERE status = 'success'").get().c;
    const pending = db.prepare("SELECT COUNT(*) AS c FROM payments WHERE status = 'pending'").get().c;

    return (
        `📊 <b>Дашборд TGGATE</b>\n\n` +
        `👥 Клиентов: <b>${users}</b> (активных: ${active})\n` +
        `🟢 Онлайн за 5 мин: <b>${online}</b>\n\n` +
        `💰 Доход сегодня: <b>${revenueToday}</b>\n` +
        `📈 Доход за 30 дней: <b>${revenueMonth}</b>\n` +
        `🧾 Продаж всего: <b>${salesTotal}</b>\n` +
        `⏳ Ожидают оплаты: <b>${pending}</b>`
    );
}

function adminKeyboard() {
    const kb = new InlineKeyboard();
    kb.text('👥 Клиенты', 'admin:clients').text('💰 Платежи', 'admin:payments').row();
    kb.text('📢 Рассылка', 'admin:broadcast').row();
    kb.text('📊 Обновить', 'admin:stats');
    return kb;
}

/** Текст кабинета + клавиатура. */
function cabinetView(ctx) {
    const clients = db.prepare(
        'SELECT * FROM clients WHERE telegram_id = ? ORDER BY id'
    ).all(ctx.from.id);
    const balance = clients.reduce((s, c) => s + (c.balance || 0), 0);

    if (clients.length === 0) {
        const kb = new InlineKeyboard().text('🚀 Выбрать тариф', 'tariffs').row()
            .text('🎁 Тест 3 часа', 'test3');
        return { text: '📱 <b>Личный кабинет</b>\n\nУ вас пока нет прокси.\nВыберите тариф или возьмите бесплатный тест!', kb };
    }

    let text = `📱 <b>Личный кабинет</b>\n💰 Баланс: <b>${balance.toFixed(2)}</b>\n\n<b>Мои прокси:</b>\n`;
    const kb = new InlineKeyboard();
    const maskDomain = getAll().mask_domain;
    for (const c of clients) {
        const until = c.expires_at ? fmtMSK(c.expires_at, false) : '∞';
        const icon = c.status === 'active' ? '🟢' : '🔴';
        text += `${icon} <b>${c.username}</b> — до ${until}\n`;
        const links = clientLinks(c, maskDomain);
        if (links.web_https) kb.url('🌐 Подключить ВЕБ прокси', links.web_https);
        if (links.mtproto_https) kb.url('🔌 Подключить MTProto прокси', links.mtproto_https);
        if (links.web_https || links.mtproto_https) kb.row();
        kb.text(`♻️ Продлить: ${c.username}`, `renew:${c.id}`).row();
    }
    kb.text('💳 Пополнить счёт', 'topup').row();
    kb.text('🚀 Тарифы', 'tariffs');
    return { text, kb };
}

function renewKeyboard(clientId, mode) {
    let tariffs = db.prepare('SELECT * FROM tariffs WHERE enabled = 1 ORDER BY days').all();
    if (mode === 'web' || mode === 'mtproto' || mode === 'both') {
        tariffs = tariffs.filter((t) => t.protocols === mode);
    }
    const kb = new InlineKeyboard();
    for (const t of tariffs) {
        kb.text(`${t.name} — ${t.days} дн. — ${t.price} ${currencySign(t.currency)}`,
            `renewpay:${clientId}:${t.id}${mode ? `:${mode}` : ''}`).row();
    }
    kb.text('⬅️ Назад', 'cabinet');
    return kb;
}

/** Общий баланс пользователя. */
function totalBalance(tgId) {
    return db.prepare('SELECT COALESCE(SUM(balance),0) AS b FROM clients WHERE telegram_id = ?').get(tgId).b;
}

/** Списание с баланса (по клиентам, от большего остатка). */
function deductBalance(tgId, amount) {
    let left = amount;
    const rows = db.prepare(
        'SELECT id, balance FROM clients WHERE telegram_id = ? AND balance > 0 ORDER BY balance DESC'
    ).all(tgId);
    for (const c of rows) {
        if (left <= 0) break;
        const take = Math.min(c.balance, left);
        db.prepare('UPDATE clients SET balance = balance - ? WHERE id = ?').run(take, c.id);
        left -= take;
    }
}

/**
 * Выдаёт доступ покупателю по telegram_id (вебхуки оплаты, баланс, админка).
 * Каждая покупка создаёт НОВЫЙ прокси. Начисляет реферальный бонус.
 */
async function issueAccessFor(tgId, tariff, paymentId) {
    const settings = getAll();
    const expires = new Date(Date.now() + tariff.days * 86400000).toISOString();

    const count = db.prepare('SELECT COUNT(*) AS c FROM clients WHERE telegram_id = ?').get(tgId).c;
    const username = `tg${tgId}x${count + 1}`;
    const referrerId = refPending.get(tgId)
        || db.prepare('SELECT referrer_id FROM referral_pending WHERE telegram_id = ?').get(tgId)?.referrer_id
        || null;

    const created = await telemt.createUser({ username, expiration_rfc3339: expires });
    const result = db.prepare(
        `INSERT INTO clients (username, secret, expires_at, telegram_id, web_enabled, mtproto_enabled, referrer_id)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(
        username, created.secret, expires, tgId,
        ['web', 'both'].includes(tariff.protocols) ? 1 : 0,
        ['mtproto', 'both'].includes(tariff.protocols) ? 1 : 0,
        referrerId
    );
    const client = db.prepare('SELECT * FROM clients WHERE id = ?').get(result.lastInsertRowid);
    refPending.delete(tgId);
    db.prepare('DELETE FROM referral_pending WHERE telegram_id = ?').run(tgId);

    if (paymentId) {
        db.prepare("UPDATE payments SET status = 'success', paid_at = datetime('now') WHERE id = ?").run(paymentId);
    }

    const links = clientLinks(client, settings.mask_domain);
    let text =
        `🎉 <b>Оплата прошла! Прокси готов</b>\n\n` +
        `📦 Прокси: <b>${username}</b>\n📅 Действует до: <b>${fmtMSK(expires)}</b>\n\n`;
    if (links.web_https) text += `🌐 <b>Web Proxy</b> (нажми — подключится сам):\n${links.web_https}\n\n`;
    if (links.mtproto_https) text += `🔌 <b>MTProto</b>:\n${links.mtproto_https}\n\n`;
    text += `💡 Управление прокси — в разделе «📱 Личный кабинет».`;

    if (bot) {
        await bot.api.sendMessage(tgId, text, { parse_mode: 'HTML', disable_web_page_preview: true })
            .catch((e) => logger.warn('Не удалось отправить ссылки покупателю', { tgId, error: e.message }));
    }

    const notifier = require('./notifier');
    notifier.notifyAdmin(settings,
        `💰 <b>Новая продажа!</b>\n📦 ${tariff.name} — ${tariff.price} ${currencySign(tariff.currency)}\n👤 ${username}`
    ).catch(() => {});

    payReferralBonus(client.id, tariff.days).catch((e) =>
        logger.warn('Не удалось начислить реферальный бонус', { error: e.message }));

    return client;
}

/** Реферальный бонус: 30+ дней → +10; 60+ → +25% срока. */
async function payReferralBonus(clientId, purchasedDays) {
    const client = db.prepare('SELECT referrer_id FROM clients WHERE id = ?').get(clientId);
    if (!client?.referrer_id) return;
    const referrer = db.prepare('SELECT * FROM clients WHERE id = ?').get(client.referrer_id);
    if (!referrer) return;

    let bonus = 0;
    if (purchasedDays >= 60) bonus = Math.ceil(purchasedDays * 0.25);
    else if (purchasedDays >= 30) bonus = 10;
    if (bonus <= 0) return;

    const base = referrer.expires_at && new Date(referrer.expires_at) > new Date()
        ? new Date(referrer.expires_at) : new Date();
    const newExpiry = new Date(base.getTime() + bonus * 86400000).toISOString();
    await telemt.patchUser(referrer.username, { expiration_rfc3339: newExpiry }).catch(() => {});
    db.prepare("UPDATE clients SET expires_at = ?, status = 'active' WHERE id = ?")
        .run(newExpiry, referrer.id);

    if (referrer.telegram_id && bot) {
        await bot.api.sendMessage(
            referrer.telegram_id,
            `🎁 <b>Бонус за реферала!</b>\n\nДруг купил прокси на ${purchasedDays} дн. — вам <b>+${bonus} дней</b>.\n\n${referrer.username}: до ${fmtMSK(newExpiry, false)}`,
            { parse_mode: 'HTML' }
        ).catch(() => {});
    }
}

/** Уведомление о пополнении баланса. */
async function notifyDeposit(tgId, amount) {
    if (!bot) return;
    await bot.api.sendMessage(
        tgId,
        `💰 <b>Баланс пополнен на ${amount}!</b>\nПродлить прокси можно в «📱 Личный кабинет».`,
        { parse_mode: 'HTML' }
    ).catch(() => {});
}

/** Отправка произвольного сообщения пользователю (админка в панели). */
async function sendMessageTo(tgId, text) {
    if (!bot) throw new Error('Бот не запущен — включите его в настройках');
    if (!text.startsWith('<')) text = `<b>${text}</b>`;
    await bot.api.sendMessage(tgId, text, { parse_mode: 'HTML' })
        .catch((e) => { throw new Error(`Telegram: ${e.message}`); });
}

/** Проверка подписки на обязательный канал. */
async function checkSubscription(ctx) {
    const s = getBotSettings();
    if (!s.channel_required || !s.channel_username) return true;
    if (isAdmin(ctx)) return true;
    const userId = ctx.from?.id;
    if (!userId) return true;
    try {
        const m = await bot.api.getChatMember(s.channel_username, userId);
        return ['creator', 'administrator', 'member'].includes(m.status);
    } catch {
        return true; // бот не видит канал — не блокируем
    }
}

/** Экран «подпишитесь на канал». */
function subscribeScreen() {
    const s = getBotSettings();
    const url = `https://t.me/${String(s.channel_username || '').replace('@', '')}`;
    const kb = new InlineKeyboard()
        .url('📢 Подписаться на канал', url).row()
        .text('✅ Я подписался', 'checksub');
    return {
        text: `📢 <b>Для доступа к боту подпишитесь на наш канал!</b>\n\nВ канале: ⚡️ новости, 🎁 промокоды и помощь.\nПосле подписки нажмите «✅ Я подписался».`,
        kb,
    };
}

/** Инструкция ручной оплаты: реквизиты из панели (карта/СБП/банк). */
async function sendManualInstructions(ctx, paymentId, amountText) {
    const s = getBotSettings();
    const rows = [];
    if (s.pay_card) rows.push(`💳 Карта: <b>${s.pay_card}</b>`);
    if (s.pay_phone) rows.push(`📱 Телефон (СБП): <b>${s.pay_phone}</b>`);
    if (s.pay_bank) rows.push(`🏦 Банк: <b>${s.pay_bank}</b>`);
    const requisites = rows.length > 0
        ? rows.join('\n')
        : '⚠️ Реквизиты не заданы — заполните их в панели (Платёжные системы).';

    const kb = new InlineKeyboard().text('✅ Я оплатил', `paid:${paymentId}`);
    const text =
        `🏦 <b>Оплата напрямую администратору</b>\n\n` +
        `🧾 Заказ: <b>#${paymentId}</b>${amountText ? `\n💵 Сумма: <b>${amountText}</b>` : ''}\n\n` +
        `${requisites}\n\n` +
        `После перевода нажмите «✅ Я оплатил» и отправьте скриншот или PDF чека.`;
    try {
        await ctx.reply(text, { parse_mode: 'HTML', reply_markup: kb });
    } catch (e) {
        logger.warn('Инструкция оплаты: HTML не прошёл, отправляю как текст', { error: e.message });
        await ctx.reply(text.replace(/<[^>]*>/g, ''), { reply_markup: kb });
    }
}

/** Создаёт счёт на пополнение и отправляет ссылку/инструкцию. */
async function createAndSendDeposit(ctx, amount) {
    let paymentId = null;
    try {
        const settings = getBotSettings();
        paymentId = db.prepare(
            'INSERT INTO payments (amount, currency, provider, status, telegram_id) VALUES (?, ?, ?, ?, ?)'
        ).run(amount, settings.currency, 'manual', 'pending', ctx.from.id).lastInsertRowid;

        const paymentsService = require('./payments');
        const pay = await paymentsService.createPaymentUrl({
            paymentId,
            tariff: { name: 'Пополнение баланса', price: amount, currency: settings.currency },
            settings,
        });

        if (pay) {
            const kb = new InlineKeyboard()
                .url('💳 Оплатить онлайн', pay.url).row()
                .text('🏦 Карта админа', `manualpay:${paymentId}`);
            await ctx.reply(`🧾 Счёт #${paymentId} на ${amount} ${currencySign(settings.currency)}.\nВыберите способ оплаты:`, { reply_markup: kb });
        } else {
            await sendManualInstructions(ctx, paymentId, `${amount} ${currencySign(settings.currency)}`);
        }
    } catch (e) {
        logger.error('Ошибка создания счёта на пополнение', { error: e.message, stack: e.stack });
        const text = `⚠️ Не удалось создать счёт: ${e.message}\nНапишите в поддержку ${SUPPORT_USERNAME} (заказ ${paymentId ? '#' + paymentId : 'не создан'})`;
        await ctx.reply(text).catch(() => ctx.reply('⚠️ Не удалось создать счёт. Напишите в поддержку.'));
    }
}

/** Приём чека: фото/PDF пересылаются админу. */
async function handleReceipt(ctx) {
    const paymentId = receiptState.get(ctx.from.id);
    if (!paymentId) return;
    receiptState.delete(ctx.from.id);

    const settings = getAll();
    const admin = Number(settings.tg_admin_chat_id) || null;
    const from = ctx.from;
    const caption =
        `🧾 <b>Чек по заказу #${paymentId}</b>\n` +
        `👤 От: ${from.username ? '@' + from.username : from.first_name} (ID ${from.id})\n\n` +
        `⚠️ Проверьте оплату и подтвердите: /admin → 💰 Платежи`;

    try {
        if (admin && bot) {
            if (ctx.message.photo) {
                const best = ctx.message.photo[ctx.message.photo.length - 1].file_id;
                await bot.api.sendPhoto(admin, best, { caption, parse_mode: 'HTML' });
            } else if (ctx.message.document) {
                await bot.api.sendDocument(admin, ctx.message.document.file_id, { caption, parse_mode: 'HTML' });
            }
        }
        await ctx.reply(`✅ <b>Чек получен!</b> Администратор проверит оплату — доступ придёт в этот чат.\nЗаказ #${paymentId}`, { parse_mode: 'HTML' });
    } catch (e) {
        logger.error('Не удалось переслать чек админу', { error: e.message, paymentId });
        await ctx.reply('⚠️ Не удалось передать чек. Отправьте его в поддержку ' + SUPPORT_USERNAME);
    }
}

/**
 * Запускает бота.
 */
async function start() {
    const botSettings = getBotSettings();
    if (!botSettings.enabled || !botSettings.bot_token) {
        logger.info('TG-бот отключён или токен не задан');
        return;
    }

    if (bot) {
        await bot.stop().catch(() => {});
        bot = null;
    }

    bot = new Bot(botSettings.bot_token);

    // ═══ 0. УЧЁТ ПОЛЬЗОВАТЕЛЕЙ — раньше всех (в том числе без подписки) ═══
    bot.use(async (ctx, next) => {
        const from = ctx.from;
        if (from && !from.is_bot) {
            try {
                db.prepare(
                    `INSERT INTO bot_users (telegram_id, username, first_name, last_name, seen_at)
                     VALUES (?, ?, ?, ?, datetime('now'))
                     ON CONFLICT(telegram_id) DO UPDATE SET
                       username = COALESCE(excluded.username, bot_users.username),
                       first_name = COALESCE(excluded.first_name, bot_users.first_name),
                       last_name = COALESCE(excluded.last_name, bot_users.last_name),
                       seen_at = datetime('now')`
                ).run(from.id, from.username || null, from.first_name || null, from.last_name || null);
            } catch (e) {
                logger.warn('bot_users: не удалось сохранить пользователя', { error: e.message });
            }
        }
        return next();
    });

    // ═══ 1. ГЕЙТ ПОДПИСКИ — первым ═══
    bot.use(async (ctx, next) => {
        const s = getBotSettings();
        if (!s.channel_required || !s.channel_username) return next();
        if (isAdmin(ctx)) return next();
        if (ctx.callbackQuery?.data === 'checksub') return next();

        if (!(await checkSubscription(ctx))) {
            const screen = subscribeScreen();
            if (ctx.callbackQuery) {
                await ctx.answerCallbackQuery({ text: '❌ Нужна подписка на канал!' });
                await ctx.reply(screen.text, { parse_mode: 'HTML', reply_markup: screen.kb });
            } else {
                await ctx.reply(screen.text, { parse_mode: 'HTML', reply_markup: screen.kb });
            }
            return;
        }
        return next();
    });

    // Проверка подписки по кнопке
    bot.callbackQuery('checksub', async (ctx) => {
        const s = getBotSettings();
        if (!s.channel_required || !s.channel_username) return ctx.answerCallbackQuery('Подписка не требуется');
        try {
            const m = await bot.api.getChatMember(s.channel_username, ctx.from.id);
            if (['creator', 'administrator', 'member'].includes(m.status)) {
                await ctx.answerCallbackQuery('✅ Подписка подтверждена!');
                return ctx.reply('✅ <b>Спасибо за подписку!</b> Нажмите /start.', { parse_mode: 'HTML' });
            }
        } catch { /* ignore */ }
        return ctx.answerCallbackQuery({ text: '❌ Вы ещё не подписались', show_alert: true });
    });

    // ═══ 2. /start и reply-клавиатура ═══
    bot.command('start', async (ctx) => {
        if (ctx.payload && ctx.payload.startsWith('ref_')) {
            const refTgId = Number(ctx.payload.slice(4));
            const referrer = db.prepare('SELECT id FROM clients WHERE telegram_id = ?').get(refTgId);
            if (referrer && refTgId !== ctx.from.id) {
                refPending.set(ctx.from.id, referrer.id);
                db.prepare(
                    'INSERT INTO referral_pending (telegram_id, referrer_id) VALUES (?, ?) ' +
                    'ON CONFLICT(telegram_id) DO UPDATE SET referrer_id = excluded.referrer_id'
                ).run(ctx.from.id, referrer.id);
                // Бэкфилл: прокси получен до перехода — проставляем сразу
                const backfilled = db.prepare(
                    'UPDATE clients SET referrer_id = ? WHERE telegram_id = ? AND referrer_id IS NULL'
                ).run(referrer.id, ctx.from.id);
                if (backfilled.changes > 0) {
                    logger.info('Реферал: referrer проставлен задним числом', { tgId: ctx.from.id, referrer: referrer.id });
                }
                logger.info('Реферал: переход по ссылке зафиксирован', { tgId: ctx.from.id, referrer: referrer.id });
            } else if (refTgId === ctx.from.id) {
                logger.warn('Реферал: самоприглашение отклонено', { tgId: ctx.from.id });
            }
        }
        const text = renderTemplate(
            botSettings.welcome_text || DEFAULT_WELCOME,
            { name: ctx.from.first_name }
        );
        await ctx.reply(text, {
            parse_mode: 'HTML',
            reply_markup: mainReplyKeyboard(ctx),
            disable_web_page_preview: true,
        });
        await ctx.reply('👇 <b>Выберите тариф:</b>', { parse_mode: 'HTML', reply_markup: tariffsKeyboard() });
    });

    bot.hears('🚀 Тарифы', (ctx) =>
        ctx.reply('👇 <b>Выберите тариф:</b>', { parse_mode: 'HTML', reply_markup: tariffsKeyboard() })
    );

    bot.hears('📱 Личный кабинет', async (ctx) => {
        const view = cabinetView(ctx);
        await ctx.reply(view.text, { parse_mode: 'HTML', reply_markup: view.kb, disable_web_page_preview: true });
    });

    // «⬅️ Назад» из экранов кабинета
    bot.callbackQuery('cabinet', async (ctx) => {
        await ctx.answerCallbackQuery();
        const view = cabinetView(ctx);
        await ctx.reply(view.text, { parse_mode: 'HTML', reply_markup: view.kb, disable_web_page_preview: true });
    });

    bot.hears('🤝 Рефералы', async (ctx) => {
        let botUsername = '';
        try { botUsername = (await bot.api.getMe()).username; } catch { /* нет связи */ }
        const me = db.prepare('SELECT id FROM clients WHERE telegram_id = ?').get(ctx.from.id);
        const converted = me
            ? db.prepare('SELECT COUNT(*) AS c FROM clients WHERE referrer_id = ?').get(me.id).c
            : 0;
        const pendingRefs = me
            ? db.prepare('SELECT COUNT(*) AS c FROM referral_pending WHERE referrer_id = ?').get(me.id).c
            : 0;
        const invited = converted + pendingRefs;
        const link = botUsername ? `https://t.me/${botUsername}?start=ref_${ctx.from.id}` : 'появится позже';
        await ctx.reply(
            `🤝 <b>Реферальная программа</b>\n\n` +
            `Приглашайте друзей — получайте <b>бесплатные дни</b>:\n` +
            `• Друг покупает 1 месяц → вам <b>+10 дней</b>\n` +
            `• 2 месяца → <b>+15 дней</b>\n` +
            `• Чем длиннее тариф — тем больше бонус!\n\n` +
            `👥 Приглашено: <b>${invited}</b>${pendingRefs > 0 ? ` (${converted} с прокси, ${pendingRefs} проходят тест)` : ''}\n\n` +
            `🔗 <b>Ваша ссылка:</b>\n<code>${link}</code>`,
            { parse_mode: 'HTML', disable_web_page_preview: true }
        );
    });

    bot.hears('🛟 Поддержка', (ctx) =>
        ctx.reply(`🛟 <b>Поддержка</b>\n\nПо любым вопросам пишите:\n👤 ${SUPPORT_USERNAME}`, { parse_mode: 'HTML' })
    );

    bot.hears('👑 Админ-панель', async (ctx) => {
        if (!isAdmin(ctx)) {
            const settings = getAll();
            if (!settings.tg_admin_chat_id) {
                return ctx.reply(
                    `⚠️ Админ-панель не настроена.\n\n1️⃣ Ваш ID: <code>${ctx.from.id}</code>\n2️⃣ Вставьте его в Панель → Настройки → Уведомления → Chat ID`,
                    { parse_mode: 'HTML' }
                );
            }
            return ctx.reply('⛔ Только для администратора');
        }
        await ctx.reply(adminStatsText(), { parse_mode: 'HTML', reply_markup: adminKeyboard() });
    });

    // ═══ 3. Кабинет: продление, пополнение ═══

    bot.callbackQuery(/^renew:(\d+)$/, async (ctx) => {
        await ctx.answerCallbackQuery();
        const clientId = Number(ctx.match[1]);
        const client = db.prepare('SELECT * FROM clients WHERE id = ?').get(clientId);
        // У прокси оба протокола (например, тестовый) — предлагаем выбор
        if (client && client.web_enabled && client.mtproto_enabled) {
            const until = client.expires_at ? fmtMSK(client.expires_at) : '∞';
            const kb = new InlineKeyboard()
                .text('🌐 Только Web Proxy', `renewmode:${clientId}:web`).row()
                .text('🔌 Только MTProto', `renewmode:${clientId}:mtproto`).row()
                .text('📦 Оба протокола', `renewmode:${clientId}:both`).row()
                .text('⬅️ Назад', 'cabinet');
            return ctx.reply(
                `♻️ <b>Продление: ${client.username}</b> — до ${until}\n\nВыберите, что продлеваем:`,
                { parse_mode: 'HTML', reply_markup: kb }
            );
        }
        await ctx.reply('♻️ <b>Выберите тариф продления:</b>', {
            parse_mode: 'HTML', reply_markup: renewKeyboard(clientId),
        });
    });

    bot.callbackQuery(/^renewmode:(\d+):(web|mtproto|both)$/, async (ctx) => {
        const clientId = Number(ctx.match[1]);
        const mode = ctx.match[2];
        const has = db.prepare('SELECT COUNT(*) AS c FROM tariffs WHERE enabled = 1 AND protocols = ?').get(mode).c;
        if (!has) {
            return ctx.answerCallbackQuery({ text: 'Нет тарифов этого типа — выберите другой вариант', show_alert: true });
        }
        await ctx.answerCallbackQuery();
        await ctx.reply('♻️ <b>Выберите тариф продления:</b>', {
            parse_mode: 'HTML', reply_markup: renewKeyboard(clientId, mode),
        });
    });

    bot.callbackQuery(/^renewpay:(\d+):(\d+)(?::(web|mtproto|both))?$/, async (ctx) => {
        await handleRenew(ctx, Number(ctx.match[1]), Number(ctx.match[2]), ctx.match[3] || null);
    });

    bot.callbackQuery('topup', async (ctx) => {
        await ctx.answerCallbackQuery();
        const settings = getBotSettings();
        const sign = currencySign(settings.currency);
        const kb = new InlineKeyboard()
            .text(`100 ${sign}`, 'deposit:100').text(`300 ${sign}`, 'deposit:300').row()
            .text(`500 ${sign}`, 'deposit:500').text(`1000 ${sign}`, 'deposit:1000').row()
            .text('✏️ Своя сумма', 'deposit:custom');
        await ctx.reply('💳 <b>Пополнение счёта</b>\n\nВыберите сумму:', {
            parse_mode: 'HTML', reply_markup: kb,
        });
    });

    bot.callbackQuery('deposit:custom', async (ctx) => {
        await ctx.answerCallbackQuery();
        depositCustom.set(ctx.from.id, true);
        await ctx.reply('✏️ Введите сумму пополнения одним числом (например: 250):');
    });

    bot.callbackQuery(/^deposit:(\d+)$/, async (ctx) => {
        const amount = Number(ctx.match[1]);
        await ctx.answerCallbackQuery('Создаю счёт...');
        await createAndSendDeposit(ctx, amount);
    });

    // ═══ 4. Тарифы: описание, покупка (баланс/CryptoBot/ЮKassa/карта), продление ═══

    bot.callbackQuery(/^info:(\d+)$/, async (ctx) => {
        const t = db.prepare('SELECT * FROM tariffs WHERE id = ? AND enabled = 1').get(Number(ctx.match[1]));
        if (!t) return ctx.answerCallbackQuery('Тариф недоступен');
        await ctx.answerCallbackQuery();
        const kb = new InlineKeyboard()
            .text(`✅ Купить — ${t.price} ${currencySign(t.currency)}`, `buy:${t.id}`).row()
            .text('⬅️ К тарифам', 'tariffs');
        await ctx.reply(tariffDescription(t), { parse_mode: 'HTML', reply_markup: kb });
    });

    // Покупка: выбор способа (баланс / платёжка / карта админа)
    bot.callbackQuery(/^buy:(\d+)$/, async (ctx) => {
        const tariff = db.prepare('SELECT * FROM tariffs WHERE id = ? AND enabled = 1').get(Number(ctx.match[1]));
        if (!tariff) return ctx.answerCallbackQuery('Тариф недоступен');
        await ctx.answerCallbackQuery();

        const settings = getBotSettings();
        const providerConfigured = !!(settings.cryptobot_token || (settings.yookassa_shop_id && settings.yookassa_secret_key));

        // Заказ создаётся сразу — любой способ привяжется к нему
        const paymentId = db.prepare(
            'INSERT INTO payments (tariff_id, amount, currency, provider, status, telegram_id) VALUES (?, ?, ?, ?, ?, ?)'
        ).run(tariff.id, tariff.price, tariff.currency, 'manual', 'pending', ctx.from.id).lastInsertRowid;

        const kb = new InlineKeyboard();

        // Баланс (если хватает) — первый способ
        const balance = totalBalance(ctx.from.id);
        if (balance >= tariff.price) {
            kb.text(`💰 С баланса (${balance.toFixed(2)})`, `paybal:${tariff.id}:${paymentId}`).row();
        }

        // Онлайн-платёжка (инвойс создаётся по клику)
        if (settings.cryptobot_token) kb.text('🪙 Оплатить через CryptoBot', `cbpay:${paymentId}:${tariff.id}:cryptobot`).row();
        if (settings.yookassa_shop_id && settings.yookassa_secret_key) kb.text('💳 Оплатить через ЮKassa', `cbpay:${paymentId}:${tariff.id}:yookassa`).row();

        // Карта админа — всегда доступна
        kb.text('🏦 Карта админа (СБП)', `manualpay:${paymentId}`);

        await ctx.reply(
            `${tariffDescription(tariff)}\n\n🧾 Заказ #${paymentId}\n\n💳 <b>Выберите способ оплаты:</b>`,
            { parse_mode: 'HTML', reply_markup: kb }
        );
    });

    // Покупка с баланса: списание + выдача нового прокси
    bot.callbackQuery(/^paybal:(\d+):(\d+)$/, async (ctx) => {
        const tariff = db.prepare('SELECT * FROM tariffs WHERE id = ? AND enabled = 1').get(Number(ctx.match[1]));
        const paymentId = Number(ctx.match[2]);
        if (!tariff) return ctx.answerCallbackQuery('Тариф недоступен');
        const balance = totalBalance(ctx.from.id);
        if (balance < tariff.price) {
            return ctx.answerCallbackQuery({ text: 'Недостаточно средств на балансе', show_alert: true });
        }
        await ctx.answerCallbackQuery('Оформляю...');

        deductBalance(ctx.from.id, tariff.price);
        try {
            await issueAccessFor(ctx.from.id, tariff, paymentId);
        } catch (e) {
            db.prepare('UPDATE clients SET balance = balance + ? WHERE telegram_id = ?').run(tariff.price, ctx.from.id);
            db.prepare("UPDATE payments SET status = 'failed' WHERE id = ?").run(paymentId);
            logger.error('Покупка с баланса не удалась, средства возвращены', { error: e.message });
            await ctx.reply(`⚠️ Произошла ошибка — средства возвращены. Напишите в поддержку ${SUPPORT_USERNAME}`);
        }
    });

    // Ленивое создание инвойса: CryptoBot / ЮKassa, по клику пользователя
    bot.callbackQuery(/^cbpay:(\d+):(\d+):(cryptobot|yookassa)$/, async (ctx) => {
        const paymentId = Number(ctx.match[1]);
        const provider = ctx.match[3];
        const payment = db.prepare('SELECT * FROM payments WHERE id = ?').get(paymentId);
        const tariff = db.prepare('SELECT * FROM tariffs WHERE id = ?').get(payment?.tariff_id);
        if (!payment || !tariff) return ctx.answerCallbackQuery('Заказ не найден');

        await ctx.answerCallbackQuery('Создаю счёт...');
        const settings = getBotSettings();
        const paymentsService = require('./payments');
        let pay = null;
        // Для продления — подпись с юзернеймом прокси
        const tariffName = payment.client_id
            ? (() => { const c = db.prepare('SELECT username FROM clients WHERE id = ?').get(payment.client_id); return c ? `${tariff.name} (продление ${c.username})` : tariff.name; })()
            : tariff.name;
        try {
            pay = provider === 'cryptobot'
                ? await paymentsService.createCryptoBotInvoice({
                    paymentId, tariff: { name: tariffName, price: tariff.price, currency: tariff.currency },
                    token: settings.cryptobot_token,
                })
                : await paymentsService.createYooKassaPayment({
                    paymentId, tariff: { name: tariffName, price: tariff.price, currency: tariff.currency },
                    shopId: settings.yookassa_shop_id, secretKey: settings.yookassa_secret_key,
                });
        } catch (e) {
            logger.error('Инвойс не создался', { provider, error: e.message });
            // Сбой платёжки — сразу карта админа, заказ остаётся в силе
            await sendManualInstructions(ctx, paymentId, `${tariff.price} ${currencySign(tariff.currency)}`);
            return;
        }

        if (pay?.url) {
            db.prepare('UPDATE payments SET provider = ? WHERE id = ?').run(provider, paymentId);
            const kb = new InlineKeyboard().url('💳 Перейти к оплате', pay.url);
            await ctx.reply(`🧾 Счёт #${paymentId} готов. Оплатите — доступ придёт автоматически.`, { reply_markup: kb });
        } else {
            // Инвойс не создался — сразу карта админа
            await sendManualInstructions(ctx, paymentId, `${tariff.price} ${currencySign(tariff.currency)}`);
        }
    });

    // Карта админа: инструкция + кнопка «Я оплатил»
    bot.callbackQuery(/^manualpay:(\d+)$/, async (ctx) => {
        await ctx.answerCallbackQuery();
        const payment = db.prepare('SELECT amount, currency FROM payments WHERE id = ?').get(Number(ctx.match[1]));
        await sendManualInstructions(ctx, Number(ctx.match[1]),
            payment ? `${payment.amount} ${currencySign(payment.currency)}` : null);
    });

    // «Я оплатил» → просим чек
    bot.callbackQuery(/^paid:(\d+)$/, async (ctx) => {
        const paymentId = Number(ctx.match[1]);
        receiptState.set(ctx.from.id, paymentId);
        await ctx.answerCallbackQuery();
        await ctx.reply('🧾 Прикрепите <b>скриншот или PDF чека</b> одним сообщением — я перешлю его администратору.', { parse_mode: 'HTML' });
    });

    // ═══ 5. Тест 3 часа, мой доступ, поддержка ═══

    bot.hears('🎁 Тест 3 часа', async (ctx) => {
        const tgId = ctx.from.id;
        const existing = db.prepare(
            "SELECT username FROM clients WHERE telegram_id = ? AND status = 'active'"
        ).get(tgId);
        if (existing) {
            return ctx.reply(
                `😕 <b>Тест недоступен</b>\n\nУ вас уже есть доступ (${existing.username}).\nПродлить — в личном кабинете.`,
                { parse_mode: 'HTML' }
            );
        }
        const oldTest = db.prepare('SELECT id FROM clients WHERE username LIKE ?').get(`test${tgId}%`);
        if (oldTest) {
            return ctx.reply('😕 Бесплатный тест даётся один раз. Выберите тариф: /start');
        }

        const expires = new Date(Date.now() + 3 * 3600 * 1000).toISOString();
        try {
            const created = await telemt.createUser({
                username: `test${tgId}`, expiration_rfc3339: expires, max_unique_ips: 2,
            });
            const referrerId = refPending.get(tgId)
                || db.prepare('SELECT referrer_id FROM referral_pending WHERE telegram_id = ?').get(tgId)?.referrer_id
                || null;
            db.prepare(
                `INSERT INTO clients (username, secret, expires_at, telegram_id, web_enabled, mtproto_enabled, referrer_id)
                 VALUES (?, ?, ?, ?, 1, 1, ?)`
            ).run(`test${tgId}`, created.secret, expires, tgId, referrerId);
            refPending.delete(tgId);
            db.prepare('DELETE FROM referral_pending WHERE telegram_id = ?').run(tgId);
            const client = db.prepare('SELECT * FROM clients WHERE username = ?').get(`test${tgId}`);
            const links = clientLinks(client, getAll().mask_domain);

            let text = `🎁 <b>Тестовый доступ на 3 часа активирован!</b>\n\n⏰ Действует до: <b>${fmtMSK(expires)}</b>\n\n`;
            if (links.web_https) text += `🌐 <b>Web Proxy</b> (нажми — подключится сам):\n${links.web_https}\n\n`;
            if (links.mtproto_https) text += `🔌 <b>MTProto</b>:\n${links.mtproto_https}\n\n`;
            text += `❤️ Понравилось? Продлите в личном кабинете!`;
            await ctx.reply(text, { parse_mode: 'HTML', disable_web_page_preview: true });
            require('./notifier').notifyAdmin(getAll(), `🎁 Тест выдан: test${tgId}`).catch(() => {});
        } catch (e) {
            logger.error('Ошибка выдачи теста', { error: e.message, tgId });
            await ctx.reply('⚠️ Не удалось выдать тест. Попробуйте позже.');
        }
    });

    bot.callbackQuery('my', async (ctx) => {
        const view = cabinetView(ctx);
        await ctx.answerCallbackQuery();
        await ctx.reply(view.text, { parse_mode: 'HTML', reply_markup: view.kb, disable_web_page_preview: true });
    });

    bot.callbackQuery('support', async (ctx) => {
        await ctx.answerCallbackQuery();
        await ctx.reply(`🛟 <b>Поддержка</b>\n\nПишите: ${SUPPORT_USERNAME}`, { parse_mode: 'HTML' });
    });

    bot.callbackQuery('tariffs', async (ctx) => {
        await ctx.answerCallbackQuery();
        await ctx.reply('👇 <b>Выберите тариф:</b>', { parse_mode: 'HTML', reply_markup: tariffsKeyboard() });
    });

    // ═══ 6. Продление: баланс или платёжка ═══

    async function handleRenew(ctx, clientId, tariffId, mode) {
        const client = db.prepare('SELECT * FROM clients WHERE id = ?').get(clientId);
        const tariff = db.prepare('SELECT * FROM tariffs WHERE id = ? AND enabled = 1').get(tariffId);
        if (!client || !tariff) return ctx.answerCallbackQuery('Недоступно');
        // Чужой прокси продлить нельзя
        if (client.telegram_id !== ctx.from.id) {
            return ctx.answerCallbackQuery({ text: 'Это не ваш прокси', show_alert: true });
        }
        const modeSql = `UPDATE clients SET web_enabled = ?, mtproto_enabled = ? WHERE id = ?`;
        const modeFlags = {
            web: [1, 0], mtproto: [0, 1], both: [1, 1],
        };

        // Оплата с общего баланса пользователя (как при покупке)
        const balance = totalBalance(ctx.from.id);
        if (balance >= tariff.price) {
            deductBalance(ctx.from.id, tariff.price);
            const base = client.expires_at && new Date(client.expires_at) > new Date()
                ? new Date(client.expires_at) : new Date();
            const newExpiry = new Date(base.getTime() + tariff.days * 86400000).toISOString();
            const patch = { expiration_rfc3339: newExpiry };
            if (tariff.max_ips) patch.max_unique_ips = tariff.max_ips;
            if (tariff.quota_gb) patch.data_quota_bytes = Math.round(tariff.quota_gb * 1024 ** 3);
            await telemt.patchUser(client.username, patch).catch(() => {});
            db.prepare("UPDATE clients SET expires_at = ?, status = 'active' WHERE id = ?").run(newExpiry, client.id);
            if (mode && modeFlags[mode]) db.prepare(modeSql).run(...modeFlags[mode], client.id);
            await ctx.answerCallbackQuery();
            const modeText = mode === 'web' ? ' (только Web Proxy)'
                : mode === 'mtproto' ? ' (только MTProto)'
                : mode === 'both' ? ' (оба протокола)' : '';
            return ctx.reply(
                `✅ <b>Продлено с баланса!</b>\n\n📦 ${client.username}${modeText} — до <b>${fmtMSK(newExpiry, false)}</b>\n💳 Списано: ${tariff.price} ${currencySign(tariff.currency)}\n💰 Остаток: ${totalBalance(ctx.from.id).toFixed(2)}`,
                { parse_mode: 'HTML' }
            );
        }

        await ctx.answerCallbackQuery();
        const result = db.prepare(
            'INSERT INTO payments (tariff_id, amount, currency, provider, status, telegram_id, client_id, renew_protocols) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
        ).run(tariff.id, tariff.price, tariff.currency, 'manual', 'pending', ctx.from.id, client.id, mode);

        const settings = getBotSettings();

        // Показываем выбор способа оплаты (как при покупке), а не кидаем сразу на CryptoBot
        const hasOnline = !!(settings.cryptobot_token || (settings.yookassa_shop_id && settings.yookassa_secret_key));
        if (!hasOnline) {
            await sendManualInstructions(ctx, result.lastInsertRowid, `${tariff.price} ${currencySign(tariff.currency)}`);
            return;
        }

        const kb = new InlineKeyboard();
        if (settings.cryptobot_token) kb.text('🪙 Оплатить через CryptoBot', `cbpay:${result.lastInsertRowid}:${tariff.id}:cryptobot`).row();
        if (settings.yookassa_shop_id && settings.yookassa_secret_key) kb.text('💳 Оплатить через ЮKassa', `cbpay:${result.lastInsertRowid}:${tariff.id}:yookassa`).row();
        kb.text('🏦 Карта админа (СБП)', `manualpay:${result.lastInsertRowid}`);

        await ctx.reply(
            `🧾 <b>Счёт #${result.lastInsertRowid}</b>\n💰 Баланса не хватило (${balance.toFixed(2)})\n\n💳 <b>Выберите способ оплаты — продление пройдёт автоматически:</b>`,
            { parse_mode: 'HTML', reply_markup: kb }
        );
    }

    // ═══ 7. Админ-панель ═══

    const adminGuard = async (ctx) => {
        if (isAdmin(ctx)) return true;
        const settings = getAll();
        if (!settings.tg_admin_chat_id) {
            await ctx.answerCallbackQuery({ text: `Настройте Chat ID админа! Ваш ID: ${ctx.from.id}`, show_alert: true }).catch(async () => {
                await ctx.reply(`⚠️ Админка не настроена. Ваш ID: <code>${ctx.from.id}</code>\nВставьте его в Панель → Настройки → Уведомления`, { parse_mode: 'HTML' });
            });
        } else {
            await ctx.answerCallbackQuery('⛔ Только для админа');
        }
        return false;
    };

    bot.command('admin', async (ctx) => {
        if (!isAdmin(ctx)) {
            const settings = getAll();
            if (!settings.tg_admin_chat_id) {
                return ctx.reply(
                    `⚠️ Админ-панель не настроена.\n\n1️⃣ Ваш ID: <code>${ctx.from.id}</code>\n2️⃣ Вставьте его в Панель → Настройки → Уведомления → Chat ID`,
                    { parse_mode: 'HTML' }
                );
            }
            return ctx.reply('⛔ Только для администратора');
        }
        await ctx.reply(adminStatsText(), { parse_mode: 'HTML', reply_markup: adminKeyboard() });
    });

    bot.callbackQuery('admin:stats', async (ctx) => {
        if (!(await adminGuard(ctx))) return;
        await ctx.answerCallbackQuery();
        await ctx.editMessageText(adminStatsText(), { parse_mode: 'HTML', reply_markup: adminKeyboard() });
    });

    bot.callbackQuery('admin:clients', async (ctx) => {
        if (!(await adminGuard(ctx))) return;
        await ctx.answerCallbackQuery();
        const clients = db.prepare(
            'SELECT username, status, expires_at FROM clients ORDER BY created_at DESC LIMIT 15'
        ).all();
        let text = `👥 <b>Последние клиенты</b>\n\n`;
        text += clients.map((c) => {
            const icon = c.status === 'active' ? '🟢' : c.status === 'blocked' ? '🔴' : '🟡';
            const until = c.expires_at ? fmtMSK(c.expires_at, false) : '∞';
            return `${icon} <b>${c.username}</b> — до ${until}`;
        }).join('\n') || 'Пока никого';
        const kb = new InlineKeyboard().text('⬅️ Назад', 'admin:stats');
        await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: kb });
    });

    bot.callbackQuery('admin:payments', async (ctx) => {
        if (!(await adminGuard(ctx))) return;
        await ctx.answerCallbackQuery();
        const pending = db.prepare(
            `SELECT p.id, p.amount, p.currency, p.telegram_id, t.name AS tariff
             FROM payments p LEFT JOIN tariffs t ON t.id = p.tariff_id
             WHERE p.status = 'pending' ORDER BY p.created_at DESC LIMIT 10`
        ).all();
        if (pending.length === 0) {
            const kb = new InlineKeyboard().text('⬅️ Назад', 'admin:stats');
            return ctx.editMessageText('✅ Все платежи подтверждены.', { reply_markup: kb });
        }
        const kb = new InlineKeyboard();
        for (const p of pending) {
            kb.text(`✅ #${p.id} — ${p.amount} ${currencySign(p.currency)}${p.telegram_id ? ` (TG ${p.telegram_id})` : ''}`, `confirm:${p.id}`).row();
        }
        kb.text('⬅️ Назад', 'admin:stats');
        await ctx.editMessageText('💰 <b>Ожидают подтверждения</b>:', { parse_mode: 'HTML', reply_markup: kb });
    });

    bot.callbackQuery(/^confirm:(\d+)$/, async (ctx) => {
        if (!(await adminGuard(ctx))) return;
        const paymentId = Number(ctx.match[1]);
        const payment = db.prepare('SELECT * FROM payments WHERE id = ?').get(paymentId);
        if (!payment || payment.status === 'success') return ctx.answerCallbackQuery('Уже обработан');
        await ctx.answerCallbackQuery('Подтверждаю...');

        try {
            const paymentsRoute = require('../routes/payments');
            await paymentsRoute.completePayment(paymentId);
            await ctx.editMessageText(`✅ Платёж #${paymentId} подтверждён.`);
        } catch (e) {
            logger.error('Ошибка подтверждения платежа', { paymentId, error: e.message });
            await ctx.editMessageText(`⚠️ Платёж #${paymentId}: ${e.message}`);
        }
    });

    bot.callbackQuery('admin:broadcast', async (ctx) => {
        if (!(await adminGuard(ctx))) return;
        await ctx.answerCallbackQuery();
        broadcastState.set(ctx.from.id, true);
        await ctx.editMessageText(
            '📢 <b>Рассылка по всем клиентам</b>\n\nПришлите текст следующим сообщением (HTML разрешён).\nОтмена: /cancel',
            { parse_mode: 'HTML' }
        );
    });

    bot.command('cancel', async (ctx) => {
        if (broadcastState.delete(ctx.from.id)) await ctx.reply('❌ Рассылка отменена');
    });

    // Текст от админа в режиме рассылки (иначе — передаём дальше по цепочке)
    bot.on('message:text', async (ctx, next) => {
        if (isAdmin(ctx) && broadcastState.has(ctx.from.id)) {
            broadcastState.delete(ctx.from.id);
            const clients = db.prepare('SELECT telegram_id FROM clients WHERE telegram_id IS NOT NULL').all();
            await ctx.reply(`📢 Рассылка запущена: ${clients.length} получателей...`);
            let sent = 0;
            for (const c of clients) {
                try {
                    await bot.api.sendMessage(c.telegram_id, ctx.message.text, { parse_mode: 'HTML' });
                    sent += 1;
                    await new Promise((r) => setTimeout(r, 50));
                } catch { /* заблокировали бота */ }
            }
            return ctx.reply(`✅ Доставлено: ${sent} из ${clients.length}`);
        }
        return next();
    });

    bot.catch((err) => logger.error('Ошибка TG-бота', { error: err.message }));

    // Бэкфилл юзернеймов: тихо, в фоне, только для тех, кто известен боту
    (async () => {
        try {
            const ids = db.prepare(
                `SELECT DISTINCT c.telegram_id AS id
                 FROM clients c
                 WHERE c.telegram_id IS NOT NULL
                   AND c.telegram_id NOT IN (SELECT telegram_id FROM bot_users WHERE username IS NOT NULL)`
            ).all().map((r) => r.id).slice(0, 200);
            for (const id of ids) {
                try {
                    const chat = await bot.api.getChat(id);
                    db.prepare(
                        `INSERT INTO bot_users (telegram_id, username, first_name, last_name, seen_at)
                         VALUES (?, ?, ?, ?, datetime('now'))
                         ON CONFLICT(telegram_id) DO UPDATE SET
                           username = COALESCE(excluded.username, bot_users.username),
                           first_name = COALESCE(excluded.first_name, bot_users.first_name),
                           last_name = COALESCE(excluded.last_name, bot_users.last_name)`
                    ).run(id, chat.username || null, chat.first_name || null, chat.last_name || null);
                } catch { /* пользователь недоступен боту */ }
                await new Promise((r) => setTimeout(r, 350));
            }
        } catch (e) {
            logger.warn('Бэкфилл юзернеймов не удался', { error: e.message });
        }
    })();

    bot.start({ drop_pending_updates: true }).catch((err) => {
        logger.error('TG-бот упал', { error: err.message });
    });
    logger.info('TG-бот продаж запущен');
}

/** Останавливает бота. */
async function stop() {
    if (bot) {
        await bot.stop().catch(() => {});
        bot = null;
        logger.info('TG-бот остановлен');
    }
}

/** Настройки бота из таблицы settings (ключ bot_settings). */
function getBotSettings() {
    const all = getAll();
    const stored = all.bot_settings || {};
    return { enabled: false, currency: 'RUB', ...stored };
}

/** Работает ли бот сейчас. */
const isRunning = () => bot !== null;

module.exports = { start, stop, isRunning, getBotSettings, issueAccessFor, notifyDeposit, sendMessageTo };
