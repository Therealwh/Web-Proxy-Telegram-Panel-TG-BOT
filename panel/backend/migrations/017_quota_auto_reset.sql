-- 017: флаг автосброса квоты на клиенте (1 = участвует в плановом сбросе)
ALTER TABLE clients ADD COLUMN quota_auto_reset INTEGER NOT NULL DEFAULT 1;
