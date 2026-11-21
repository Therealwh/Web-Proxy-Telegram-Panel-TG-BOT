#!/usr/bin/env bash
#
# =============================================================================
# TGGATE — очистка диска
#
# Что чистит:
#   1. systemd journal — до 200 МБ
#   2. Бэкапы панели — оставляет 5 свежих
#   3. Кеш apt
#
# БД из-под root НЕ трогаем: ретеншены логов делает сама панель
# (logCollector/dcMonitor/scheduler), а любая запись или чекпоинт из
# root-CLI против живого писателя — механизм порчи WAL (14.11/18.11/
# 19.11/21.11).
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

# 2. БД: ничего не трогаем из-под root! Ретеншены делает сама панель
#    (logCollector — connection_logs по настройке, dcMonitor — dc_checks,
#    scheduler — uptime_checks). Раньше здесь были DELETE из root-CLI:
#    каждая кросс-процессная запись CLI (и неявный авто-чекпоинт в конце её
#    транзакции) от sqlite3 < 3.51.3 против живого писателя панели —
#    вектор WAL-reset порчи БД (инциденты 14.11/18.11/19.11/21.11).
if [[ -f "$DB" ]]; then
    echo "== БД: ретеншены выполняет панель, root-CLI в базу не пишет =="
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