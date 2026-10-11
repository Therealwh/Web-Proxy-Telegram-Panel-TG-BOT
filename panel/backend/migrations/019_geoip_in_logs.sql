-- GeoIP в логах подключений: страна, город и автономная система (ASN).
--
-- Раньше страна вычислялась на лету при чтении ответа, поэтому в самой таблице
-- её не было: нельзя было ни отфильтровать логи по стране, ни посчитать
-- аналитику, ни отдать её в экспорт. Пишем один раз при сборе логов —
-- это дёшево и делает данные пригодными для группировки.

ALTER TABLE connection_logs ADD COLUMN country TEXT;
ALTER TABLE connection_logs ADD COLUMN country_code TEXT;
ALTER TABLE connection_logs ADD COLUMN city TEXT;
ALTER TABLE connection_logs ADD COLUMN asn INTEGER;
ALTER TABLE connection_logs ADD COLUMN asn_org TEXT;

-- Индексы для группировки в логах и аналитике.
CREATE INDEX IF NOT EXISTS idx_conn_country ON connection_logs(country);
CREATE INDEX IF NOT EXISTS idx_conn_asn ON connection_logs(asn);