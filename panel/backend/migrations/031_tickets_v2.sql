-- Миграция 031: тикеты поддержки v2 (бот ↔ панель, двусторонний диалог)
-- status: open (ждёт админа) | answered (админ ответил, ждём клиента) | closed

ALTER TABLE tickets ADD COLUMN updated_at TEXT;
-- превью последнего сообщения
ALTER TABLE tickets ADD COLUMN last_message TEXT;
-- client | admin
ALTER TABLE tickets ADD COLUMN last_sender TEXT NOT NULL DEFAULT 'client';

-- Существующие тикеты считаем обновлёнными в момент создания
UPDATE tickets SET updated_at = created_at, last_message = COALESCE(
    (SELECT text FROM ticket_messages WHERE ticket_id = tickets.id ORDER BY id DESC LIMIT 1),
    subject), last_sender = 'client';

CREATE INDEX IF NOT EXISTS idx_tickets_updated ON tickets(updated_at DESC);
