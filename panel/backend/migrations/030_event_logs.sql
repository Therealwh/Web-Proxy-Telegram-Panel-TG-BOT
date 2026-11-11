-- Миграция 030: понятные события панели (покупки/продления/пополнения/ошибки)
-- Хранятся сутки и чистятся автоматически — память не забивается.

CREATE TABLE IF NOT EXISTS event_logs (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    event        TEXT NOT NULL,             -- purchase | renewal | deposit | error | cleanup
    title        TEXT NOT NULL,             -- понятный заголовок
    details      TEXT,                      -- человекочитаемые детали
    level        TEXT NOT NULL DEFAULT 'info',  -- info | error
    telegram_id  INTEGER,                   -- чьё событие (если применимо)
    created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_event_logs_created ON event_logs(created_at);
