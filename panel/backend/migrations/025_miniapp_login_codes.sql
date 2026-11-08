-- Миграция 025: коды входа в мини-апп
-- Для клиентов, где Telegram не передаёт initData: бот выдаёт разовый код
-- командой /appcode, пользователь вводит его в приложении.
CREATE TABLE IF NOT EXISTS miniapp_login_codes (
    code        TEXT PRIMARY KEY,
    telegram_id INTEGER NOT NULL,
    expires_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_mlc_tg ON miniapp_login_codes(telegram_id);
