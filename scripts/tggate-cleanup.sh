#!/bin/bash
# Авточистка TGGATE: ротация бэкапов.
#
# Ретеншены логов (connection_logs/dc_checks/uptime_checks) выполняет сама
# панель (logCollector/dcMonitor/scheduler). SQL-блок из root-CLI удалён
# (21.11): DELETE-бёрсты и wal_checkpoint(TRUNCATE) из CLI sqlite3 < 3.51.3
# против живого писателя панели — механизм WAL-reset порчи БД
# (инциденты 14.11/18.11/19.11/21.11).
#
# ПРАВИЛО: root никогда не пишет в /var/lib/tggate/tggate.db*.

# Ротация бэкапов: оставляем 5 свежих
cd /var/backups/tggate || exit 0
ls -t | tail -n +6 | xargs -r rm -rf

# Старые директории pre-update (кроме 2 свежих)
ls -dt pre-update-* 2>/dev/null | tail -n +3 | xargs -r rm -rf
