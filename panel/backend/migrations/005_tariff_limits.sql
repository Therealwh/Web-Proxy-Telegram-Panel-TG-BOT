-- Миграция 005: лимиты в тарифах + привязка платежа к конкретному прокси
ALTER TABLE tariffs ADD COLUMN max_ips INTEGER;   -- одновременные IP (NULL = без лимита)
ALTER TABLE tariffs ADD COLUMN quota_gb REAL;     -- квота трафика, ГБ (NULL = безлимит)
ALTER TABLE payments ADD COLUMN client_id INTEGER; -- продление конкретного прокси
