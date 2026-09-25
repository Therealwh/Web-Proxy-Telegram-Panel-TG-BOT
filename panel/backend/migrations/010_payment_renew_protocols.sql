-- Миграция 010: выбранный набор протоколов при продлении из бота
-- ('web' | 'mtproto' | 'both', NULL — протоколы не менялись)
ALTER TABLE payments ADD COLUMN renew_protocols TEXT;
