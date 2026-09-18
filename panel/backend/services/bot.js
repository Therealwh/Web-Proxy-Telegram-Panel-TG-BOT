/**
 * @fileoverview Telegram-бот продаж TGGATE (grammY).
 * Команды: /start — приветствие и тарифы, покупка доступа,
 * /my — мои ссылки, /help — помощь. Уведомления админу о покупках.
 * @module services/bot
 */

const { Bot, InlineKeyboard } = require('grammy');
const db = require('../db');
const telemt = require('./telemtApi');
const { clientLinks } = require('./links');
const { getAll } = require('../routes/settings');
const logger = require('../utils/logger');

/** @type {Bot|null} */
let bot = null;

/** Подставляет переменные {имя}, {ссылка}, {дата} в шаблон. */
function renderTemplate(text, vars = {}) {
    return String(text || '')
        .replaceAll('{имя}', vars.name || '')
        .replaceAll('{ссылка}', vars.link || '')
        .replaceAll('{дата}', vars.date || '');
}

/** Клавиатура с тарифами. */
function tariffsKeyboard() {
    const tariffs = db.prepare('SELECT * FROM tariffs WHERE enabled = 1 ORDER BY days').all();
    const kb = new InlineKeyboard();
    for (const t of tariffs) {
        kb.text(`${t.name} — ${t.price} ${t.currency}`, `buy:${t.id}`).row();
    }
    kb.text('📱 Мой доступ', 'my').row();
    return kb;
}

/** Создаёт клиента после успешной оплаты и отправляет ссылки. */
async function issueAccess(ctx, tariff, paymentId) {
    const tgId = ctx.from.id;
    const username = `tg${tgId}`;
    const settings = getAll();
    const expires = new Date(Date.now() + tariff.days * 86400000).toISOString();

    let client = db.prepare('SELECT * FROM clients WHERE username = ?').get(username);

    if (client) {
        // Продление существующего
        const base = client.expires_at && new Date(client.expires_at) > new Date()
            ? new Date(client.expires_at) : new Date();
        const newExpiry = new Date(base.getTime() + tariff.days * 86400000).toISOString();
        await telemt.patchUser(username, { expiration_rfc3339: newExpiry });
        db.prepare("UPDATE clients SET expires_at = ?, status = 'active' WHERE id = ?").run(newExpiry, client.id);
    } else {
        // Новый клиент
        const created = await telemt.createUser({
            username,
            expiration_rfc3339: expires,
        });
        const result = db.prepare(
            `INSERT INTO clients (username, secret, expires_at, telegram_id, web_enabled, mtproto_enabled)
             VALUES (?, ?, ?, ?, ?, ?)`
        ).run(
            username, created.secret, expires, tgId,
            ['web', 'both'].includes(tariff.protocols) ? 1 : 0,
            ['mtproto', 'both'].includes(tariff.protocols) ? 1 : 0
        );
        client = db.prepare('SELECT * FROM clients WHERE id = ?').get(result.lastInsertRowid);
    }

    // Помечаем платёж успешным
    db.prepare("UPDATE payments SET status = 'success', paid_at = datetime('now') WHERE id = ?").run(paymentId);

    // Отправляем ссылки
    const links = clientLinks(client, settings.mask_domain);
    let text = `✅ <b>Доступ активирован: ${tariff.name}</b>\n\n`;
    if (links.web_https) text += `🌐 Web Proxy:\n${links.web_https}\n\n`;
    if (links.mtproto_https) text += `🔌 MTProto:\n${links.mtproto_https}\n\n`;
    text += `📅 Действует до: ${new Date(client.expires_at).toLocaleDateString('ru-RU')}`;

    await ctx.reply(text, { parse_mode: 'HTML' });

    // Уведомление админу
    if (settings.notify_admin && settings.tg_admin_chat_id) {
        const notifier = require('./notifier');
        notifier.notifyAdmin(settings,
            `💰 <b>Новая покупка!</b>\nКлиент: ${username}\nТариф: ${tariff.name} (${tariff.price} ${tariff.currency})`
        ).catch(() => {});
    }
}

/**
 * Запускает бота, если настроен токен. Останавливает предыдущий экземпляр.
 */
async function start() {
    const settings = getAll();
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

    // /start — приветствие + тарифы
    bot.command('start', async (ctx) => {
        const text = renderTemplate(
            botSettings.welcome_text || 'Здравствуйте, {имя}! Выберите тариф для подключения:',
            { name: ctx.from.first_name }
        );
        await ctx.reply(text, { reply_markup: tariffsKeyboard() });
    });

    // Выбор тарифа → создаём платёж
    bot.callbackQuery(/^buy:(\d+)$/, async (ctx) => {
        const tariff = db.prepare('SELECT * FROM tariffs WHERE id = ? AND enabled = 1').get(Number(ctx.match[1]));
        if (!tariff) return ctx.answerCallbackQuery('Тариф недоступен');

        const result = db.prepare(
            'INSERT INTO payments (tariff_id, amount, currency, provider, status) VALUES (?, ?, ?, ?, ?)'
        ).run(tariff.id, tariff.price, tariff.currency, 'manual', 'pending');

        // Пока что — инструкция по оплате (провайдеры подключаются в настройках)
        await ctx.answerCallbackQuery();
        await ctx.reply(
            `💳 <b>Оплата тарифа «${tariff.name}»</b>\n\n` +
            `Сумма: ${tariff.price} ${tariff.currency}\n` +
            `Номер заказа: <code>#${result.lastInsertRowid}</code>\n\n` +
            `${botSettings.payment_instructions || 'Свяжитесь с администратором для оплаты и укажите номер заказа.'}`,
            { parse_mode: 'HTML' }
        );
    });

    // Мой доступ
    bot.callbackQuery('my', async (ctx) => {
        const client = db.prepare('SELECT * FROM clients WHERE telegram_id = ?').get(ctx.from.id);
        await ctx.answerCallbackQuery();
        if (!client) return ctx.reply('У вас пока нет активного доступа. Выберите тариф: /start');
        const links = clientLinks(client, getAll().mask_domain);
        let text = `📱 <b>Ваш доступ</b>\n📅 До: ${new Date(client.expires_at).toLocaleDateString('ru-RU')}\n\n`;
        if (links.web_https) text += `🌐 Web Proxy:\n${links.web_https}\n\n`;
        if (links.mtproto_https) text += `🔌 MTProto:\n${links.mtproto_https}`;
        await ctx.reply(text, { parse_mode: 'HTML' });
    });

    bot.command('help', (ctx) =>
        ctx.reply('Команды:\n/start — выбрать тариф\nПо вопросам пишите в поддержку.')
    );

    bot.catch((err) => logger.error('Ошибка TG-бота', { error: err.message }));

    // Запускаем long polling в фоне
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

/** Настройки бота из таблицы settings (префикс bot_). */
function getBotSettings() {
    const all = getAll();
    const stored = all.bot_settings || {};
    return { enabled: false, currency: 'RUB', ...stored };
}

/** Работает ли бот сейчас. */
const isRunning = () => bot !== null;

module.exports = { start, stop, isRunning, getBotSettings, issueAccess };
