-- Миграция 027: одноразовые токены автоустановки узлов
-- Панель генерирует токен и команду установки; скрипт на новом сервере
-- скачивается по этому токену, ставит Telemt и регистрирует узел обратно.
CREATE TABLE IF NOT EXISTS node_installs (
    token        TEXT PRIMARY KEY,             -- одноразовый токен установки
    name         TEXT NOT NULL,
    emoji        TEXT,
    domain       TEXT NOT NULL,
    mask_domain  TEXT,
    mtproto_port INTEGER,
    max_clients  INTEGER,
    panel_domain TEXT NOT NULL,                -- домен панели (узел стучится сюда)
    created_at   TEXT NOT NULL DEFAULT (datetime('now')),
    expires_at   TEXT NOT NULL,                -- TTL 30 минут
    used_at      TEXT
);
