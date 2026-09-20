-- Миграция 006: персистентные реферальные переходы
-- (переживают перезапуск панели, в отличие от памяти)
CREATE TABLE IF NOT EXISTS referral_pending (
    telegram_id INTEGER PRIMARY KEY,
    referrer_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
