-- Миграция 033: чеки ручных платежей (фото/PDF) и отметка «Я оплатил»
-- Чек хранится file_id в Telegram — содержимое не дублируется на диске.

-- Тип вложения чека: photo | document
ALTER TABLE payments ADD COLUMN receipt_media_type TEXT;
-- file_id чека в Telegram (для пересылки админу и превью в панели)
ALTER TABLE payments ADD COLUMN receipt_file_id TEXT;
-- Имя файла (для PDF-документов)
ALTER TABLE payments ADD COLUMN receipt_file_name TEXT;
-- Когда клиент прислал чек
ALTER TABLE payments ADD COLUMN receipt_sent_at TEXT;
-- Когда клиент нажал «✅ Я оплатил» (старт 24-часового срока на чек)
ALTER TABLE payments ADD COLUMN paid_marked_at TEXT;
