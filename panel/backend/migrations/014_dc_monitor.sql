-- 014: DC-монитор — история проверок дата-центров и события (падения/рестарты)
CREATE TABLE IF NOT EXISTS dc_checks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    dc INTEGER NOT NULL,
    coverage_pct REAL,
    rtt_ms REAL,
    alive_writers INTEGER,
    required_writers INTEGER,
    degraded INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_dc_checks_created ON dc_checks(created_at);

CREATE TABLE IF NOT EXISTS dc_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    type TEXT NOT NULL, -- 'down' | 'recovered' | 'restart'
    details TEXT
);
