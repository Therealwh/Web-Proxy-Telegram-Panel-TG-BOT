-- Блокировка IP и подсетей администратором.
--
-- В Telemt глобального списка запрещённых адресов нет (есть только
-- access.user_source_deny — запрет источника для конкретного пользователя,
-- причём применяется он уже после аутентификации). Поэтому запрет
-- реализуется на уровне Nginx (веб-прокси) и nftables (порт MTProto),
-- и таблица здесь — источник правды для этих правил.

CREATE TABLE IF NOT EXISTS ip_blocklist (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    cidr TEXT NOT NULL UNIQUE,
    reason TEXT DEFAULT '',
    enabled INTEGER NOT NULL DEFAULT 1,
    hits INTEGER NOT NULL DEFAULT 0,
    last_hit_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_blocklist_enabled ON ip_blocklist(enabled);