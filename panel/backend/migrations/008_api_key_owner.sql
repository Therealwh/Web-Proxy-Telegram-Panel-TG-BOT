-- 008: Owner для API-ключей и клиентов (C4 / IDOR публичного API).
-- Ключи с owner IS NULL (все существующие) видят всех клиентов —
-- обратная совместимость. Ключи с owner видят только своих клиентов.
ALTER TABLE api_keys ADD COLUMN owner TEXT;
ALTER TABLE clients ADD COLUMN owner TEXT;
CREATE INDEX IF NOT EXISTS idx_clients_owner ON clients(owner);
