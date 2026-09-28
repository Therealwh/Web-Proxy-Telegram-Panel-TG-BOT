-- Миграция 011: автопродление с баланса (переключатель клиента в боте)
ALTER TABLE clients ADD COLUMN auto_renew INTEGER NOT NULL DEFAULT 0;
