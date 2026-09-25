-- 007: Очередь синхронизации Telemt (C5/M7): при сбое patchUser при
-- продлении/выдаче платёж не теряется — ретраи из scheduler.
CREATE TABLE IF NOT EXISTS telemt_sync_queue (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    client_id INTEGER NOT NULL,
    patch_json TEXT NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    last_error TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_telemt_sync_client ON telemt_sync_queue(client_id);
