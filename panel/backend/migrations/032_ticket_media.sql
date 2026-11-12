-- Миграция 032: медиа в тикетах (фото и PDF от клиента)
ALTER TABLE ticket_messages ADD COLUMN media_type TEXT;  -- photo | document
ALTER TABLE ticket_messages ADD COLUMN file_id TEXT;     -- file_id в Telegram
ALTER TABLE ticket_messages ADD COLUMN file_name TEXT;   -- имя файла (для документов)
