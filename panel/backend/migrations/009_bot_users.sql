-- Миграция 009: все пользователи бота (включая тех, кто ещё не покупал прокси)
CREATE TABLE IF NOT EXISTS bot_users (
    telegram_id INTEGER PRIMARY KEY,
    username    TEXT,
    first_name  TEXT,
    last_name   TEXT,
    seen_at     TEXT NOT NULL DEFAULT (datetime('now')),
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
