-- Миграция 024: реферальная программа v2
-- 1) Персональный код-инвайт у каждого клиента (ссылка вида ?start=ref_<код>;
--    старые ссылки ref_<telegram_id> продолжают работать).
--    ВНИМАНИЕ: SQLite не умеет ADD COLUMN ... UNIQUE — уникальность через индекс
--    (несколько NULL индекс спокойно пропускает — код выдаётся лениво).
ALTER TABLE clients ADD COLUMN referral_code TEXT;
CREATE UNIQUE INDEX idx_clients_referral_code ON clients(referral_code);

-- 2) Журнал реферальных начислений (% с платежей приглашённых на баланс реферера)
CREATE TABLE referral_earnings (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    referrer_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    referred_id INTEGER REFERENCES clients(id) ON DELETE SET NULL,
    amount      REAL NOT NULL,
    kind        TEXT NOT NULL DEFAULT 'purchase',   -- purchase | renewal | deposit
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_refearn_referrer ON referral_earnings(referrer_id);
