-- Миграция 028: массовые рассылки из панели
-- Текст поддерживает HTML (как сообщения бота); картинка опциональна.
-- scheduled_at — UTC ISO; NULL = отправить сразу.
CREATE TABLE IF NOT EXISTS broadcasts (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    text          TEXT NOT NULL,
    image_path    TEXT,                   -- файл на диске панели (broadcast/<id>.<ext>)
    image_file_id TEXT,                   -- file_id в Telegram (кэш после первой отправки)
    target        TEXT NOT NULL DEFAULT 'all',  -- all | active | expired | noproxy
    scheduled_at  TEXT,                   -- когда отправлять (UTC); NULL = сразу
    status        TEXT NOT NULL DEFAULT 'pending',  -- pending | sending | sent | failed | cancelled
    total_count   INTEGER NOT NULL DEFAULT 0,
    sent_count    INTEGER NOT NULL DEFAULT 0,
    fail_count    INTEGER NOT NULL DEFAULT 0,
    created_at    TEXT NOT NULL DEFAULT (datetime('now')),
    sent_at       TEXT
);
CREATE INDEX IF NOT EXISTS idx_broadcasts_status ON broadcasts(status, scheduled_at);
