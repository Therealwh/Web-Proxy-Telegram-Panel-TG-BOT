-- Миграция 034: живая карточка заказа — где бот может обновить статус
-- (одно сообщение проходит состояния: ждём оплату → ждём чек → чек получен
-- → подтверждено/отклонено). chat/message id привязаны к сообщению бота.

ALTER TABLE payments ADD COLUMN status_chat_id INTEGER;
ALTER TABLE payments ADD COLUMN status_message_id INTEGER;
