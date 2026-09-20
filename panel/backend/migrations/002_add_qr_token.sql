-- Миграция 002: токен для публичных QR-страниц
-- Публичная ссылка /qr/<token> вместо /qr/<id> — защита от перебора.
ALTER TABLE clients ADD COLUMN qr_token TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_clients_qr_token ON clients(qr_token);
