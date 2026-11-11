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

const { Bot, InlineKeyboard, Keyboard, InputFile } = require('grammy');
const path = require('path');
const fs = require('fs');
const db = require('../db');
const { deductBalanceSpread } = require('../utils/balance');
const referral = require('../utils/referral');
const nodesService = require('./nodes');
const promoService = require('./promo');
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

// Ожидание ввода промокода: tgId -> timestamp запроса (TTL 10 минут)
const promoInput = new Map();
// Ожидание своей суммы пополнения. Держим в БД, а не в памяти процесса:
// перезапуск панели (например, сразу после обновления) стирал Map целиком,
// и введённая сумма молча проглатывалась — пользователь не получал
// никакого ответа. Срок ожидания ограничен, чтобы просроченное состояние
// не съедало обычные сообщения пользователя.
const AWAIT_AMOUNT_TTL_MS = 30 * 60 * 1000;

function isAwaitingAmount(tgId) {
    try {
        const row = db.prepare('SELECT awaiting_amount_until FROM bot_users WHERE telegram_id = ?').get(tgId);
        if (!row || !row.awaiting_amount_until) return false;
        if (Date.now() > Number(row.awaiting_amount_until)) {
            clearAwaitingAmount(tgId);
            return false;
        }
        return true;
    } catch {
        return false;
    }
}

function startAwaitingAmount(tgId) {
    const until = Date.now() + AWAIT_AMOUNT_TTL_MS;
    try {
        db.prepare(
            `INSERT INTO bot_users (telegram_id, awaiting_amount_until)
             VALUES (?, ?)
             ON CONFLICT(telegram_id) DO UPDATE SET awaiting_amount_until = excluded.awaiting_amount_until`
        ).run(tgId, until);
    } catch (e) {
        logger.warn('deposit: не удалось сохранить ожидание суммы', { tgId, error: e.message });
    }
}

function clearAwaitingAmount(tgId) {
    try {
        db.prepare('UPDATE bot_users SET awaiting_amount_until = NULL WHERE telegram_id = ?').run(tgId);
    } catch { /* не критично */ }
}

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
 * Цена тарифа в Telegram Stars (автоконверт по курсу из настроек, округление вверх).
 * @returns {number|null} null — Stars выключены или цена выше лимита инвойса (2500 ⭐)
 */
function starsPrice(tariff, settings) {
    if (!settings.stars_enabled) return null;
    const isUsdLike = tariff.currency === 'USD' || tariff.currency === 'USDT';
    const rate = isUsdLike
        ? (Number(settings.stars_rate_usd) || 0.02)
        : (Number(settings.stars_rate_rub) || 2);
    const stars = Math.max(1, Math.ceil((Number(tariff.price) || 0) / rate));
    if (stars > 2500) {
        logger.warn('Stars: цена превышает лимит инвойса 2500 ⭐', { tariffId: tariff.id, stars });
        return null;
    }
    return stars;
}

/**
 * Формат времени по Москве с точностью до секунды.
 * Пример: 20.09.26 15:34:39 МСК
 */
function fmtMSK(date, withSeconds = true) {
    const opts = {
        timeZone: 'Europe/Moscow',
        day: '2-digit', month: '2-digit', year: '2-digit',
        hour: '2-digit', minute: '2-digit',
    };
    if (withSeconds) opts.second = '2-digit';
    return new Date(date).toLocaleString('ru-RU', opts) + ' МСК';
}

/** Адрес мини-аппа (или null — домен не настроен/не настоящий). */
function miniAppUrl() {
    try {
        const cfg = require('../config');
        const url = `https://${cfg.domain}/miniapp`;
        return /^https:\/\/[a-z0-9.-]+\.[a-z]{2,}/i.test(url) ? url : null;
    } catch {
        return null;
    }
}

/** Дружелюбное имя прокси: tg123456789x2 → «Мой прокси №2» (код остаётся для поддержки). */
function proxyTitle(username) {
    const m = /x(\d+)$/.exec(String(username || ''));
    return m ? `Мой прокси №${m[1]}` : String(username);
}

/** Текстовый бар заполнения (10 ячеек) — для трафика. */
function usageBar(pct) {
    const filled = Math.round(Math.max(0, Math.min(100, pct)) / 10);
    return '█'.repeat(filled) + '░'.repeat(10 - filled);
}

/** Кнопки подключения по ссылкам — для карточки прокси и сообщений о покупке/тесте. */
function connectKeyboard(client) {
    const links = clientLinks(client);
    const kb = new InlineKeyboard();
    if (links.web_https) kb.url('🌐 Подключить Web Proxy', links.web_https).row();
    if (links.mtproto_https) kb.url('🔌 Подключить MTProto', links.mtproto_https);
    if (links.mtproto_faketls_https) kb.url('🛡 MTProto Fake TLS (обход DPI)', links.mtproto_faketls_https);
    kb.row();
    return kb;
}

/** Показ экрана кабинета: правим текущее сообщение (чат не превращается в свиток),
 *  при неудаче — отправляем новое. «message is not modified» молча игнорируем. */
async function showScreen(ctx, view) {
    const extra = { parse_mode: 'HTML', reply_markup: view.kb, disable_web_page_preview: true };
    try {
        await ctx.editMessageText(view.text, extra);
    } catch (e) {
        if (String(e.message || '').includes('message is not modified')) return;
        try { await ctx.reply(view.text, extra); } catch (e2) { logger.warn('showScreen: fallback не отправлен', { error: e2.message }); }
    }
}
/** Клавиатура с тарифами: кнопки открывают описание (info), плюс кастомные кнопки из панели. */
function tariffsKeyboard() {
    const settings = getBotSettings();
    const tariffs = db.prepare('SELECT * FROM tariffs WHERE enabled = 1 ORDER BY days').all();
    const kb = new InlineKeyboard();
    for (const t of tariffs) {
        kb.text(`${t.name} — ${t.price} ${currencySign(t.currency)}`, `info:${t.id}`).row();
    }
    kb.text('👤 Мои прокси', 'my').row();
    kb.text('💬 Поддержка', 'support').row();
    const miniUrl = miniAppUrl();
    if (miniUrl) kb.webApp('📱 Приложение', miniUrl).row();
    if (settings.status_url) kb.url('🟢 Статус сервиса', settings.status_url).row();
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
        `💵 Цена: <b>${t.price} ${currencySign(t.currency)}</b>` +
        (Number(t.days) > 0 ? ` <i>≈ ${(t.price / t.days).toFixed(1)} ${currencySign(t.currency)}/день</i>` : '')
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
    const refOff = (getAll().referral_mode || 'percent') === 'off';
    const kb = new Keyboard().resized().persistent()
        .text('🚀 Тарифы', { style: 'success' }).row()
        .text('🎁 Тест 3 часа').text('👤 Личный кабинет', { style: 'primary' }).row();
    if (refOff) {
        kb.text('🛟 Поддержка').row();
    } else {
        kb.text('🤝 Рефералы').text('🛟 Поддержка').row();
    }
    // Мини-апп из reply-клавиатуры НЕ открываем: по документации Telegram
    // web_app-кнопка нижней клавиатуры всегда отдаёт ПУСТОЙ initData —
    // приложение не может понять, кто открыл. Правильные места запуска —
    // inline web_app кнопки (тарифы/кабинет), они вход передают.
    // Запасной вход — код из /appcode.
    kb.text('📱 Как подключить').row();
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
/** Красит inline-кнопки: [подстрока текста, style] (Bot API 9.4+, поле style) */
function styleButtons(kb, mapping) {
    try {
        for (const row of kb.inline_keyboard || []) {
            for (const btn of row) {
                for (const [needle, style] of mapping) {
                    if (btn.text && btn.text.includes(needle)) btn.style = style;
                }
            }
        }
    } catch { /* некритично */ }
    return kb;
}

/** Строка с баром остатка срока подписки: «⏳ 12 дн. (40%) + ▓▓▓░░░░░░░». */
function expiryBarLine(selected) {
    if (!selected.expires_at || !selected.created_at) return '';
    const created = new Date(selected.created_at).getTime();
    const exp = new Date(selected.expires_at).getTime();
    const total = Math.max(1, exp - created);
    const left = Math.max(0, exp - Date.now());
    const pct = Math.min(100, Math.round((left / total) * 100));
    const filled = Math.round((pct / 100) * 10);
    const days = Math.ceil(left / 86400000);
    const bar = '█'.repeat(filled) + '░'.repeat(10 - filled);
    return `\n⏳ Осталось: <b>${days} дн.</b> (${pct}%)\n<code>${bar}</code>\n`;
}

/** Каталог с визуальными ассетами бота (обложка /start, гайды). */
const BOT_ASSETS_DIR = path.join(__dirname, '..', 'assets', 'bot');

/** Отправляет картинку-ассет с кэшем file_id (повторные отправки — без
 *  повторного аплоада). При сбое аккуратно уходит в текстовый fallback:
 *  сообщение пользователю теряться не должно. */
async function sendAsset(chatId, assetKey, fileName, caption, extra = {}) {
    try {
        const settingKey = `bot_asset_${assetKey}`;
        let fileId = null;
        try {
            const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(settingKey);
            fileId = JSON.parse(row?.value || '{}').file_id || null;
        } catch { /* нет записи — загрузим заново */ }
        const payload = { ...(caption ? { caption } : {}), ...extra };
        let msg = null;
        if (fileId) {
            msg = await bot.api.sendPhoto(chatId, fileId, payload);
        } else {
            const filePath = path.join(BOT_ASSETS_DIR, fileName);
            if (!fs.existsSync(filePath)) return null; // ассет не задеплоен
            msg = await bot.api.sendPhoto(chatId, new InputFile(filePath), payload);
            const fid = msg?.photo?.[msg.photo.length - 1]?.file_id;
            if (fid) {
                db.prepare(
                    "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
                ).run(settingKey, JSON.stringify({ file_id: fid }));
            }
        }
        return msg;
    } catch (e) {
        logger.warn('Картинка-ассет не отправилась — текстовый fallback', { assetKey, error: e.message });
        if (caption) {
            try { await bot.api.sendMessage(chatId, caption, extra); } catch { /* не критично */ }
        }
        return null;
    }
}

async function cabinetView(ctx, selectedId = null) {
    const clients = db.prepare(
        'SELECT * FROM clients WHERE telegram_id = ? ORDER BY id'
    ).all(ctx.from.id);
    const balance = clients.reduce((s, c) => s + (c.balance || 0), 0);

    if (clients.length === 0) {
        const kb = new InlineKeyboard().text('🚀 Выбрать тариф', 'tariffs').row()
            .text('🎁 Тест 3 часа', 'test3').row()
            .text('🎁 Промокод', 'promo');
        const miniUrl = miniAppUrl();
        if (miniUrl) kb.webApp('📱 Открыть приложение', miniUrl);
        return { text: '📱 <b>Личный кабинет</b>\n\nУ вас пока нет прокси.\nВыберите тариф или возьмите бесплатный тест!', kb };
    }

    const settings = getAll();

const shortDate = (iso) => {
    const d = new Date(iso);
    return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getFullYear()).slice(2)}`;
};

const selected = clients.find((c) => c.id === selectedId) || null;

    // ── Экран выбранного прокси: действия по нему ──
    if (selected) {
        // Данные об устройствах тянем только когда открыт конкретный прокси.
        // Раньше эти два запроса уходили при каждом открытии кабинета, включая
        // список прокси, где они не нужны — пользователь ждал их впустую.
        let activeMap = new Map();
        let webTypes = new Map();
        try {
            const telemt = require('./telemtApi');
            const [ipsRaw, sessionsRaw] = await Promise.all([
                telemt.getUsersActiveIps().catch(() => []),
                telemt.getWebSessions({ limit: 200 }).catch(() => []),
            ]);
            for (const u of ipsRaw || []) activeMap.set(u.username, u.active_ips || []);
            const uaType = (ua) => {
                const s = String(ua || '');
                if (/iPhone|iPad/i.test(s)) return '📱 iPhone';
                if (/iPad/i.test(s)) return '📱 iPad';
                if (/Android/i.test(s)) return '🤖 Android';
                if (/Windows/i.test(s)) return '🖥 Windows';
                if (/Macintosh|Mac OS/i.test(s)) return '💻 macOS';
                if (/Linux/i.test(s)) return '🐧 Linux';
                return null;
            };
            const sessList = Array.isArray(sessionsRaw) ? sessionsRaw : sessionsRaw?.sessions || [];
            for (const s of sessList) {
                if (!s.user) continue;
                const type = uaType(s.user_agent);
                if (!type) continue;
                if (!webTypes.has(s.user)) webTypes.set(s.user, new Set());
                webTypes.get(s.user).add(type);
            }
        } catch { /* Telemt недоступен */ }

        const kb = connectKeyboard(selected);
        const until = selected.expires_at ? fmtMSK(selected.expires_at, false) : '∞';
        const statusIcon = selected.status === 'active' ? '🟢 Активен' : selected.status === 'blocked' ? '🔴 Заблокирован' : '⚠️ Истёк';
        const locRow = selected.node_id ? (() => { const nd = nodesService.getNode(selected.node_id); return nd ? `${nd.emoji || '🌍'} ${nd.name}` : '🌍'; })() : '🏠 Основная';
        let text =
            `📦 <b>${proxyTitle(selected.username)}</b> · ${statusIcon}\n` +
            `<code>${selected.username}</code>\n` +
            `📅 Действует до: <b>${until}</b>\n` +
            expiryBarLine(selected) +
            `🌍 Локация: <b>${locRow}</b>\n` +
            `💰 Баланс: <b>${balance.toFixed(2)}</b>\n`;
        if (selected.status === 'active') {
            const ips = activeMap.get(selected.username) || [];
            const types = [...(webTypes.get(selected.username) || [])];
            text += `\n📱 <b>Устройства:</b> ${ips.length} из ${selected.max_ips ?? '∞'}\n`;
            if (types.length) {
                text += types.map((ty) => `   ${ty}`).join('\n') + '\n';
            } else if (ips.length > 0) {
                text += '   🔌 MTProto-клиент\n';
            }
        }

        // Расход трафика: пользователю важно видеть остаток раньше, чем
        // прокси начнёт отваливаться под конец лимита.
        const fmtGB = (bytes) => `${(Number(bytes || 0) / 1073741824).toFixed(1)} ГБ`;
        const used = Number(selected.traffic_used || 0);
        const limit = Number(selected.traffic_limit || 0);
        if (limit > 0) {
            const left = Math.max(0, limit - used);
            const pct = Math.min(100, Math.round((used / limit) * 100));
            text += `📊 <b>Трафик:</b> ${usageBar(pct)} ${pct}%\n` +
                `&#160;&#160;&#160;${fmtGB(used)} из ${fmtGB(limit)} · осталось ${fmtGB(left)}\n`;
            if (pct >= 90) text += '⚠️ Трафик почти израсходован — продлите или докупите пакет.\n';
        }

        // Подсказка «что делать» вместо голого статуса
        if (selected.status === 'blocked') {
            text += '\n🔴 Прокси заблокирован. Напишите в поддержку — разберёмся.\n';
        } else if (selected.status !== 'active') {
            text += '\n⚠️ Срок закончился. Продлите прокси, чтобы вернуть связь.\n';
        }

        // Кнопки подключения уже в kb (connectKeyboard). Рядом — текст ссылок
        // и QR: часть клиентов не открывает tg:// по нажатию, а копировать
        // из кнопки-ссылки нельзя.
        kb.text('📋 Ссылки текстом', `links:${selected.id}`);
        kb.text('📷 QR-код', `qr:${selected.id}`).row();
        kb.text('🌍 Локация', `nodeloc:${selected.id}`);
        kb.text('💳 Пополнить', 'topup');
        kb.text('🎁 Промокод', 'promo');
        kb.text('♻️ Продлить', `renew:${selected.id}`);
        if (settings.auto_renew_enabled) {
            kb.text(selected.auto_renew ? '♻️ Автопродление: ✅' : '♻️ Автопродление: ❌', `autorenew:${selected.id}`);
        }
        styleButtons(kb, [
            ['Пополнить', 'primary'],
            ['Продлить', 'success'],
            ['Автопродление: ✅', 'success'],
            ['Автопродление: ❌', 'danger'],
        ]);
        kb.row();
        const miniUrlCard = miniAppUrl();
        if (miniUrlCard) kb.webApp('📱 Приложение', miniUrlCard);
        kb.text('⬅️ Все мои прокси', 'my');
        // Переключение между прокси — список всегда внизу карточки
        const others = clients.filter((cl) => cl.id !== selected.id).slice(0, 10);
        if (others.length > 0) {
            kb.row();
            for (const o of others) {
                const st = o.status === 'active' ? '🟢' : '🔴';
                const proto = (o.web_enabled ? 'WEB' : '') + (o.mtproto_enabled ? '+MTProto' : '') || 'WEB';
                kb.text(`${st} ${proxyTitle(o.username)} · ${proto} · ${o.expires_at ? shortDate(o.expires_at) : '∞'}`, `sel:${o.id}`).row();
            }
        }
        return { text, kb, disable_web_page_preview: true };
    }

    // ── Список всех прокси: компактно, без кнопок ──
    let text = `📱 <b>Личный кабинет</b>\n💰 Баланс: <b>${balance.toFixed(2)}</b>\n\n👇 <b>Выберите прокси из списка</b> — продление, подключение и подробности\n`;

    const kb = new InlineKeyboard();
    for (const c of clients) {
        const proto = (c.web_enabled ? 'WEB' : '') + (c.mtproto_enabled ? ' + MTProto' : '') || 'WEB';
        const icon = c.status === 'active' ? '🟢' : '🔴';
        kb.text(`${icon} ${proxyTitle(c.username)} · ${proto} · до ${c.expires_at ? shortDate(c.expires_at) : '∞'}`, `sel:${c.id}`).row();
    }
    const miniUrlList = miniAppUrl();
    if (miniUrlList) kb.webApp('📱 Приложение', miniUrlList).row();
    kb.text('💳 Пополнить счёт', 'topup');
    kb.text('🎁 Промокод', 'promo').row();
    kb.text('🚀 Тарифы', 'tariffs');
    styleButtons(kb, [['Пополнить счёт', 'primary']]);
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

/**
 * Выдаёт доступ покупателю по telegram_id (вебхуки оплаты, баланс, админка).
 * Каждая покупка создаёт НОВЫЙ прокси. Начисляет реферальное вознаграждение.
 * @param {object} [opts] - { moneyIn: boolean } — платёж «живыми» деньгами
 *   (шлюз/пополнение). Покупки с внутреннего баланса (moneyIn: false) в режиме
 *   «% на баланс» повторно не вознаграждаются — % уже начислен при пополнении.
 */
async function issueAccessFor(tgId, tariff, paymentId, opts = {}) {
    const settings = getAll();
    const expires = new Date(Date.now() + tariff.days * 86400000).toISOString();

    const count = db.prepare('SELECT COUNT(*) AS c FROM clients WHERE telegram_id = ?').get(tgId).c;
    const referrerId = refPending.get(tgId)
        || db.prepare('SELECT referrer_id FROM referral_pending WHERE telegram_id = ?').get(tgId)?.referrer_id
        || null;

    // Локация: из платежа (выбор при покупке) или опцией вызова; NULL = локальный
    const payRow = paymentId
        ? db.prepare('SELECT node_id FROM payments WHERE id = ?').get(paymentId) : null;
    const nodeId = opts.nodeId !== undefined ? opts.nodeId : (payRow?.node_id || null);
    const nodeApi = nodesService.getApiForNodeId(nodeId);

    // Имя прокси: счётчик записей панели может отставать от движка (старые
    // пользователи удалены из панели, но живы в Telemt) — при «already exists»
    // подбираем следующий свободный суффикс (x3, x4, …)
    let username = `tg${tgId}x${count + 1}`;
    let created = null;
    for (let attempt = 0; attempt < 25; attempt++) {
        try {
            created = await nodeApi.createUser({
                username,
                expiration_rfc3339: expires,
                ...(tariff.max_ips ? { max_unique_ips: tariff.max_ips } : {}),
                ...(tariff.quota_gb ? { data_quota_bytes: Math.round(tariff.quota_gb * 1024 ** 3) } : {}),
                ...(tariff.rate_down_mbps ? { rate_limit_down_bps: Math.round(tariff.rate_down_mbps * 1e6) } : {}),
                ...(tariff.rate_up_mbps ? { rate_limit_up_bps: Math.round(tariff.rate_up_mbps * 1e6) } : {}),
            });
            break;
        } catch (e) {
            if (/already exists/i.test(e.message)) {
                attempt += 1;
                username = `tg${tgId}x${count + 1 + attempt}`;
                continue;
            }
            throw e;
        }
    }
    if (!created) throw new Error('Не удалось подобрать имя для нового прокси');
    const result = db.prepare(
        `INSERT INTO clients (username, secret, expires_at, telegram_id, web_enabled, mtproto_enabled, referrer_id, max_ips, quota_bytes, node_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
        username, created.secret, expires, tgId,
        ['web', 'both'].includes(tariff.protocols) ? 1 : 0,
        ['mtproto', 'both'].includes(tariff.protocols) ? 1 : 0,
        referrerId,
        tariff.max_ips ?? null,
        tariff.quota_gb ? Math.round(tariff.quota_gb * 1024 ** 3) : null,
        nodeId
    );
    const client = db.prepare('SELECT * FROM clients WHERE id = ?').get(result.lastInsertRowid);
    refPending.delete(tgId);
    db.prepare('DELETE FROM referral_pending WHERE telegram_id = ?').run(tgId);

    // Предоплаченный баланс (выданный админом / пополненный до первой покупки)
    // переносим на новый прокси
    try {
        const bu = db.prepare('SELECT balance FROM bot_users WHERE telegram_id = ?').get(tgId);
        if (bu && bu.balance > 0) {
            db.prepare('UPDATE clients SET balance = balance + ? WHERE id = ?').run(bu.balance, client.id);
            db.prepare('UPDATE bot_users SET balance = 0 WHERE telegram_id = ?').run(tgId);
            logger.info('Баланс перенесён на новый прокси', { tgId, username, amount: bu.balance });
        }
    } catch (e) {
        logger.warn('Не удалось перенести предоплаченный баланс', { error: e.message });
    }

    if (paymentId) {
        db.prepare("UPDATE payments SET status = 'success', paid_at = datetime('now') WHERE id = ?").run(paymentId);
    }

    const links = clientLinks(client);
    let text =
        `🎉 <b>Оплата прошла! Прокси готов</b>\n\n` +
        `📦 <b>${proxyTitle(username)}</b> <code>${username}</code>\n📅 Действует до: <b>${fmtMSK(expires, false)}</b>\n` +
        (nodeId ? (() => { const nd = nodesService.getNode(nodeId); return nd ? `🌍 Локация: <b>${nd.emoji || '🌍'} ${nd.name}</b>\n` : ''; })() : '') + `\n` +
        `Подключайся кнопками ниже — Telegram сам предложит добавить прокси.\n\n`;

    // Веб-кабинет: просмотр и продление без бота (ссылка постоянная)
    try {
        const qrTokens = require('./qrTokens');
        const config = require('../config');
        const wToken = qrTokens.ensureQrToken(client.id);
        if (wToken) text += `🌐 <b>Личный кабинет в вебе</b> (работает всегда):\nhttps://${config.domain}/p/${wToken}\n\n`;
    } catch { /* не критично */ }

    if (settings.status_url) text += `🟢 Статус сервиса: ${settings.status_url}\n`;

    text += `💡 Управление прокси — в разделе «👤 Личный кабинет».`;

    if (bot) {
        let connectKb = null;
        try { connectKb = connectKeyboard(client); } catch { connectKb = null; }
        await bot.api.sendMessage(tgId, text, {
            parse_mode: 'HTML', disable_web_page_preview: true,
            reply_markup: connectKb || undefined,
        }).catch((e) => logger.warn('Не удалось отправить ссылки покупателю', { tgId, error: e.message }));
    }

    const notifier = require('./notifier');
    notifier.notifyAdmin(settings,
        `💰 <b>Новая продажа!</b>\n📦 ${tariff.name} — ${tariff.price} ${currencySign(tariff.currency)}\n👤 ${username}\n📅 Доступ до ${fmtMSK(expires, false)}`
    ).catch(() => {});

    // Реферальное вознаграждение: «% на баланс» — только за живые деньги,
    // «бонусные дни» (легаси) — как раньше, на любую покупку
    const refMode = (getAll().referral_mode || 'percent');
    const moneyIn = opts.moneyIn !== undefined ? !!opts.moneyIn : Boolean(paymentId);
    if (refMode === 'days') {
        payReferralBonus(client.id, tariff.days).catch((e) =>
            logger.warn('Не удалось начислить реферальный бонус', { error: e.message }));
    } else if (refMode === 'percent' && moneyIn) {
        try {
            referral.payReferral({
                referredClientId: client.id, amount: tariff.price,
                kind: 'purchase', currency: tariff.currency,
            });
        } catch (e) {
            logger.warn('Не удалось начислить реферальный процент', { error: e.message });
        }
    }

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
    await nodesService.getApiForClient(referrer).patchUser(referrer.username, { expiration_rfc3339: newExpiry }).catch(() => {});
    db.prepare("UPDATE clients SET expires_at = ?, status = 'active' WHERE id = ?")
        .run(newExpiry, referrer.id);

    if (referrer.telegram_id && bot) {
        await bot.api.sendMessage(
            referrer.telegram_id,
            `🎁 <b>Бонус за реферала!</b>\n\nДруг купил прокси на ${purchasedDays} дн. — вам <b>+${bonus} дней</b>.\n\n${referrer.username}: до ${fmtMSK(newExpiry, false)}`,
            { parse_mode: 'HTML', reply_markup: new InlineKeyboard().text('👤 Мои прокси', 'my') }
        ).catch(() => {});
    }
}

/** Уведомление о пополнении баланса. */
async function notifyDeposit(tgId, amount) {
    if (!bot) return;
    await bot.api.sendMessage(
        tgId,
        `💰 <b>Баланс пополнен на ${amount} ${currencySign(getBotSettings().currency)}!</b>\nПродлить прокси можно в «👤 Личном кабинете».`,
        { parse_mode: 'HTML', reply_markup: new InlineKeyboard().text('👤 Мои прокси', 'my') }
    ).catch(() => {});
}

/** Отправка произвольного сообщения пользователю (админка в панели). */
async function sendMessageTo(tgId, text) {
    if (!bot) throw new Error('Бот не запущен — включите его в настройках');
    if (!text.startsWith('<')) text = `<b>${text}</b>`;
    await bot.api.sendMessage(tgId, text, { parse_mode: 'HTML' })
        .catch((e) => { throw new Error(`Telegram: ${e.message}`); });
}

/** Отправка файла (например, бэкапа базы) админу/пользователю. */
async function sendFileTo(tgId, buffer, filename) {
    if (!bot) throw new Error('Бот не запущен — включите его в настройках');
    await bot.api.sendDocument(tgId, new InputFile(buffer, filename));
}

/**
 * Рассылка свежих ссылок всем активным клиентам (после смены домена).
 * Группируем по telegram_id: одно сообщение со всеми прокси пользователя.
 * @returns {Promise<{sent: number, failed: number, total: number}>}
 */
async function broadcastNewLinks() {
    if (!bot) throw new Error('Бот не запущен — включите его в настройках');
    const clients = db.prepare(
        "SELECT * FROM clients WHERE telegram_id IS NOT NULL AND status = 'active' ORDER BY telegram_id"
    ).all();
    const maskDomain = getAll().mask_domain;

    const byUser = new Map();
    for (const c of clients) {
        if (!byUser.has(c.telegram_id)) byUser.set(c.telegram_id, []);
        byUser.get(c.telegram_id).push(c);
    }

    let sent = 0, failed = 0;
    for (const [tgId, list] of byUser) {
        let text = '🔄 <b>Домен обновлён — подключитесь заново:</b>\n';
        for (const c of list) {
            const links = clientLinks(c);
            const until = c.expires_at ? fmtMSK(c.expires_at, false) : '∞';
            text += `\n📦 <b>${c.username}</b> — до ${until}\n`;
            if (links.web_https) text += `🌐 Web: ${links.web_https}\n`;
            if (links.mtproto_https) text += `🔌 MTProto: ${links.mtproto_https}\n`;
            if (links.mtproto_faketls_https) text += `🛡 MTProto Fake TLS: ${links.mtproto_faketls_https}\n`;
        }
        text += '\nСтарые ссылки работать перестанут — нажмите свою кнопку, и Telegram переподключится сам.';
        try {
            await bot.api.sendMessage(tgId, text, { parse_mode: 'HTML', disable_web_page_preview: true });
            sent++;
        } catch { failed++; } // заблокировали бота / нет чата
        await new Promise((r) => setTimeout(r, 80)); // лимиты Telegram API
    }
    logger.info('Рассылка новых ссылок завершена', { sent, failed, total: byUser.size });
    return { sent, failed, total: byUser.size };
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
    if (s.pay_card) rows.push(`💳 Карта: <code>${s.pay_card}</code>`);
    if (s.pay_phone) rows.push(`📱 Телефон (СБП): <code>${s.pay_phone}</code>`);
    if (s.pay_bank) rows.push(`🏦 Банк: <code>${s.pay_bank}</code>`);

    const kb = new InlineKeyboard().text('✅ Я оплатил', `paid:${paymentId}`);
    const requisites = rows.length > 0
        ? rows.join('\n') + '\n\n<i>(нажмите на реквизиты — скопируются)</i>'
        : '⚠️ Реквизиты не заданы — заполните их в панели (Платёжные системы).';

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
            const label = pay.provider === 'cryptobot'
                ? '🪙 Оплатить CryptoBot (криптовалюта)'
                : '💳 Оплатить ЮKassa';
            const kb = new InlineKeyboard()
                .url(label, pay.url).row()
                .text('🏦 Карта админа', `manualpay:${paymentId}`);
            styleButtons(kb, [['Оплатить', 'success'], ['Карта админа', 'success']]);
            try { for (const row of kb.inline_keyboard) for (const btn of row) if (btn.url && btn.url.startsWith('https://t.me/')) btn.style = 'success'; } catch { /* ignore */ }
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

/* Пересланный чек содержит реквизиты плательщика. Сутки в чате
 * админа — достаточно для проверки оплаты, дольше хранить лишнее. */
const receiptDeleteTimers = new Map();

/** Ставит чек в очередь на удаление через ttl секунд. */
function scheduleReceiptDelete(chatId, messageId, ttl) {
    const key = chatId + ':' + messageId;
    if (receiptDeleteTimers.has(key)) return;
    receiptDeleteTimers.set(key, Date.now() + ttl * 1000);
    persistReceiptDeletions();
    setTimeout(() => deleteReceipt(chatId, messageId), ttl * 1000);
}

/** Удаляет сообщение с чеком и снимает его с учёта. */
async function deleteReceipt(chatId, messageId) {
    receiptDeleteTimers.delete(chatId + ':' + messageId);
    persistReceiptDeletions();
    if (!bot) return;
    try {
        await bot.api.deleteMessage(chatId, messageId);
        logger.info('Чек удалён по TTL', { chatId, messageId });
    } catch (e) {
        // «message to delete not found» — норма: админ удалил вручную
        logger.warn('Чек уже недоступен для удаления', { chatId, messageId, error: e.message });
    }
}

/** Очередь в settings: переживает рестарт панели. */
function persistReceiptDeletions() {
    try {
        const list = [...receiptDeleteTimers.entries()].map(([key, fireAt]) => ({ key, fireAt }));
        db.prepare(
            'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
        ).run('bot_receipt_deletions', JSON.stringify(list));
    } catch (e) {
        logger.warn('Не удалось сохранить очередь удаления чеков', { error: e.message });
    }
}

/** Восстановление очереди после рестарта: просроченное удаляется сразу. */
function restoreReceiptDeletions() {
    try {
        const row = db.prepare('SELECT value FROM settings WHERE key = ?').get('bot_receipt_deletions');
        if (!row) return;
        const list = JSON.parse(row.value);
        for (const { key, fireAt } of list) {
            const [chatId, messageId] = key.split(':').map(Number);
            if (!chatId || !messageId) continue;
            receiptDeleteTimers.set(key, fireAt);
            setTimeout(() => deleteReceipt(chatId, messageId), Math.max(0, fireAt - Date.now()));
        }
        if (list.length) logger.info('Очередь удаления чеков восстановлена', { count: list.length });
    } catch (e) {
        logger.warn('Не удалось восстановить очередь удаления чеков', { error: e.message });
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
            /* Чек содержит реквизиты плательщика: сутки в чате админа
             * достаточно для проверки, дольше — лишняя выдержка ПДн. */
            const RECEIPT_TTL = 24 * 3600;
            let sent = null;
            if (ctx.message.photo) {
                const best = ctx.message.photo[ctx.message.photo.length - 1].file_id;
                sent = await bot.api.sendPhoto(admin, best, { caption, parse_mode: 'HTML' });
            } else if (ctx.message.document) {
                sent = await bot.api.sendDocument(admin, ctx.message.document.file_id, { caption, parse_mode: 'HTML' });
            }
            if (sent) {
                scheduleReceiptDelete(sent.chat.id, sent.message_id, RECEIPT_TTL);
                await ctx.reply(
                    `✅ <b>Чек получен!</b> Администратор проверит оплату — доступ придёт в этот чат.\nЗаказ #${paymentId}\n\n` +
                    `<i>Чек удалится из чата администратора через сутки.</i>`,
                    { parse_mode: 'HTML' }
                );
            } else {
                await ctx.reply(`✅ <b>Чек получен!</b> Администратор проверит оплату — доступ придёт в этот чат.\nЗаказ #${paymentId}`, { parse_mode: 'HTML' });
            }
        } else {
            await ctx.reply(`✅ <b>Чек получен!</b> Администратор проверит оплату — доступ придёт в этот чат.\nЗаказ #${paymentId}`, { parse_mode: 'HTML' });
        }
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

    // ═══ 0. УЧЁТ ПОЛЬЗОВАТЕЛЕЙ + ЗАХВАТ РЕФЕРАЛОВ — раньше всех (до гейта подписки!) ═══
    bot.use(async (ctx, next) => {
        const from = ctx.from;

        // Реферальный переход: ловим ?start=ref_XXXX до гейта подписки,
        // иначе метка терялась у неподписанных новичков
        try {
            if (ctx.payload && String(ctx.payload).startsWith('ref_') && from && !from.is_bot) {
                const referrerId = referral.resolveRefPayload(ctx.payload);
                if (referrerId && !refPending.has(from.id)) {
                    // Самоприглашение (свой код/свой telegram_id) — отклоняем
                    const self = db.prepare('SELECT telegram_id FROM clients WHERE id = ?').get(referrerId);
                    if (self?.telegram_id !== from.id) {
                        refPending.set(from.id, referrerId);
                        db.prepare(
                            'INSERT INTO referral_pending (telegram_id, referrer_id) VALUES (?, ?) ' +
                            'ON CONFLICT(telegram_id) DO UPDATE SET referrer_id = excluded.referrer_id'
                        ).run(from.id, referrerId);
                        logger.info('Реферал: переход зафиксирован', { tgId: from.id, referrer: referrerId });
                    }
                }
            }
        } catch (e) {
            logger.warn('Реферал: ошибка захвата перехода', { error: e.message });
        }

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

    // ═══ 0. Своя сумма пополнения — до гейта подписки, чтобы текст не проглатывался ═══
    /* Чек от клиента: фото или PDF. Без этой подписки бот молча
 * игнорировал вложения — пересылка админу не работала. */
bot.on(['message:photo', 'message:document'], async (ctx) => {
    try { await handleReceipt(ctx); } catch (e) {
        logger.error('Ошибка обработки чека', { error: e.message });
    }
});

bot.on('message:text', async (ctx, next) => {
        if (!isAwaitingAmount(ctx.from.id)) return next();
        logger.info('deposit: получена сумма', { tgId: ctx.from.id, text: ctx.message.text });
        // Пользователь часто дописывает валюту — «1 200 ₽» — и это должно
        // работать, тем более что знак ₽ стоит на самих кнопках. Убираем
        // пробелы и символы валют, оставляя только число, и строго проверяем
        // результат: мусор вроде «купи пива» числом не пройдёт.
        const cleaned = String(ctx.message.text)
            .replace(/\s/g, '')
            .replace(/[₽$€]|руб\.?|р\.?/gi, '')
            .replace(/usdt|usd|rub/gi, '');
        if (!/^\d+([.,]\d{1,2})?$/.test(cleaned)) {
            // Не число — не снимаем ожидание: человек мог случайно отправить
            // слово и сейчас напишет нормальную сумму.
            return ctx.reply('⚠️ Нужна сумма числом, например: 250. Или нажмите «Отмена».', {
                reply_markup: new InlineKeyboard().text('✖️ Отмена', 'deposit:cancel'),
            });
        }
        const amount = Number(cleaned.replace(',', '.'));
        if (!Number.isFinite(amount) || amount <= 0 || amount > 1000000) {
            return ctx.reply('⚠️ Введите сумму одним числом от 1 до 1 000 000, например: 250');
        }
        clearAwaitingAmount(ctx.from.id);
        logger.info('deposit: создаю счёт', { tgId: ctx.from.id, amount });
        await createAndSendDeposit(ctx, Math.round(amount));
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
        promoInput.delete(ctx.from.id); // /start сбрасывает режим ввода промокода
        if (ctx.payload && ctx.payload.startsWith('ref_')) {
            const referrerId = referral.resolveRefPayload(ctx.payload);
            const self = referrerId
                ? db.prepare('SELECT telegram_id FROM clients WHERE id = ?').get(referrerId) : null;
            if (referrerId && self?.telegram_id !== ctx.from.id) {
                refPending.set(ctx.from.id, referrerId);
                db.prepare(
                    'INSERT INTO referral_pending (telegram_id, referrer_id) VALUES (?, ?) ' +
                    'ON CONFLICT(telegram_id) DO UPDATE SET referrer_id = excluded.referrer_id'
                ).run(ctx.from.id, referrerId);
                // Бэкфилл: прокси получен до перехода — проставляем сразу
                const backfilled = db.prepare(
                    'UPDATE clients SET referrer_id = ? WHERE telegram_id = ? AND referrer_id IS NULL'
                ).run(referrerId, ctx.from.id);
                if (backfilled.changes > 0) {
                    logger.info('Реферал: referrer проставлен задним числом', { tgId: ctx.from.id, referrer: referrerId });
                }
                logger.info('Реферал: переход по ссылке зафиксирован', { tgId: ctx.from.id, referrer: referrerId });
            } else if (referrerId && self?.telegram_id === ctx.from.id) {
                logger.warn('Реферал: самоприглашение отклонено', { tgId: ctx.from.id });
            }
        }
        const text = renderTemplate(
            botSettings.welcome_text || DEFAULT_WELCOME,
            { name: ctx.from.first_name }
        );
        // Обложка: тихо, кэш file_id, при сбое — просто текст без неё
        await sendAsset(ctx.chat.id, 'cover', 'cover-start.png', null, { disable_notification: true }).catch(() => {});
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

    bot.hears(['👤 Личный кабинет', '📱 Личный кабинет'], async (ctx) => {
        const view = await cabinetView(ctx);
        await ctx.reply(view.text, { parse_mode: 'HTML', reply_markup: view.kb, disable_web_page_preview: true });
    });

    // «⬅️ Назад» из экранов кабинета — правим сообщение на месте
    bot.callbackQuery('cabinet', async (ctx) => {
        await ctx.answerCallbackQuery();
        const view = await cabinetView(ctx);
        await showScreen(ctx, view);
    });

    bot.callbackQuery(/^sel:(\d+)$/, async (ctx) => {
        await ctx.answerCallbackQuery();
        // Карточка тянет устройства/сессии из Telemt — показываем «печатает…»
        await ctx.api.sendChatAction(ctx.chat.id, 'typing').catch(() => {});
        const view = await cabinetView(ctx, Number(ctx.match[1]));
        await showScreen(ctx, view);
    });

    // Ссылки обычным текстом: их можно скопировать и вставить руками.
    // Кнопки-ссылки Telegram в этом не позволяют, а часть клиентов
    // не открывает tg:// по нажатию.
    bot.callbackQuery(/^links:(\d+)$/, async (ctx) => {
        await ctx.answerCallbackQuery();
        const client = db.prepare('SELECT * FROM clients WHERE id = ? AND telegram_id = ?')
            .get(Number(ctx.match[1]), ctx.from.id);
        if (!client) {
            return ctx.reply('❌ Прокси не найден.', { parse_mode: 'HTML' });
        }
        const links = clientLinks(client);
        const lines = [`<b>${client.username} — ссылки для подключения</b>`, ''];
        if (links.web_https) lines.push('🌐 <b>Web Proxy</b> (Telegram Desktop, Android, iOS):', links.web_https, '');
        if (links.mtproto_https) lines.push('🔌 <b>MTProto</b>:', links.mtproto_https, '');
        if (links.mtproto_faketls_https) {
            lines.push('🛡 <b>MTProto Fake TLS</b> — если обычный не подключается:', links.mtproto_faketls_https, '');
        }
        if (lines.length <= 1) {
            return ctx.reply('❌ Для этого прокси нет доступных ссылок.', { parse_mode: 'HTML' });
        }
        lines.push('Скопируйте нужную ссылку и откройте её в Telegram или вставьте в настройках прокси.');
        await ctx.reply(lines.join('\n'), {
            parse_mode: 'HTML',
            disable_web_page_preview: true,
        });
    });

    bot.hears('🤝 Рефералы', async (ctx) => {
        const settings = getAll();
        const mode = settings.referral_mode || 'percent';
        let botUsername = '';
        try { botUsername = (await bot.api.getMe()).username; } catch { /* нет связи */ }
        const me = db.prepare('SELECT id FROM clients WHERE telegram_id = ?').get(ctx.from.id);
        if (!me) {
            return ctx.reply(
                '🤝 <b>Реферальная программа</b>\n\nСтанет доступна после получения прокси — возьмите тариф или бесплатный тест!',
                { parse_mode: 'HTML' }
            );
        }
        const code = referral.ensureReferralCode(me.id);
        const st = referral.userStats(me.id);
        const link = botUsername && code ? `https://t.me/${botUsername}?start=ref_${code}` : 'появится позже';

        let rewardText;
        let earnedLine = '\n';
        if (mode === 'percent') {
            const sign = settings.currency === 'RUB' ? '₽' : settings.currency === 'USD' ? '$' : settings.currency === 'EUR' ? '€' : settings.currency || '';
            rewardText =
                `Приглашайте друзей — получайте <b>${settings.referral_percent ?? 10}% с каждой их оплаты</b> прямо на баланс!\n` +
                `Балансом можно продлевать прокси без оплаты картой.`;
            earnedLine = `💵 Заработано: <b>${st.earned}${sign ? ' ' + sign : ''}</b>\n\n`;
        } else if (mode === 'days') {
            rewardText =
                `Приглашайте друзей — получайте <b>бесплатные дни</b>:\n` +
                `• Друг покупает 1 месяц → вам <b>+10 дней</b>\n` +
                `• 2 месяца и больше → <b>+25% срока</b>`;
        } else {
            rewardText = 'Реферальная программа сейчас отключена, но ваша ссылка уже готова — вдруг включат 😉';
        }

        await ctx.reply(
            `🤝 <b>Реферальная программа</b>\n\n${rewardText}\n\n` +
            `👥 Приглашено: <b>${st.invited + st.pending}</b>${st.pending > 0 ? ` (${st.invited} с прокси, ${st.pending} присматриваются)` : ''}\n` +
            earnedLine +
            `🔗 <b>Ваша ссылка:</b>\n<code>${link}</code>\n\n` +
            `Друг переходит по ссылке — и он закрепляется за вами навсегда: вознаграждение капает с каждой его оплаты.`,
            { parse_mode: 'HTML', disable_web_page_preview: true }
        );
    });

    bot.hears('🛟 Поддержка', (ctx) => {
        const statusUrl = getBotSettings().status_url;
        const statusLine = statusUrl ? `\n\n🟢 <a href="${statusUrl}">Проверить, работает ли сервис</a>` : '';
        ctx.reply(`🛟 <b>Поддержка</b>\n\nПо любым вопросам пишите:\n👤 ${SUPPORT_USERNAME}${statusLine}`, { parse_mode: 'HTML' });
    });

    // ═══ Инструкции подключения: выбор платформы → шаги ═══
    function connectScreen() {
        const kb = new InlineKeyboard()
            .text('🖥 Windows', 'guide:win').text('🍎 macOS', 'guide:mac').row()
            .text('📱 iOS (iPhone)', 'guide:ios').text('🤖 Android', 'guide:android').row()
            .text('👤 Открыть кабинет', 'my');
        return {
            text: '📖 <b>Как подключить прокси</b>\n\nСамый простой способ — нажать на кнопку подключения ' +
                'в «👤 Личном кабинете»: Telegram сам предложит добавить прокси.\n\nВыберите вашу платформу для подробной инструкции:',
            kb,
        };
    }
    bot.hears(['📖 Как подключить', '📱 Как подключить'], async (ctx) => {
        const v = connectScreen();
        await ctx.reply(v.text, { parse_mode: 'HTML', reply_markup: v.kb });
    });
    bot.callbackQuery('connect', async (ctx) => {
        await ctx.answerCallbackQuery();
        await showScreen(ctx, connectScreen());
    });

    bot.callbackQuery(/^guide:(win|mac|ios|android)$/, async (ctx) => {
        await ctx.answerCallbackQuery();
        const guides = {
            win: `🖥 <b>Windows (Telegram Desktop)</b>\n\n` +
                `1️⃣ В «📱 Личном кабинете» нажмите «🌐 Подключить ВЕБ прокси» или «🔌 Подключить MTProto» — Telegram сам предложит добавить прокси.\n\n` +
                `2️⃣ Вручную: ☰ → Настройки → Продвинутые настройки → Тип соединения → «Использовать свой прокси» → Добавить прокси → вставьте сервер, порт и секрет из кабинета.`,
            mac: `🍎 <b>macOS</b>\n\n` +
                `1️⃣ В «📱 Личном кабинете» нажмите «🌐 Подключить ВЕБ прокси» или «🔌 Подключить MTProto» — Telegram сам предложит добавить прокси.\n\n` +
                `2️⃣ Вручную: Настройки → Продвинутые → Тип соединения → «Использовать свой прокси» → Добавьте сервер, порт и секрет из кабинета.`,
            ios: `📱 <b>iPhone (iOS)</b>\n\n` +
                `1️⃣ В «👤 Личном кабинете» нажмите «🌐 Подключить Web Proxy» или «🔌 Подключить MTProto» — Telegram сам предложит добавить прокси.\n\n` +
                `2️⃣ Вручную: Настройки → Данные и хранилище → Прокси → Добавить прокси → вставьте сервер, порт и секрет.`,
            android: `🤖 <b>Android</b>\n\n` +
                `1️⃣ В «📱 Личном кабинете» нажмите ссылку подключения — Telegram предложит добавить прокси.\n\n` +
                `2️⃣ Вручную: Настройки → Данные и память → Настройки прокси → Добавить прокси → вставьте данные из кабинета.`,
        };
        const platform = ctx.match[1];
        const guideKb = new InlineKeyboard()
            .text('👤 Открыть кабинет', 'my').row()
            .url('🛟 Написать в поддержку', 'https://t.me/' + SUPPORT_USERNAME.slice(1)).row()
            .text('⬅️ К платформам', 'connect');
        await sendAsset(ctx.chat.id, `guide_${platform}`, `guide-${platform}.png`, guides[platform], {
            parse_mode: 'HTML', disable_web_page_preview: true, reply_markup: guideKb,
        });
    });

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
        await showScreen(ctx, { text: '♻️ <b>Выберите тариф продления:</b>', kb: renewKeyboard(clientId) });
    });

    bot.callbackQuery(/^renewmode:(\d+):(web|mtproto|both)$/, async (ctx) => {
        const clientId = Number(ctx.match[1]);
        const mode = ctx.match[2];
        const has = db.prepare('SELECT COUNT(*) AS c FROM tariffs WHERE enabled = 1 AND protocols = ?').get(mode).c;
        if (!has) {
            return ctx.answerCallbackQuery({ text: 'Нет тарифов этого типа — выберите другой вариант', show_alert: true });
        }
        await ctx.answerCallbackQuery();
        await showScreen(ctx, { text: '♻️ <b>Выберите тариф продления:</b>', kb: renewKeyboard(clientId, mode) });
    });

    // Переключатель автопродления с баланса (для конкретного прокси)
    bot.callbackQuery(/^autorenew:(\d+)$/, async (ctx) => {
        const client = db.prepare('SELECT * FROM clients WHERE id = ?').get(Number(ctx.match[1]));
        if (!client || client.telegram_id !== ctx.from.id) {
            return ctx.answerCallbackQuery({ text: 'Это не ваш прокси', show_alert: true });
        }
        const next = client.auto_renew ? 0 : 1;
        db.prepare('UPDATE clients SET auto_renew = ? WHERE id = ?').run(next, client.id);
        await ctx.answerCallbackQuery(next ? '✅ Автопродление включено' : 'Автопродление выключено');
        // Возвращаем пользователя на ТУ ЖЕ карточку, а не в список прокси
        const view = await cabinetView(ctx, client.id);
        await showScreen(ctx, view);
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
        try { for (const row of kb.inline_keyboard) for (const btn of row) if (btn.callback_data?.startsWith('deposit:')) btn.style = 'primary'; } catch { /* ignore */ }
        await showScreen(ctx, {
            text: `💳 <b>Пополнение счёта</b>\n` +
                `💰 Текущий баланс: <b>${totalBalance(ctx.from.id).toFixed(2)} ${sign}</b>\n\n` +
                `Балансом можно продлевать прокси в один тап — без карты.\n\n👇 <b>Выберите сумму:</b>`,
            kb,
        });
    });

    bot.callbackQuery('deposit:custom', async (ctx) => {
        await ctx.answerCallbackQuery();
        startAwaitingAmount(ctx.from.id);
        await ctx.reply(
            '✏️ Введите сумму пополнения одним числом (например: 250).\n\n' +
            'Если передумали — нажмите «Отмена».',
            { reply_markup: new InlineKeyboard().text('✖️ Отмена', 'deposit:cancel') }
        );
    });

    // Выход из ожидания суммы: без него пользователь остался бы в состоянии,
    // где любое его сообщение бот пытается прочитать как сумму.
    bot.callbackQuery('deposit:cancel', async (ctx) => {
        await ctx.answerCallbackQuery();
        clearAwaitingAmount(ctx.from.id);
        await ctx.reply('Отменено. Выберите сумму заново через «Пополнить счёт».');
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
        await showScreen(ctx, { text: tariffDescription(t), kb });
    });

    // Локация выбрана → экран способа оплаты (платёж запоминает локацию)
    bot.callbackQuery(/^loc:(\d+):(\d+)$/, async (ctx) => {
        const tariff = db.prepare('SELECT * FROM tariffs WHERE id = ? AND enabled = 1').get(Number(ctx.match[1]));
        if (!tariff) return ctx.answerCallbackQuery('Тариф недоступен');
        const nodeId = Number(ctx.match[2]) || null;
        if (nodeId && !nodesService.getNode(nodeId)) {
            return ctx.answerCallbackQuery({ text: 'Локация недоступна — выберите другую', show_alert: true });
        }
        await ctx.answerCallbackQuery();
        await showPurchaseMethods(ctx, tariff, nodeId);
    });

    // Покупка тарифа: локация (если их несколько) → способ оплаты
    bot.callbackQuery(/^buy:(\d+)$/, async (ctx) => {
        const tariff = db.prepare('SELECT * FROM tariffs WHERE id = ? AND enabled = 1').get(Number(ctx.match[1]));
        if (!tariff) return ctx.answerCallbackQuery('Тариф недоступен');
        await ctx.answerCallbackQuery(); // отвечаем сразу — health-пробы узлов могут занять секунды
        // Несколько локаций — предлагаем выбор (одна — сразу к оплате)
        const locations = await nodesService.availableLocations();
        if (locations.length > 1) {
            const kb = new InlineKeyboard();
            for (const loc of locations) {
                kb.text(`${loc.emoji} ${loc.name}`, `loc:${tariff.id}:${loc.id ?? 0}`).row();
            }
            kb.text('⬅️ К тарифам', 'tariffs');
            return showScreen(ctx, {
                text: '🌍 <b>Выберите локацию</b>\n\nПинг и скорость зависят от близости сервера — выбирайте ближайшую к вам.',
                kb,
            });
        }

        return showPurchaseMethods(ctx, tariff, null);
    });

    /** Экран выбора способа оплаты для покупки тарифа. */
    async function showPurchaseMethods(ctx, tariff, nodeId = null) {
        const settings = getBotSettings();

        // Активированный промокод-скидка: ревалидируем (срок/лимиты могли истечь
        // после активации) — протухший снимаем и считаем полную цену
        let pendingPromo = null;
        const pendingCode = db.prepare('SELECT pending_promo FROM bot_users WHERE telegram_id = ?')
            .get(ctx.from.id)?.pending_promo || null;
        if (pendingCode) {
            const v = promoService.validate(pendingCode, ctx.from.id);
            if (v.ok && v.promo.kind === 'percent') pendingPromo = v.promo;
            else db.prepare('UPDATE bot_users SET pending_promo = NULL WHERE telegram_id = ?').run(ctx.from.id);
        }
        const finalPrice = pendingPromo ? promoService.discountedPrice(tariff.price, pendingPromo) : tariff.price;

        // Заказ создаётся сразу — любой способ привяжется к нему (node_id — локация,
        // promo_code — активированная скидка, amount — цена со скидкой)
        const paymentId = db.prepare(
            'INSERT INTO payments (tariff_id, amount, currency, provider, status, telegram_id, node_id, promo_code) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
        ).run(tariff.id, finalPrice, tariff.currency, 'manual', 'pending', ctx.from.id, nodeId, pendingPromo?.code ?? null).lastInsertRowid;

        const kb = new InlineKeyboard();

        // Баланс (если хватает) — первый способ
        const balance = totalBalance(ctx.from.id);
        if (balance >= finalPrice) {
            kb.text(`💰 С баланса (${balance.toFixed(2)})`, `paybal:${tariff.id}:${paymentId}`).row();
        }

        // Онлайн-платёжка (инвойс создаётся по клику)
        if (settings.cryptobot_token) kb.text('🪙 Оплатить через CryptoBot', `cbpay:${paymentId}:${tariff.id}:cryptobot`).row();
        if (settings.yookassa_shop_id && settings.yookassa_secret_key) kb.text('💳 Оплатить через ЮKassa', `cbpay:${paymentId}:${tariff.id}:yookassa`).row();

        // Telegram Stars (инвойс в чат) — от цены заказа со скидкой
        const stars = starsPrice({ ...tariff, price: finalPrice }, settings);
        if (stars) kb.text(`⭐ Оплатить звёздами (${stars} ⭐)`, `starspay:${paymentId}`).row();

        // Карта админа — всегда доступна
        kb.text('🏦 Карта админа (СБП)', `manualpay:${paymentId}`).row();
        kb.text('⬅️ К тарифам', 'tariffs');

        const locLine = nodeId ? (() => { const nd = nodesService.getNode(nodeId); return nd ? `🌍 Локация: <b>${nd.emoji || '🌍'} ${nd.name}</b>\n\n` : ''; })() : '';
        const promoLine = pendingPromo
            ? `🎁 Промокод <b>${pendingPromo.code}</b>: цена ${tariff.price} → <b>${finalPrice} ${currencySign(tariff.currency)}</b>\n\n`
            : '';
        await ctx.reply(
            `${tariffDescription(tariff)}\n\n${locLine}${promoLine}🧾 Заказ #${paymentId}\n\n💳 <b>Выберите способ оплаты:</b>`,
            { parse_mode: 'HTML', reply_markup: kb }
        );
    }

    // Покупка с баланса: списание + выдача нового прокси
    bot.callbackQuery(/^paybal:(\d+):(\d+)$/, async (ctx) => {
        const tariff = db.prepare('SELECT * FROM tariffs WHERE id = ? AND enabled = 1').get(Number(ctx.match[1]));
        const paymentId = Number(ctx.match[2]);
        if (!tariff) return ctx.answerCallbackQuery('Тариф недоступен');
        // Цена заказа (может быть со скидкой по промокоду)
        const payRow = db.prepare('SELECT amount, promo_code FROM payments WHERE id = ?').get(paymentId);
        const price = Number(payRow?.amount ?? tariff.price);
        const balance = totalBalance(ctx.from.id);
        if (balance < price) {
            return ctx.answerCallbackQuery({ text: 'Недостаточно средств на балансе', show_alert: true });
        }
        await ctx.answerCallbackQuery('Оформляю...');

        // Атомарное списание с проверкой покрытия — закрывает гонку двойного клика
        const { ok, touched } = deductBalanceSpread(ctx.from.id, price);
        if (!ok) {
            return ctx.answerCallbackQuery({ text: 'Недостаточно средств на балансе', show_alert: true });
        }
        try {
            await issueAccessFor(ctx.from.id, tariff, paymentId, { moneyIn: false });
            // Промокод-скидка использована: списываем применение (иначе скидка
            // останется активной навсегда — путь с балансом идёт мимо completePayment)
            if (payRow?.promo_code) {
                try { promoService.consumePercent(payRow.promo_code, ctx.from.id); }
                catch (e2) { logger.warn('Промокод: не удалось списать', { error: e2.message }); }
            }
        } catch (e) {
            // Возврат ровно затронутым строкам (а не всем клиентам по telegram_id)
            db.transaction((rows) => {
                for (const t of rows) {
                    db.prepare('UPDATE clients SET balance = balance + ? WHERE id = ?').run(t.amount, t.id);
                }
            })(touched);
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
        // Цена заказа (со скидкой по промокоду)
        tariff.price = Number(payment.amount ?? tariff.price);
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

    // Telegram Stars: отправляем инвойс прямо в чат (payload = paymentId)
    bot.callbackQuery(/^starspay:(\d+)$/, async (ctx) => {
        const paymentId = Number(ctx.match[1]);
        const payment = db.prepare('SELECT * FROM payments WHERE id = ?').get(paymentId);
        const tariff = payment ? db.prepare('SELECT * FROM tariffs WHERE id = ?').get(payment.tariff_id) : null;
        if (!payment || payment.status !== 'pending' || !tariff) {
            return ctx.answerCallbackQuery('Заказ не найден');
        }
        const settings = getBotSettings();
        const payRow = db.prepare('SELECT amount FROM payments WHERE id = ?').get(paymentId);
        const stars = starsPrice({ ...tariff, price: Number(payRow?.amount ?? tariff.price) }, settings);
        if (!stars) return ctx.answerCallbackQuery({ text: 'Оплата звёздами недоступна', show_alert: true });

        await ctx.answerCallbackQuery();
        const description = payment.client_id
            ? `Продление прокси на ${tariff.days} дн.`
            : `Доступ на ${tariff.days} дн.`;
        await ctx.api.sendInvoice(
            ctx.from.id,
            `TGGATE: ${tariff.name}`,
            description,
            String(paymentId),
            'XTR',
            [{ label: tariff.name, amount: stars }]
        ).catch(async (e) => {
            logger.error('Stars: sendInvoice не удался', { paymentId, error: e.message });
            await sendManualInstructions(ctx, paymentId, `${tariff.price} ${currencySign(tariff.currency)}`);
        });
    });

    // Pre-checkout: заказ должен существовать и быть в статусе pending (ответ ≤ 10 сек)
    bot.on('pre_checkout_query', async (ctx) => {
        const paymentId = Number(ctx.preCheckoutQuery.invoice_payload);
        const ok = !!db.prepare("SELECT id FROM payments WHERE id = ? AND status = 'pending'").get(paymentId);
        if (ok) return ctx.answerPreCheckoutQuery(true);
        return ctx.answerPreCheckoutQuery(false, { error_message: 'Заказ не найден или уже оплачен — создайте новый' });
    });

    // Успешная оплата звёздами → та же логика выдачи/продления, что и у других способов
    bot.on('message:successful_payment', async (ctx) => {
        const paymentId = Number(ctx.message.successful_payment.invoice_payload);
        logger.info('Stars: оплата получена', { paymentId, charge: ctx.message.successful_payment.telegram_payment_charge_id });
        try {
            const paymentsRoute = require('../routes/payments');
            await paymentsRoute.completePayment(paymentId);
        } catch (e) {
            logger.error('Stars: ошибка обработки платежа', { paymentId, error: e.message });
            await ctx.reply(
                `⚠️ Оплата прошла (#${paymentId}), но выдать доступ автоматически не удалось.\nНапишите в поддержку ${SUPPORT_USERNAME} — всё решим.`,
                { parse_mode: 'HTML' }
            );
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

    async function issueTestAccess(ctx) {
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
            return ctx.reply('😕 Бесплатный тест даётся один раз — выберите тариф:', {
                reply_markup: new InlineKeyboard().text('🚀 К тарифам', 'tariffs'),
            });
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
                `INSERT INTO clients (username, secret, expires_at, telegram_id, web_enabled, mtproto_enabled, referrer_id, max_ips)
                 VALUES (?, ?, ?, ?, 1, 1, ?, 2)`
            ).run(`test${tgId}`, created.secret, expires, tgId, referrerId);
            refPending.delete(tgId);
            db.prepare('DELETE FROM referral_pending WHERE telegram_id = ?').run(tgId);
            const client = db.prepare('SELECT * FROM clients WHERE username = ?').get(`test${tgId}`);
            let text = `🎁 <b>Тестовый доступ на 3 часа активирован!</b>\n\n⏰ Действует до: <b>${fmtMSK(expires)}</b>\n\n` +
                `Подключайся кнопками ниже — Telegram сам предложит добавить прокси.\n\n` +
                `❤️ Понравилось? Продлите в личном кабинете!`;
            let testKb = null;
            try { testKb = connectKeyboard(client); } catch { testKb = null; }
            await ctx.reply(text, { parse_mode: 'HTML', disable_web_page_preview: true, reply_markup: testKb || undefined });
            require('./notifier').notifyAdmin(getAll(), `🎁 Тест выдан: test${tgId}`).catch(() => {});
        } catch (e) {
            logger.error('Ошибка выдачи теста', { error: e.message, tgId });
            await ctx.reply('⚠️ Не удалось выдать тест. Попробуйте позже.');
        }
    }

    // Смена локации: список доступных (текущая исключена) → подтверждение
    bot.callbackQuery(/^nodeloc:(\d+)$/, async (ctx) => {
        const client = db.prepare('SELECT * FROM clients WHERE id = ? AND telegram_id = ?')
            .get(Number(ctx.match[1]), ctx.from.id);
        if (!client) return ctx.answerCallbackQuery({ text: 'Прокси не найден', show_alert: true });
        await ctx.answerCallbackQuery();
        const locations = await nodesService.availableLocations();
        const kb = new InlineKeyboard();
        let options = 0;
        for (const loc of locations) {
            if ((loc.id ?? null) === (client.node_id || null)) continue;
            kb.text(`${loc.emoji} ${loc.name}`, `nodelocgo:${client.id}:${loc.id ?? 0}`).row();
            options += 1;
        }
        if (options === 0) {
            return showScreen(ctx, {
                text: '🌍 <b>Смена локации</b>\n\nСейчас доступна только текущая — других серверов не подключено или они недоступны.',
                kb: new InlineKeyboard().text('⬅️ Назад', `sel:${client.id}`),
            });
        }
        kb.text('⬅️ Назад', `sel:${client.id}`);
        await showScreen(ctx, {
            text: '🌍 <b>Смена локации</b>\n\n' +
                'Прокси переедет на новый сервер: <b>ссылки изменятся</b> — придётся подключить заново. Срок, трафик и секрет сохранятся.\n\nВыберите новую локацию:',
            kb,
        });
    });

    bot.callbackQuery(/^nodelocgo:(\d+):(\d+)$/, async (ctx) => {
        const client = db.prepare('SELECT * FROM clients WHERE id = ? AND telegram_id = ?')
            .get(Number(ctx.match[1]), ctx.from.id);
        if (!client) return ctx.answerCallbackQuery({ text: 'Прокси не найден', show_alert: true });
        const targetNodeId = Number(ctx.match[2]) || null;
        if ((client.node_id || null) === targetNodeId) {
            return ctx.answerCallbackQuery('Это уже текущая локация');
        }
        if (targetNodeId && !nodesService.getNode(targetNodeId)) {
            return ctx.answerCallbackQuery({ text: 'Локация недоступна', show_alert: true });
        }
        await ctx.answerCallbackQuery('Переезжаю…');
        try {
            const updated = await nodesService.moveClient(client, targetNodeId);
            const links = clientLinks(updated);
            const locName = targetNodeId
                ? (() => { const nd = nodesService.getNode(targetNodeId); return nd ? `${nd.emoji || '🌍'} ${nd.name}` : '🌍'; })()
                : '🏠 Основная';
            logger.info('Клиент сменил локацию через бот', { username: client.username, to: targetNodeId });
            let text =
                `✅ <b>Локация изменена: ${locName}</b>\n\n` +
                `📦 ${proxyTitle(updated.username)}\n📅 Действует до: <b>${updated.expires_at ? fmtMSK(updated.expires_at, false) : '∞'}</b>\n\n` +
                `⚠️ <b>Ссылки изменились</b> — подключите прокси заново кнопками ниже:`;
            await ctx.reply(text, {
                parse_mode: 'HTML', disable_web_page_preview: true,
                reply_markup: connectKeyboard(updated),
            });
        } catch (e) {
            logger.error('Смена локации не удалась', { username: client.username, error: e.message });
            await ctx.reply(`⚠️ Не удалось сменить локацию: ${e.message}\nПопробуйте позже — текущий прокси работает без изменений.`, { parse_mode: 'HTML' });
        }
    });

    // Кнопка «Тест 3 часа» из пустого кабинета и из reply-клавиатуры
    bot.hears('🎁 Тест 3 часа', (ctx) => issueTestAccess(ctx));
    bot.callbackQuery('test3', async (ctx) => {
        await ctx.answerCallbackQuery();
        await issueTestAccess(ctx);
    });

    // Код входа в мини-апп: для клиентов, где initData не доходит.
    // Пользователь вводит код в приложении — сессия выдаётся без initData.
    bot.command('appcode', async (ctx) => {
        const code = String(require('crypto').randomInt(100000, 1000000));
        const expires = new Date(Date.now() + 10 * 60 * 1000).toISOString();
        db.prepare('DELETE FROM miniapp_login_codes WHERE telegram_id = ?').run(ctx.from.id);
        db.prepare('INSERT INTO miniapp_login_codes (code, telegram_id, expires_at) VALUES (?, ?, ?)')
            .run(code, ctx.from.id, expires);
        await ctx.reply(
            `🔑 <b>Код входа в приложение:</b> <code>${code}</code>\n\n` +
            `Открой «📱 Приложение», нажми «Войти по коду» и введи его.\n` +
            `⏰ Действует 10 минут, код разовый.`,
            { parse_mode: 'HTML' }
        );
    });

    /** Применение промокода: дни — мгновенно, скидка — на следующую покупку. */
    async function applyPromoFlow(ctx, code) {
        const tgId = ctx.from.id;
        const v = promoService.validate(code, tgId);
        if (!v.ok) return ctx.reply(`❌ ${v.error}`, { parse_mode: 'HTML' });
        const a = promoService.checkAudience(v.promo, tgId);
        if (!a.ok) return ctx.reply(`❌ ${a.error}`, { parse_mode: 'HTML' });

        if (v.promo.kind === 'days') {
            const days = v.promo.days;
            const r = await promoService.applyDaysPromo(v.promo, tgId).catch((e) => ({ ok: false, error: e.message }));
            if (!r.ok) return ctx.reply(`❌ ${r.error}`, { parse_mode: 'HTML' });
            if (r.created) {
                const links = clientLinks(db.prepare('SELECT * FROM clients WHERE username = ?').get(r.created));
                let text = `🎁 <b>Промокод активирован!</b>\n\n` +
                    `📦 Новый прокси: <b>${proxyTitle(r.created)}</b>\n📅 Действует до: <b>${fmtMSK(r.until, false)}</b>\n\n` +
                    `Подключайся кнопками ниже:`;
                return ctx.reply(text, {
                    parse_mode: 'HTML', disable_web_page_preview: true,
                    reply_markup: connectKeyboard(db.prepare('SELECT * FROM clients WHERE username = ?').get(r.created)),
                });
            }
            return ctx.reply(
                `🎁 <b>Промокод активирован!</b>\n\n` +
                `♻️ Продлено прокси: <b>${r.extended}</b> на <b>+${days} дн.</b>\n` +
                `📅 Теперь действует до: <b>${fmtMSK(r.until, false)}</b>`,
                { parse_mode: 'HTML' }
            );
        }

        // Скидка — на следующую покупку
        const act = promoService.activatePercent(v.promo, tgId);
        if (!act.ok) return ctx.reply(`❌ ${act.error}`, { parse_mode: 'HTML' });
        const off = act.discount_fixed
            ? `- ${act.discount_fixed} ${currencySign(getBotSettings().currency)}`
            : `- ${act.percent}%`;
        return ctx.reply(
            `🎁 <b>Промокод активирован!</b>\n\n` +
            `Скидка <b>${off}</b> применится к вашей следующей покупке.\n` +
            `Выберите тариф — цена со скидкой будет видна при оплате.`,
            { parse_mode: 'HTML', reply_markup: new InlineKeyboard().text('🚀 К тарифам', 'tariffs') }
        );
    }

    // ── Промокод: ввод в кабинете ──
    bot.callbackQuery('promo', async (ctx) => {
        await ctx.answerCallbackQuery();
        promoInput.set(ctx.from.id, Date.now());
        await ctx.reply(
            '🎁 <b>Введите промокод</b> одним сообщением:\n' +
            '(напишите его следующим сообщением, например: <code>PROMO-AB12C</code>)\n\n' +
            'Отменить: /promocancel',
            { parse_mode: 'HTML' }
        );
    });

    bot.command('promocancel', async (ctx) => {
        if (promoInput.delete(ctx.from.id)) await ctx.reply('❌ Ввод промокода отменён');
    });

    // Текст-сообщение в режиме ввода промокода (до остальных обработчиков текста)
    bot.on('message:text', async (ctx, next) => {
        const askedAt = promoInput.get(ctx.from.id);
        if (!askedAt) return next();
        if (Date.now() - askedAt > 10 * 60 * 1000) { promoInput.delete(ctx.from.id); return next(); }
        promoInput.delete(ctx.from.id);
        const code = String(ctx.message.text || '').trim();
        await applyPromoFlow(ctx, code);
    });

    // QR-код ссылки подключения: купил с ноутбука — навёл камеру телефона
    bot.callbackQuery(/^qr:(\d+)$/, async (ctx) => {
        const client = db.prepare('SELECT * FROM clients WHERE id = ? AND telegram_id = ?')
            .get(Number(ctx.match[1]), ctx.from.id);
        if (!client) return ctx.answerCallbackQuery({ text: 'Прокси не найден', show_alert: true });
        await ctx.answerCallbackQuery();
        const links = clientLinks(client);
        const link = links.mtproto_https || links.web_https;
        if (!link) return ctx.answerCallbackQuery({ text: 'Нет ссылки для QR', show_alert: true });
        try {
            const QRCode = require('qrcode');
            const png = await QRCode.toBuffer(link, { width: 512, margin: 2 });
            await ctx.replyWithPhoto(new InputFile(png), {
                caption: '📷 <b>Наведите камеру телефона на код</b> — Telegram сам предложит подключить прокси.',
                parse_mode: 'HTML',
            });
        } catch (e) {
            logger.warn('QR: не удалось сгенерировать', { error: e.message });
            await ctx.reply('⚠️ Не удалось сделать QR — используйте ссылки из кабинета.', { parse_mode: 'HTML' });
        }
    });

    bot.callbackQuery('my', async (ctx) => {
        const view = await cabinetView(ctx);
        await ctx.answerCallbackQuery();
        await showScreen(ctx, view);
    });

    bot.callbackQuery('support', async (ctx) => {
        await ctx.answerCallbackQuery();
        await ctx.reply(`🛟 <b>Поддержка</b>\n\nПишите: ${SUPPORT_USERNAME}`, { parse_mode: 'HTML' });
    });

    bot.callbackQuery('tariffs', async (ctx) => {
        await ctx.answerCallbackQuery();
        await showScreen(ctx, { text: '👇 <b>Выберите тариф:</b>', kb: tariffsKeyboard() });
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
            const deduct = deductBalanceSpread(ctx.from.id, tariff.price);
            if (!deduct.ok) {
                return ctx.answerCallbackQuery({ text: 'Недостаточно средств на балансе', show_alert: true });
            }
            const base = client.expires_at && new Date(client.expires_at) > new Date()
                ? new Date(client.expires_at) : new Date();
            const newExpiry = new Date(base.getTime() + tariff.days * 86400000).toISOString();
            const patch = { expiration_rfc3339: newExpiry };
            if (tariff.max_ips) patch.max_unique_ips = tariff.max_ips;
            if (tariff.quota_gb) patch.data_quota_bytes = Math.round(tariff.quota_gb * 1024 ** 3);
            await nodesService.getApiForClient(client).patchUser(client.username, patch).catch(() => {});
            const lim = [];
            if (tariff.max_ips) lim.push('max_ips = ?');
            if (tariff.quota_gb) lim.push('quota_bytes = ?');
            const limParams = [];
            if (tariff.max_ips) limParams.push(tariff.max_ips);
            if (tariff.quota_gb) limParams.push(Math.round(tariff.quota_gb * 1024 ** 3));
            db.prepare(`UPDATE clients SET expires_at = ?, status = 'active'${lim.length ? ', ' + lim.join(', ') : ''} WHERE id = ?`).run(newExpiry, ...limParams, client.id);
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
        const hasOnline = !!(settings.cryptobot_token
            || (settings.yookassa_shop_id && settings.yookassa_secret_key)
            || starsPrice(tariff, settings));
        if (!hasOnline) {
            await sendManualInstructions(ctx, result.lastInsertRowid, `${tariff.price} ${currencySign(tariff.currency)}`);
            return;
        }

        const kb = new InlineKeyboard();
        if (settings.cryptobot_token) kb.text('🪙 Оплатить через CryptoBot', `cbpay:${result.lastInsertRowid}:${tariff.id}:cryptobot`).row();
        styleButtons(kb, [['CryptoBot', 'success'], ['Карта админа', 'success']]);
        if (settings.yookassa_shop_id && settings.yookassa_secret_key) kb.text('💳 Оплатить через ЮKassa', `cbpay:${result.lastInsertRowid}:${tariff.id}:yookassa`).row();
        const stars = starsPrice(tariff, settings);
        if (stars) kb.text(`⭐ Оплатить звёздами (${stars} ⭐)`, `starspay:${result.lastInsertRowid}`).row();
        kb.text('🏦 Карта админа (СБП)', `manualpay:${result.lastInsertRowid}`);

        const lacks = Math.max(0, tariff.price - balance).toFixed(2);
        const cSign = currencySign(tariff.currency);
        kb.row();
        kb.text('💳 Пополнить баланс', 'topup');
        styleButtons(kb, [['Пополнить баланс', 'primary']]);
        await ctx.reply(
            `🧾 <b>Счёт #${result.lastInsertRowid}</b>\n` +
            `💰 На балансе: <b>${balance.toFixed(2)} ${cSign}</b> — не хватает <b>${lacks} ${cSign}</b>\n\n` +
            `💳 <b>Оплатите счёт — продление пройдёт автоматически</b> (или пополните баланс):`,
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

    // Чеки, дождавшиеся удаления во время простоя, удаляются сейчас
    restoreReceiptDeletions();

    bot.start({ drop_pending_updates: true }).catch((err) => {
        logger.error('TG-бот упал', { error: err.message });
    });

    // Возвращаем кнопку меню бота (☰ с командами): setChatMenuButton(web_app)
    // из v1.30.x подменил её на «Приложение» и выглядело как «пропало меню».
    // Мини-апп доступен inline-кнопками в тарифах и кабинете (reply-клавиатура
    // не передаёт initData — документированное поведение Telegram).
    try {
        await bot.api.setChatMenuButton({ menu_button: { type: 'commands' } })
            .catch((e) => logger.warn('Меню бота: не удалось вернуть ☰', { error: e.message }));
    } catch { /* не критично */ }

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

/** Telegram Bot API для фоновых задач планировщика (null — бот выключен). */
const getApi = () => (bot ? bot.api : null);

module.exports = { start, stop, isRunning, getApi, tariffsKeyboard, getBotSettings, issueAccessFor, notifyDeposit, sendMessageTo, broadcastNewLinks, sendFileTo, totalBalance };
