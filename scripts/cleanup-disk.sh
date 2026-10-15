#!/usr/bin/env bash
#
# =============================================================================
# TGGATE — очистка диска
#
# Что чистит:
#   1. systemd journal — до 200 МБ
#   2. Логи подключений в БД старше 14 дней, проверки старше 30 дней
#   3. WAL-чекпоинт + VACUUM — сжимает файл БД
#   4. Бэкапы панели — оставляет 5 свежих
#   5. Кеш apt
#
# Запуск: ТОЛЬКО через root-хелпер (scripts/helper.js, ключ cleanup).
# Безопасно: таблицы клиентов, платежей и тарифов не трогаются.
# =============================================================================
set -euo pipefail

DB="/var/lib/tggate/tggate.db"
BACKUPS_DIR="/var/backups/tggate"
KEEP_BACKUPS=5

echo "== Диск до =="
df -h / | tail -1

# 1. Журнал systemd
echo "== journal =="
journalctl --vacuum-size=200M 2>&1 | tail -1 || true

# 2-3. БД: логи и вакуум
if command -v sqlite3 >/dev/null && [[ -f "$DB" ]]; then
    echo "== логи подключений старше 14 дней =="
    sqlite3 "$DB" "DELETE FROM connection_logs WHERE created_at < datetime('now','-14 days'); SELECT changes()"

    echo "== проверки старше 30 дней =="
    sqlite3 "$DB" "DELETE FROM dc_checks WHERE created_at < datetime('now','-30 days'); SELECT changes()"
    sqlite3 "$DB" "DELETE FROM uptime_checks WHERE created_at < datetime('now','-30 days'); SELECT changes()"

    echo "== VACUUM (может занять до минуты) =="
    sqlite3 "$DB" "PRAGMA wal_checkpoint(TRUNCATE); VACUUM;" && echo "ok"
else
    echo "== sqlite3 или БД недоступны, пропускаю чистку БД =="
fi

# 4. Бэкапы панели: оставляем KEEP_BACKUPS свежих
if [[ -d "$BACKUPS_DIR" ]]; then
    echo "== бэкапы: было $(du -sh "$BACKUPS_DIR" 2>/dev/null | cut -f1) =="
    cd "$BACKUPS_DIR"
    ls -t | tail -n +$((KEEP_BACKUPS + 1)) | xargs -r rm -rf
    echo "== бэкапов осталось: $(ls -1 | wc -l), стало $(du -sh "$BACKUPS_DIR" | cut -f1) =="
fi

# 5. Кеш apt
apt-get clean >/dev/null 2>&1 || true

echo "== Диск после =="
df -h / | tail -1