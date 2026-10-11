-- 018: статус последней доставки вебхука
-- Чтобы по списку подписок было видно, доехало последнее событие или нет,
-- и какая была ошибка — раньше это выяснялось только по логам на сервере.
ALTER TABLE webhooks ADD COLUMN last_status INTEGER;
ALTER TABLE webhooks ADD COLUMN last_error TEXT;
ALTER TABLE webhooks ADD COLUMN last_ok_at TEXT;