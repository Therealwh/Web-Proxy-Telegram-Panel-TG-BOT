-- =============================================================================
-- Миграция 001: Первичная схема базы данных TGGATE
-- Все таблицы панели: админы, клиенты, логи, настройки, API-ключи,
-- вебхуки, платежи, тарифы, промокоды, тикеты, обновления, QR-статистика.
-- =============================================================================

-- Администраторы панели
CREATE TABLE admins (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    login         TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    totp_secret   TEXT,                          -- секрет 2FA (NULL = выключено)
    created_at    TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at    TEXT
);

-- Refresh-токены сессий администраторов (для отзыва)
CREATE TABLE refresh_tokens (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    admin_id   INTEGER NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL,                    -- sha256 токена (сам токен не храним)
    expires_at TEXT NOT NULL,
    revoked    INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Клиенты прокси (синхронизируются с Telemt через Control API)
CREATE TABLE clients (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    username        TEXT UNIQUE NOT NULL,        -- логин в Telemt (латиница)
    secret          TEXT NOT NULL,               -- текущий секрет (32 hex)
    quota_bytes     INTEGER,                     -- квота трафика; NULL = безлимит
    traffic_used    INTEGER NOT NULL DEFAULT 0,  -- израсходовано (кэш из Telemt)
    expires_at      TEXT,                        -- дата истечения ISO8601
    max_ips         INTEGER,                     -- макс. уникальных IP
    rate_down_bps   INTEGER,                     -- лимит скачивания (бит/с)
    rate_up_bps     INTEGER,                     -- лимит загрузки (бит/с)
    ad_tag          TEXT,                        -- ad tag спонсорских каналов
    web_enabled     INTEGER NOT NULL DEFAULT 1,  -- Web Proxy разрешён
    mtproto_enabled INTEGER NOT NULL DEFAULT 1,  -- MTProto разрешён
    status          TEXT NOT NULL DEFAULT 'active', -- active | blocked | expired
    telegram_id     INTEGER,                     -- TG клиента (для бота)
    referrer_id     INTEGER REFERENCES clients(id), -- кто пригласил (рефералка)
    note            TEXT,
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT
);

-- Журнал подключений (живые логи)
CREATE TABLE connection_logs (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    username   TEXT,
    ip         TEXT,
    protocol   TEXT,                             -- web | mtproto
    status     TEXT NOT NULL DEFAULT 'ok',       -- ok | blocked | suspicious
    user_agent TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_logs_created ON connection_logs(created_at);
CREATE INDEX idx_logs_username ON connection_logs(username);
CREATE INDEX idx_logs_ip ON connection_logs(ip);

-- Суточный трафик по клиентам (для графиков)
CREATE TABLE traffic_daily (
    date     TEXT NOT NULL,                      -- YYYY-MM-DD
    username TEXT NOT NULL,
    bytes    INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (date, username)
);

-- Настройки панели (key-value, JSON в value)
CREATE TABLE settings (
    key   TEXT PRIMARY KEY,
    value TEXT
);

-- Журнал аудита действий администратора
CREATE TABLE audit_log (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    admin      TEXT,
    action     TEXT NOT NULL,
    details    TEXT,
    ip         TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- API-ключи публичного API (для разработчиков)
CREATE TABLE api_keys (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    name           TEXT NOT NULL,
    key_hash       TEXT UNIQUE NOT NULL,         -- sha256 ключа
    key_prefix     TEXT NOT NULL,                -- первые 8 символов для показа
    permissions    TEXT NOT NULL DEFAULT 'read', -- read | write | full
    expires_at     TEXT,                         -- NULL = бессрочный
    allowed_ips    TEXT,                         -- JSON-массив CIDR; NULL = любые
    requests_count INTEGER NOT NULL DEFAULT 0,
    last_used_at   TEXT,
    enabled        INTEGER NOT NULL DEFAULT 1,
    created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Вебхуки для внешних сервисов
CREATE TABLE webhooks (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    event      TEXT NOT NULL,                    -- client.created и т.д.
    url        TEXT NOT NULL,
    secret     TEXT NOT NULL,                    -- для HMAC-подписи
    enabled    INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Тарифы для Telegram-бота продаж
CREATE TABLE tariffs (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    name      TEXT NOT NULL,
    days      INTEGER NOT NULL,                  -- длительность доступа
    price     REAL NOT NULL,
    currency  TEXT NOT NULL DEFAULT 'RUB',
    protocols TEXT NOT NULL DEFAULT 'both',      -- web | mtproto | both
    enabled   INTEGER NOT NULL DEFAULT 1
);

-- Платежи
CREATE TABLE payments (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    client_id   INTEGER REFERENCES clients(id),
    tariff_id   INTEGER REFERENCES tariffs(id),
    amount      REAL NOT NULL,
    currency    TEXT NOT NULL DEFAULT 'RUB',
    provider    TEXT,                            -- yookassa | cryptobot | ...
    status      TEXT NOT NULL DEFAULT 'pending', -- pending | success | failed
    promo_code  TEXT,
    external_id TEXT,                            -- id платежа в системе провайдера
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    paid_at     TEXT
);

-- Промокоды
CREATE TABLE promo_codes (
    code                TEXT PRIMARY KEY,
    discount_percent    REAL,                    -- скидка в %
    discount_fixed      REAL,                    -- или фиксированная
    first_payment_only  INTEGER NOT NULL DEFAULT 0,
    max_uses            INTEGER,                 -- NULL = без лимита
    used_count          INTEGER NOT NULL DEFAULT 0,
    expires_at          TEXT,
    enabled             INTEGER NOT NULL DEFAULT 1
);

-- Тикеты поддержки (через TG-бота)
CREATE TABLE tickets (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    client_id   INTEGER REFERENCES clients(id),
    telegram_id INTEGER,
    subject     TEXT,
    status      TEXT NOT NULL DEFAULT 'open',    -- open | closed
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    closed_at   TEXT
);

CREATE TABLE ticket_messages (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    ticket_id  INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
    sender     TEXT NOT NULL,                    -- client | admin
    text       TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- История обновлений панели и Telemt
CREATE TABLE updates_log (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    component    TEXT NOT NULL,                  -- panel | telemt
    from_version TEXT,
    to_version   TEXT,
    status       TEXT NOT NULL,                  -- success | failed | rolled_back
    log          TEXT,
    created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Статистика сканирований QR-кодов
CREATE TABLE qr_scans (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    client_id  INTEGER REFERENCES clients(id),
    qr_type    TEXT,                             -- web | mtproto | combined
    ip         TEXT,
    user_agent TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Результат проверки доступности прокси (для страницы /status)
CREATE TABLE uptime_checks (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    service    TEXT NOT NULL,                    -- web | mtproto
    ok         INTEGER NOT NULL,
    latency_ms INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_uptime_created ON uptime_checks(created_at);
