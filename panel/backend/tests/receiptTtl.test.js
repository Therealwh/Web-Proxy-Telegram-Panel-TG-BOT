/**
 * Тесты чеков: пересылка админу, автоудаление через сутки,
 * восстановление очереди после рестарта.
 *
 * Регрессия: handleReceipt существовала, но бот не был подписан на
 * message:photo/document — чеки молча игнорировались.
 */
const fs = require('fs');
const path = require('path');
const { test, describe } = require('node:test');
const assert = require('node:assert');

const BOT = path.join(__dirname, '..', 'services', 'bot.js');
const src = fs.readFileSync(BOT, 'utf8');

describe('чеки: подписка и автоудаление', () => {
    test('бот подписан на фото и документы', () => {
        assert.match(src, /bot\.on\(\['message:photo',\s*'message:document'\]/,
            'нет подписки на message:photo/document — чеки молча игнорируются');
    });

    test('handleReceipt вызывается из подписки', () => {
        const calls = (src.match(/handleReceipt\(/g) || []).length;
        assert.ok(calls >= 2, `handleReceipt объявлена, но не вызывается (вхождений: ${calls})`);
    });

    test('пересланный чек ставится в очередь на удаление', () => {
        assert.match(src, /scheduleReceiptDelete\(sent\.chat\.id,\s*sent\.message_id/,
            'ID отправленного сообщения не сохраняется для удаления');
    });

    test('TTL чека — 24 часа', () => {
        assert.match(src, /RECEIPT_TTL\s*=\s*24\s*\*\s*3600/, 'TTL не равен суткам');
    });

    test('очередь удаления переживает рестарт панели', () => {
        assert.match(src, /persistReceiptDeletions/, 'нет сохранения очереди');
        assert.match(src, /restoreReceiptDeletions\(\)/, 'нет восстановления очереди');
        assert.match(src, /bot_receipt_deletions/, 'нет ключа settings для очереди');
    });

    test('восстановление вызывается при старте бота до polling', () => {
        const iRestore = src.indexOf('restoreReceiptDeletions();');
        const iStart = src.indexOf('bot.start(');
        assert.ok(iRestore !== -1 && iStart !== -1, 'не найдены вызовы');
        assert.ok(iRestore < iStart, 'восстановление должно идти до bot.start');
    });

    test('удаление через bot.api.deleteMessage', () => {
        assert.match(src, /bot\.api\.deleteMessage\(chatId,\s*messageId\)/);
    });
});