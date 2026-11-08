-- Миграция 026: мульти-сервер — узлы (локации)
-- Панель остаётся одним «мозгом», узлы — Telemt-движки на других серверах,
-- которыми панель управляет удалённо по Control API с токеном.
-- node_id NULL у клиента = локальный движок главной панели (как раньше).

CREATE TABLE IF NOT EXISTS nodes (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    name         TEXT NOT NULL,              -- отображаемое имя («Германия»)
    emoji        TEXT,                       -- флаг/иконка для бота (🇩🇪)
    domain       TEXT NOT NULL,              -- прокси-домен узла (в клиентских ссылках)
    mask_domain  TEXT,                       -- домен маскировки Fake TLS узла
    control_url  TEXT NOT NULL,              -- адрес Control API (http://ip:9091)
    api_token    TEXT NOT NULL,              -- Bearer токен Control API узла
    mtproto_port INTEGER,                    -- NULL = порт как на главной панели
    max_clients  INTEGER,                    -- NULL = без лимита
    enabled      INTEGER NOT NULL DEFAULT 1,
    last_health  TEXT,                       -- JSON {ok, latency_ms, checked_at, error}
    created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Локация клиента (NULL = локальный движок главной панели)
ALTER TABLE clients ADD COLUMN node_id INTEGER REFERENCES nodes(id);
-- Локация, выбранная при покупке (до создания клиента)
ALTER TABLE payments ADD COLUMN node_id INTEGER;

CREATE INDEX IF NOT EXISTS idx_clients_node ON clients(node_id);
