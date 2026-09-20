/**
 * @fileoverview Telegram-бот продаж TGGATE (grammY) с админ-панелью.
 *
 * ВАЖНО: порядок регистрации middleware строгий:
 *   1. Гейт обязательной подписки на канал (первым!)
 *   2. Кнопка проверки подписки
 *   3. Все остальные хендлеры
 *
 * Пользователь: /start — приветствие и тарифы, покупка (платёжки/вручную),
 * личный кабинет (несколько прокси, продление, баланс), рефералка, тест 3ч.
 * Админ (tg_admin_chat_id): /admin — дашборд, платежи, клиенты, рассылка.
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

// Реферальные переходы: tgId -> id клиента-реферера
const refPending = new Map();
// Состояние рассылки: tgId админа -> true (ждём текст)
const broadcastState = new Map();
// Ожидание чека: tgId -> paymentId
const receiptState = new Map();

/** Юзернейм поддержки. */
const SUPPORT_USERNAME = '@tggatetopsupport';

/** Реквизиты для ручной оплаты (по умолчанию; можно переопределить в панели). */
const DEFAULT_PAYMENT_CARD = '💳 2203 8303 2012 5439 — МТС БАНК';

/**
 * Формат времени по Москве с точностью до секунды (с пометкой МСК).
 * Пример: 20.09.26 15:34:39 МСК
 */
function fmtMSK(date) {
    return new Date(date).toLocaleString('ru-RU', {
        timeZone: 'Europe/Moscow',
        day: '2-digit', month: '2-digit', year: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
    }) + ' МСК';
}

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

/** Клавиатура с тарифами (null, если тарифов нет). */
function tariffsKeyboard() {
    const tariffs = db.prepare('SELECT * FROM tariffs WHERE enabled = 1 ORDER BY days').all();
    const kb = new InlineKeyboard();
    for (const t of tariffs) {
        kb.text(`${t.name} — ${t.price} ${currencySign(t.currency)}`, `info:${t.id}`).row();
    }
    kb.text('📱 Мой доступ', 'my').row();
    kb.text('💬 Поддержка', 'support').row();
    // Кастомные кнопки из панели (ссылки на ботов/каналы)
    for (const b of getBotSettings().custom_buttons || []) {
        if (b.enabled !== false && b.name && b.url) {
            kb.url(b.name.slice(0, 64), b.url).row();
        }
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
        "SELECT COUNT(DISTINCT username) AS c FROM connection_logs WHERE created_at >= datetime('now', '-5 minutes')"
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
    for (const c of clients) {
        const until = c.expires_at ? fmtMSK(c.expires_at) : '∞';
        const icon = c.status === 'active' ? '🟢' : '🔴';
        text += `${icon} <b>${c.username}</b> — до ${until}\n`;
        kb.text(`♻️ Продлить: ${c.username}`, `renew:${c.id}`).row();
    }
    kb.text(`💳 Пополнить счёт`, 'topup').row();
    kb.text('🚀 Тарифы', 'tariffs');
    return { text, kb };
}

function renewKeyboard(clientId) {
    const tariffs = db.prepare('SELECT * FROM tariffs WHERE enabled = 1 ORDER BY days').all();
    const kb = new InlineKeyboard();
    for (const t of tariffs) {
        kb.text(`${t.name} — ${t.price} ${currencySign(t.currency)}`, `renewpay:${clientId}:${t.id}`).row();
    }
    kb.text('⬅️ Назад', 'cabinet');
    return kb;
}

/**
 * Продление существующего клиента: баланс или счёт через платёжку.
 */
async function handleRenew(ctx, clientId, tariffId) {
    const client = db.prepare('SELECT * FROM clients WHERE id = ?').get(clientId);
    const tariff = db.prepare('SELECT * FROM tariffs WHERE id = ? AND enabled = 1').get(tariffId);
    if (!client || !tariff) return ctx.answerCallbackQuery('Недоступно');

    // Оплата с баланса
    if ((client.balance || 0) >= tariff.price) {
        db.prepare('UPDATE clients SET balance = balance - ? WHERE id = ?').run(tariff.price, client.id);
        const base = client.expires_at && new Date(client.expires_at) > new Date()
            ? new Date(client.expires_at) : new Date();
        const newExpiry = new Date(base.getTime() + tariff.days * 86400000).toISOString();
        await telemt.patchUser(client.username, { expiration_rfc3339: newExpiry }).catch(() => {});
        db.prepare("UPDATE clients SET expires_at = ?, status = 'active' WHERE id = ?").run(newExpiry, client.id);
        await ctx.answerCallbackQuery();
        return ctx.reply(
            `✅ <b>Продлено с баланса!</b>\n\n📦 ${client.username} — до <b>${fmtMSK(newExpiry)}</b>\n💳 Списано: ${tariff.price} ${currencySign(tariff.currency)}`,
            { parse_mode: 'HTML' }
        );
    }

    // Счёт через платёжку
    await ctx.answerCallbackQuery('Создаю счёт...');
    const result = db.prepare(
        'INSERT INTO payments (tariff_id, amount, currency, provider, status, telegram_id) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(tariff.id, tariff.price, tariff.currency, 'manual', 'pending', ctx.from.id);

    const settings = getBotSettings();
    const paymentsService = require('./payments');
    const pay = await paymentsService.createPaymentUrl({
        paymentId: result.lastInsertRowid,
        tariff: { name: `${tariff.name} (продление ${client.username})`, price: tariff.price, currency: tariff.currency },
        settings,
    });

    if (pay) {
        const kb = new InlineKeyboard()
            .url('💳 Оплатить онлайн', pay.url).row()
            .text('🏦 Напрямую админу', `manualpay:${result.lastInsertRowid}`);
        await ctx.reply(
            `🧾 <b>Счёт #${result.lastInsertRowid}</b>\n💰 Баланса не хватило (${(client.balance || 0).toFixed(2)})\n\nВыберите способ оплаты:`,
            { parse_mode: 'HTML', reply_markup: kb }
        );
    } else {
        await sendManualInstructions(ctx, result.lastInsertRowid, `${tariff.price} ${currencySign(tariff.currency)}`);
    }
}

/**
 * Выдаёт доступ покупателю по telegram_id (вебхуки оплаты и админка).
 * Каждая покупка создаёт НОВЫЙ прокси (отдельный клиент).
 * Начисляет реферальный бонус пригласившему.
 */
async function issueAccessFor(tgId, tariff, paymentId) {
    const settings = getAll();
    const expires = new Date(Date.now() + tariff.days * 86400000).toISOString();

    // Уникальное имя: tg<id>x<n>, где n — число существующих прокси + 1
    const count = db.prepare('SELECT COUNT(*) AS c FROM clients WHERE telegram_id = ?').get(tgId).c;
    const username = `tg${tgId}x${count + 1}`;
    // Реферал: кто пригласил (RAM или БД — на случай перезапуска панели)
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

    // Бонус рефереру за покупку приглашённого
    payReferralBonus(client.id, tariff.days).catch((e) =>
        logger.warn('Не удалось начислить реферальный бонус', { error: e.message }));

    return client;
}

/**
 * Реферальный бонус: 30+ дней → +10; 60+ → +25% срока (округление вверх).
 */
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
            `🎁 <b>Бонус за реферала!</b>\n\nДруг купил прокси на ${purchasedDays} дн. — вам <b>+${bonus} дней</b>.\n\n${referrer.username}: до ${fmtMSK(newExpiry)}`,
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

/**
 * Проверяет подписку на обязательный канал.
 * @returns {Promise<boolean>} true — доступ разрешён
 */
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
        // Бот не видит канал — не блокируем пользователей
        return true;
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

/**
 * Показывает инструкцию ручной оплаты (карта админа) + кнопку «Я оплатил».
 * @param {object} ctx
 * @param {number} paymentId - id платежа в БД
 * @param {string} amountText - «300 ₽» и т.п.
 */
async function sendManualInstructions(ctx, paymentId, amountText) {
    const s = getBotSettings();
    const instructions = s.payment_instructions?.trim() ||
        `🏦 Переведите сумму на карту:\n${DEFAULT_PAYMENT_CARD}\n\nПосле перевода нажмите «✅ Я оплатил» и отправьте скриншот или PDF чека.`;

    const kb = new InlineKeyboard().text('✅ Я оплатил', `paid:${paymentId}`);
    const text =
        `🏦 <b>Оплата напрямую администратору</b>\n\n` +
        `🧾 Заказ: <b>#${paymentId}</b>${amountText ? `\n💵 Сумма: <b>${amountText}</b>` : ''}\n\n` +
        `${instructions}`;
    try {
        await ctx.reply(text, { parse_mode: 'HTML', reply_markup: kb });
    } catch (e) {
        // Текст инструкции ломает HTML-разметку — отправляем без форматирования
        logger.warn('Инструкция оплаты: HTML не прошёл, отправляю как текст', { error: e.message });
        await ctx.reply(text.replace(/<[^>]*>/g, ''), { reply_markup: kb });
    }
}

/**
 * Приём чека: фото или PDF от пользователя пересылаются админу.
 */
async function handleReceipt(ctx) {
    const paymentId = receiptState.get(ctx.from.id);
    if (!paymentId) return; // чек не ждём — пропускаем
    receiptState.delete(ctx.from.id);

    const settings = getAll();
    const admin = Number(settings.tg_admin_chat_id) || null;
    const from = ctx.from;
    const caption =
        `🧾 <b>Чек по заказу #${paymentId}</b>\n` +
        `👤 От: ${from.username ? '@' + from.username : from.first_name} (ID ${from.id})\n\n` +
        `⚠️ Проверьте оплату и подтвердите:\nПанель → Дашборд или /admin → 💰 Платежи`;

    try {
        if (admin && bot) {
            if (ctx.message.photo) {
                const best = ctx.message.photo[ctx.message.photo.length - 1].file_id;
                await bot.api.sendPhoto(admin, best, { caption, parse_mode: 'HTML' });
            } else if (ctx.message.document) {
                await bot.api.sendDocument(admin, ctx.message.document.file_id, { caption, parse_mode: 'HTML' });
            }
        }
        await ctx.reply(
            `✅ <b>Чек получен!</b>\n\nАдминистратор проверит оплату — доступ придёт в этот чат.\nЗаказ #${paymentId}`,
            { parse_mode: 'HTML' }
        );
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

    // ═══ 1. ГЕЙТ ПОДПИСКИ — строго первым middleware ═══
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
            return; // не пускаем дальше
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
                // Персистентно: переживает перезапуск панели
                db.prepare(
                    'INSERT INTO referral_pending (telegram_id, referrer_id) VALUES (?, ?) ' +
                    'ON CONFLICT(telegram_id) DO UPDATE SET referrer_id = excluded.referrer_id'
                ).run(ctx.from.id, referrer.id);
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
        const kb = tariffsKeyboard();
        if (kb) await ctx.reply('👇 <b>Выберите тариф:</b>', { parse_mode: 'HTML', reply_markup: kb });
    });

    bot.hears('🚀 Тарифы', async (ctx) => {
        const kb = tariffsKeyboard();
        await ctx.reply('👇 <b>Выберите тариф:</b>', { parse_mode: 'HTML', reply_markup: kb });
    });

    bot.hears('📱 Личный кабинет', async (ctx) => {
        const view = cabinetView(ctx);
        await ctx.reply(view.text, { parse_mode: 'HTML', reply_markup: view.kb, disable_web_page_preview: true });
    });

    bot.hears('🤝 Рефералы', async (ctx) => {
        let botUsername = '';
        try { botUsername = (await bot.api.getMe()).username; } catch { /* нет связи */ }
        const me = db.prepare('SELECT id FROM clients WHERE telegram_id = ?').get(ctx.from.id);
        // Приглашённые: уже с прокси + те, кто перешёл по ссылке (ещё без прокси)
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
                    `⚠️ Админ-панель не настроена.\n\n` +
                    `1️⃣ Ваш ID: <code>${ctx.from.id}</code>\n` +
                    `2️⃣ Вставьте его в Панель → Настройки → Уведомления → Chat ID`,
                    { parse_mode: 'HTML' }
                );
            }
            return ctx.reply('⛔ Раздел только для администратора');
        }
        await ctx.reply(adminStatsText(), { parse_mode: 'HTML', reply_markup: adminKeyboard() });
    });

    // ═══ 3. Кабинет: продление, пополнение, тест ═══

    bot.callbackQuery(/^renew:(\d+)$/, async (ctx) => {
        await ctx.answerCallbackQuery();
        await ctx.reply('♻️ <b>Выберите тариф продления:</b>', {
            parse_mode: 'HTML', reply_markup: renewKeyboard(Number(ctx.match[1])),
        });
    });

    bot.callbackQuery(/^renewpay:(\d+):(\d+)$/, async (ctx) => {
        await handleRenew(ctx, Number(ctx.match[1]), Number(ctx.match[2]));
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

    // Своя сумма: ждём число следующим сообщением
    const depositCustom = new Map();
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

    // ═══ 4. Тарифы и покупка (несколько прокси у одного клиента) ═══

    // Приём чеков (фото и PDF) — после «Я оплатил»
    bot.on('message:photo', handleReceipt);
    bot.on('message:document', handleReceipt);

    // «Я оплатил» → просим чек
    bot.callbackQuery(/^paid:(\d+)$/, async (ctx) => {
        const paymentId = Number(ctx.match[1]);
        receiptState.set(ctx.from.id, paymentId);
        await ctx.answerCallbackQuery();
        await ctx.reply(
            `🧾 Прикрепите <b>скриншот или PDF чека</b> одним сообщением — я перешлю его администратору.`,
            { parse_mode: 'HTML' }
        );
    });

    // Переход на ручную оплату (если платёжка уже показана)
    bot.callbackQuery(/^manualpay:(\d+)$/, async (ctx) => {
        await ctx.answerCallbackQuery();
        await sendManualInstructions(ctx, Number(ctx.match[1]), null);
    });

    // Описание тарифа → подтверждение покупки
    bot.callbackQuery(/^info:(\d+)$/, async (ctx) => {
        const t = db.prepare('SELECT * FROM tariffs WHERE id = ? AND enabled = 1').get(Number(ctx.match[1]));
        if (!t) return ctx.answerCallbackQuery('Тариф недоступен');
        await ctx.answerCallbackQuery();
        const kb = new InlineKeyboard()
            .text(`✅ Купить — ${t.price} ${currencySign(t.currency)}`, `buy:${t.id}`).row()
            .text('⬅️ К тарифам', 'tariffs');
        await ctx.reply(tariffDescription(t), { parse_mode: 'HTML', reply_markup: kb });
    });

    bot.callbackQuery(/^buy:(\d+)$/, async (ctx) => {
        const tariff = db.prepare('SELECT * FROM tariffs WHERE id = ? AND enabled = 1').get(Number(ctx.match[1]));
        if (!tariff) return ctx.answerCallbackQuery('Тариф недоступен');
        await ctx.answerCallbackQuery('Создаю счёт...');

        const result = db.prepare(
            'INSERT INTO payments (tariff_id, amount, currency, provider, status, telegram_id) VALUES (?, ?, ?, ?, ?, ?)'
        ).run(tariff.id, tariff.price, tariff.currency, 'manual', 'pending', ctx.from.id);
        const paymentId = result.lastInsertRowid;

        const settings = getBotSettings();
        const paymentsService = require('./payments');
        const pay = await paymentsService.createPaymentUrl({
            paymentId, tariff: { name: tariff.name, price: tariff.price, currency: tariff.currency },
            settings,
        });

        if (pay) {
            // Платёжка подключена: выбор способа оплаты
            const kb = new InlineKeyboard()
                .url('💳 Оплатить онлайн', pay.url).row()
                .text('🏦 Напрямую админу', `manualpay:${paymentId}`);
            await ctx.reply(
                `🧾 <b>Счёт #${paymentId}</b>\n\n📦 Тариф: <b>${tariff.name}</b>\n💵 Сумма: <b>${tariff.price} ${currencySign(tariff.currency)}</b>\n\nВыберите способ оплаты:`,
                { parse_mode: 'HTML', reply_markup: kb }
            );
        } else {
            // Платёжек нет — сразу инструкция с картой
            await sendManualInstructions(ctx, paymentId, `${tariff.price} ${currencySign(tariff.currency)}`);
        }
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
            const created = await telemt.createUser({ username: `test${tgId}`, expiration_rfc3339: expires });
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
        const kb = tariffsKeyboard();
        if (kb) await ctx.reply('👇 <b>Выберите тариф:</b>', { parse_mode: 'HTML', reply_markup: kb });
    });

    // ═══ 6. Админ-панель ═══

    const adminGuard = async (ctx, message) => {
        if (isAdmin(ctx)) return true;
        const settings = getAll();
        if (!settings.tg_admin_chat_id) {
            await ctx.answerCallbackQuery({ text: 'Настройте Chat ID админа в панели!', show_alert: true }).catch(async () => {
                await ctx.reply(`⚠️ Админка не настроена. Ваш ID: <code>${ctx.from.id}</code>\nВставьте его в Панель → Настройки → Уведомления`, { parse_mode: 'HTML' });
            });
        } else {
            await ctx.answerCallbackQuery(message || '⛔ Только для админа');
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
            const until = c.expires_at ? fmtMSK(c.expires_at) : '∞';
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

        const tariff = payment.tariff_id
            ? db.prepare('SELECT * FROM tariffs WHERE id = ?').get(payment.tariff_id)
            : null;

        try {
            if (tariff && payment.telegram_id) {
                await issueAccessFor(payment.telegram_id, tariff, paymentId);
            } else if (!tariff && payment.telegram_id) {
                // Пополнение баланса
                const client = db.prepare('SELECT * FROM clients WHERE telegram_id = ?').get(payment.telegram_id);
                if (client) {
                    db.prepare('UPDATE clients SET balance = balance + ? WHERE id = ?').run(payment.amount, client.id);
                }
                db.prepare("UPDATE payments SET status = 'success', paid_at = datetime('now') WHERE id = ?").run(paymentId);
            } else {
                db.prepare("UPDATE payments SET status = 'success', paid_at = datetime('now') WHERE id = ?").run(paymentId);
            }
            await ctx.editMessageText(`✅ Платёж #${paymentId} подтверждён.`);
        } catch (e) {
            logger.error('Ошибка подтверждения платежа', { paymentId, error: e.message });
            await ctx.editMessageText(`⚠️ Платёж #${paymentId} подтверждён, но выдача не удалась: ${e.message}`);
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

    // Текст от админа в режиме рассылки (пропускаем дальше, если это не рассылка!)
    bot.on('message:text', async (ctx, next) => {
        if (!isAdmin(ctx) || !broadcastState.has(ctx.from.id)) return next();
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
        await ctx.reply(`✅ Доставлено: ${sent} из ${clients.length}`);
    });

    // Своя сумма пополнения: число от пользователя
    bot.on('message::bot_command', () => {}); // no-op для читаемости
    bot.on('message:text', async (ctx, next) => {
        if (depositCustom.has(ctx.from.id)) {
            const amount = Number(ctx.message.text.trim());
            if (!Number.isFinite(amount) || amount <= 0 || amount > 1000000) {
                return ctx.reply('❌ Введите корректную сумму числом (например: 250)');
            }
            depositCustom.delete(ctx.from.id);
            await ctx.reply(`⏳ Создаю счёт на ${amount}...`);
            await createAndSendDeposit(ctx, amount);
            return;
        }
        return next();
    });

    bot.catch((err) => logger.error('Ошибка TG-бота', { error: err.message }));

    bot.start({ drop_pending_updates: true }).catch((err) => {
        logger.error('TG-бот упал', { error: err.message });
    });
    logger.info('TG-бот продаж запущен');
}

/** Создаёт счёт на пополнение и отправляет ссылку. */
async function createAndSendDeposit(ctx, amount) {
    let paymentId = null;
    try {
        const settings = getBotSettings();
        const result = db.prepare(
            'INSERT INTO payments (amount, currency, provider, status, telegram_id) VALUES (?, ?, ?, ?, ?)'
        ).run(amount, settings.currency, 'manual', 'pending', ctx.from.id);
        paymentId = result.lastInsertRowid;

        const paymentsService = require('./payments');
        const pay = await paymentsService.createPaymentUrl({
            paymentId,
            tariff: { name: 'Пополнение баланса', price: amount, currency: settings.currency },
            settings,
        });

        if (pay) {
            const kb = new InlineKeyboard()
                .url('💳 Оплатить онлайн', pay.url).row()
                .text('🏦 Напрямую админу', `manualpay:${paymentId}`);
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
