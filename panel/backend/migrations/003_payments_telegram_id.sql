-- Миграция 003: telegram_id в платежах — чтобы знать, кому выдать доступ
ALTER TABLE payments ADD COLUMN telegram_id INTEGER;
