-- 015: внешняя доступность — история замеров Globalping
CREATE TABLE IF NOT EXISTS availability_checks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    target TEXT NOT NULL,
    port INTEGER NOT NULL,
    probes_ok INTEGER NOT NULL,
    probes_total INTEGER NOT NULL,
    pct INTEGER,
    measurement_id TEXT
);
CREATE INDEX IF NOT EXISTS idx_avail_created ON availability_checks(created_at);
