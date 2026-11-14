/**
 * Тесты флоу чеков v1.41:
 *  - «Я оплатил» без чека НЕ уведомляет админа (уведомление только с чеком);
 *  - чек сохраняется на платеже (file_id) и уходит админу через notifier;
 *  - автоотмена платежей без чека через 24 ч (планировщик, раз в час);
 *  - решения по платежам из админ-меню бота («💳 Оплаты»).
 *
 * Регрессия: раньше админ получал уведомление сразу после «Я оплатил»,
 * без чека — приходилось гадать, была ли оплата.
 *
 * ВАЖНО: это smoke-тесты на исходник (регэкспы по коду), не поведенческие.
 * Они ловят удаление/переименование ключевых кусков, но не все регрессии
 * логики — например, отсутствие колонки status в SELECT (P0 ревью v1.41)
 * здесь проверяется отдельным тестом ниже именно потому, что легко могло
 * пройти мимо.
 */
const fs = require('fs');
const path = require('path');
const { test, describe } = require('node:test');
const assert = require('node:assert');

const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
const BOT = read('services/bot.js');
const SCHED = read('services/scheduler.js');
const PAYMENTS = read('routes/payments.js');
const NOTIFIER = read('services/notifier.js');

/** Кусок исходника от маркера до ближайшего следующего (не включая его). */
function block(src, startMarker, endMarker) {
    const i = src.indexOf(startMarker);
    assert.ok(i !== -1, `маркер не найден: ${startMarker}`);
    const j = src.indexOf(endMarker, i + startMarker.length);
    return j === -1 ? src.slice(i) : src.slice(i, j);
}

describe('«Я оплатил» без чека — админ не уведомляется', () => {
    test('paid-хендлер отмечает paid_marked_at только у pending', () => {
        const b = block(BOT, 'callbackQuery(/^paid:(\\d+)$/', 'async function issueTestAccess');
        assert.match(b, /paid_marked_at = datetime\('now'\)/, 'старт 24-часового срока не фиксируется');
        assert.match(b, /AND status = 'pending'/, 'отметка должна ставиться только pending-заказу');
    });

    test('paid-хендлер не отправляет ничего админу', () => {
        const b = block(BOT, 'callbackQuery(/^paid:(\\d+)$/', 'async function issueTestAccess');
        assert.doesNotMatch(b, /notifyAdmin|sendPhoto|sendDocument|\.sendMessage\(/,
            'уведомление админу должно уходить только вместе с чеком');
    });

    test('клиенту объясняется, что без чека оплаты не будет', () => {
        const b = block(BOT, 'callbackQuery(/^paid:(\\d+)$/', 'async function issueTestAccess');
        assert.match(b, /НЕ БУДЕТ/, 'нет предупреждения о подтверждении');
        assert.match(b, /24 часа/, 'нет предупреждения об автоотмене');
    });

    test('админ-уведомление с чеком уходит от бота продаж (file_id)', () => {
        const b = block(BOT, 'async function handleReceipt', '/**\n * Запускает бота.');
        // Регрессия v1.41.0: чек уходил токеном бота УВЕДОМЛЕНИЙ (tg_bot_token),
        // а file_id принадлежит боту продаж — Telegram отвечал
        // «wrong file identifier», админ чек не получал
        assert.match(b, /sendReceiptMedia\(/, 'чек должен уходить через хелпер с токеном бота продаж');
        assert.doesNotMatch(b, /notifyAdminPhoto|notifyAdminDocument/,
            'обёртки notifyAdmin* шлют от бота уведомлений — с чужим file_id они не работают');
        assert.match(b, /UPDATE payments SET receipt_media_type/, 'чек не сохраняется на платеже');
        assert.match(b, /scheduleReceiptDelete\(sent\.chat\.id,\s*sent\.message_id/, 'TTL-удаление чека потерялось');
    });

    test('хелпер sendReceiptMedia шлёт токеном бота продаж', () => {
        const b = block(BOT, 'async function sendReceiptMedia', '/**\n * Приём чека');
        assert.match(b, /getBotSettings\(\)\.bot_token/, 'нужен токен бота продаж, а не уведомлений');
        assert.match(b, /sendPhotoByFileId\(/, 'фото — по file_id');
        assert.match(b, /sendDocumentByFileId\(/, 'PDF — по file_id');
        assert.match(b, /tg_admin_chat_id/, 'нет адресата');
        assert.match(b, /catch \(e\)/, 'ошибки должны глотаться с логом, не роняя обработчик');
    });

    test('«Показать чек» из карточки тоже идёт через бота продаж', () => {
        const b = block(BOT, '/^admin:preceipt:(\\d+)$/', '// Подтвердить оплату');
        assert.match(b, /sendReceiptMedia\(/, 'повторный показ чека должен идти токеном бота продаж');
        assert.doesNotMatch(b, /notifyAdminPhoto|notifyAdminDocument/);
        assert.match(b, /scheduleReceiptDelete\(sent\.chat\.id,\s*sent\.message_id/, 'TTL-удаление копии чека потерялось');
    });

    test('чек без активного заказа не теряется молча после рестарта', () => {
        const b = block(BOT, 'async function handleReceipt', '/**\n * Запускает бота.');
        assert.match(b, /paid_marked_at IS NOT NULL/, 'нет fallback на последний заказ с «Я оплатил»');
    });

    test('notifier умеет отправку по file_id', () => {
        assert.match(NOTIFIER, /function sendPhotoByFileId\(/);
        assert.match(NOTIFIER, /function sendDocumentByFileId\(/);
        // Регрессия v1.41.0: обёртки notifyAdmin* шлы чек токеном бота
        // уведомлений — удалены, чтобы никто не повторил ошибку
        assert.doesNotMatch(NOTIFIER, /function notifyAdminPhoto|function notifyAdminDocument/);
    });
});

describe('автоотмена платежей без чека (24 ч)', () => {
    test('в планировщике есть cancelNoReceiptPayments', () => {
        const b = block(SCHED, 'function cancelNoReceiptPayments', '/** Синхронизация лимитов');
        assert.match(b, /provider = 'manual'/, 'касается только ручных платежей');
        assert.match(b, /receipt_file_id IS NULL/, 'платежи с чеком отменять нельзя');
        assert.match(b, /'-24 hours'/, 'срок должен быть 24 часа');
        assert.match(b, /status = 'cancelled' WHERE id = \? AND status = 'pending'/, 'отмена без атомарного claim — риск задвоения');
        assert.match(b, /Срок оплаты вышел/, 'клиент должен получить уведомление');
    });

    test('запускается ежечасно и при старте', () => {
        const hourly = block(SCHED, 'Ежечасно: напоминания', '}, 60 * 60 * 1000)');
        assert.match(hourly, /cancelNoReceiptPayments\(\)/, 'нет ежечасного запуска');
        const first = block(SCHED, 'Первый прогон через 2 минуты', '}, 2 * 60 * 1000)');
        assert.match(first, /cancelNoReceiptPayments\(\)/, 'нет первого прогона');
    });

    test('отклонение из панели уведомляет клиента', () => {
        const b = block(PAYMENTS, "'/:id/cancel'", '// --- Чек платежа');
        assert.match(b, /sendMessageTo\(/, 'клиент не узнает об отклонении');
        assert.match(b, /отклонён/, 'в уведомлении должно быть «отклонён»');
    });

    test('маршрут чека требует авторизации', () => {
        const b = block(PAYMENTS, "'/:id/receipt'", 'module.exports');
        assert.match(b, /requireAuth/, 'чек доступен без JWT — утечка ПДн');
        assert.match(b, /receipt_file_id/, 'нет выборки чека');
    });
});

describe('решения по платежам из админ-меню бота', () => {
    test('кнопка «💳 Оплаты» со счётчиком pending', () => {
        assert.match(BOT, /💳 Оплаты/, 'нет кнопки в админ-меню');
        assert.match(BOT, /pendingPays/, 'нет счётчика ожидающих');
    });

    test('есть карточка, чек, сообщение клиенту, подтверждение и отмена', () => {
        for (const cb of ['admin:pay:', 'admin:preceipt:', 'admin:pmsg:']) {
            assert.ok(BOT.includes(cb), `нет хендлера ${cb}`);
        }
        const confirm = block(BOT, '/^admin:pconfirm:(\\d+)$/', '/^admin:pcancel:(\\d+)$/');
        assert.match(confirm, /completePayment\(/, 'подтверждение должно идти через completePayment');
        assert.match(confirm, /receipt_file_id/, 'нет ветки подтверждения без чека');
        assert.match(confirm, /PAY_CONFIRM_WARN_TTL_MS/, 'нет двухшагового подтверждения без чека');
        // Регрессия P0: без status в SELECT p.status === undefined и хендлер
        // всегда отвечал «Уже обработан» — подтверждение из бота не работало
        assert.match(confirm, /SELECT id, status, receipt_file_id FROM payments/,
            'в SELECT карточки подтверждения нет status — хендлер мёртв');
        assert.match(confirm, /p\.status !== 'pending'/);
        const cancel = block(BOT, '/^admin:pcancel:(\\d+)$/', '/^admin:pmsg:(\\d+)$/');
        assert.match(cancel, /status = 'cancelled' WHERE id = \? AND status = 'pending'/, 'отмена без claim');
        assert.match(cancel, /отклонён/, 'клиента надо уведомить об отклонении');
    });

    test('после решения — возврат к списку', () => {
        const confirm = block(BOT, '/^admin:pconfirm:(\\d+)$/', '/^admin:pcancel:(\\d+)$/');
        assert.match(confirm, /showPayList\(ctx, true\)/);
        const cancel = block(BOT, '/^admin:pcancel:(\\d+)$/', '/^admin:pmsg:(\\d+)$/');
        assert.match(cancel, /showPayList\(ctx, true\)/);
    });

    test('список платежей: с чеком сверху, срок до автоотмены', () => {
        const b = block(BOT, 'function manualPaymentsList', '/** Как зовут клиента');
        assert.match(b, /ORDER BY \(p\.receipt_file_id IS NULL\)/, 'с чеком должны быть сверху');
        assert.match(b, /provider = 'manual'/, 'в списке только ручные');
        const ttl = block(BOT, 'function payHoursLeft', '/** Экран списка');
        assert.match(ttl, /MANUAL_PAY_TTL_H/, 'таймер не привязан к сроку автоотмены');
    });

    test('сообщение клиенту по платежу уходит только админу и с эскейпом', () => {
        const b = block(BOT, 'Сообщение клиенту по платежу', 'bot.on(\'message:text\', async (ctx, next) => {\n        const tid');
        assert.match(b, /isAdmin\(ctx\)/, 'хендлер без проверки админа');
        assert.match(b, /escapeHtml\(ctx\.message\.text\)/, 'текст админа без эскейпа — HTML-инъекция');
    });
});

describe('промокоды v3 в боте', () => {
    test('выбор прокси для days-промокода', () => {
        assert.match(BOT, /promosel:/, 'нет inline-клавиатуры выбора прокси');
        const b = block(BOT, '/^promosel:([A-Za-z0-9_-]+):(\\d+)$/', '── Тикеты поддержки');
        assert.match(b, /AND telegram_id = \?/, 'нет проверки своего прокси');
        assert.match(b, /applyDaysPromo\(v\.promo, tgId, clientId\)/, 'дни применяются не к выбранному');
        assert.match(b, /продлён на/, 'нет подтверждения по выбранному прокси');
    });

    test('applyPromoFlow спрашивает выбор при нескольких прокси', () => {
        const b = block(BOT, 'async function applyPromoFlow', '── Промокод: ввод в кабинете');
        assert.match(b, /daysPromoTargets\(/, 'нет набора кандидатов');
        assert.match(b, /targets\.length > 1/, 'нет ветки выбора');
        assert.match(b, /targets\[0\]\.id/, 'единственный прокси должен применяться сразу');
    });
});
