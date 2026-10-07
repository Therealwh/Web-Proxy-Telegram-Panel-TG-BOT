-- 016: TLS-отпечатки клиентов (накопление поверх рестартов движка)
CREATE TABLE IF NOT EXISTS tls_fingerprints (
    fp TEXT PRIMARY KEY, -- ja4 preferred, fallback ja3
    ja3 TEXT,
    ja4 TEXT,
    total INTEGER NOT NULL DEFAULT 0,
    auth_success INTEGER NOT NULL DEFAULT 0,
    bad_or_probe INTEGER NOT NULL DEFAULT 0,
    first_seen TEXT,
    last_seen TEXT,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
