#!/usr/bin/env bash
#
# =============================================================================
# TGGATE — статистика диска (JSON на stdout)
#
# Читает то, что недоступно панели от пользователя tggate:
#   - общий размер/занято/свободно на корневом разделе;
#   - размер systemd journal;
#   - размер /var/log.
#
# Запуск: ТОЛЬКО через root-хелпер (ключ disk-stats).
# =============================================================================
set -euo pipefail

# Корневой раздел: total/used/avail в байтах
read -r _ TOTAL USED AVAIL PCT _ < <(df -B1 / | tail -1)

JOURNAL=$(journalctl --disk-usage 2>/dev/null | grep -oE '[0-9]+(\.[0-9]+)?[KMGTP]?' | tail -1 || echo "0")
JOURNAL_BYTES=$(numfmt --from=iec "${JOURNAL:-0}" 2>/dev/null || echo 0)

VAR_LOG=$(du -sb /var/log 2>/dev/null | cut -f1 || echo 0)

printf '{"system":{"total_bytes":%s,"used_bytes":%s,"free_bytes":%s,"used_percent":"%s"},"logs":{"journal_bytes":%s,"varlog_bytes":%s}}\n' \
    "${TOTAL:-0}" "${USED:-0}" "${AVAIL:-0}" "$(df -h / | tail -1 | awk '{print $5}' | tr -d '%')" \
    "${JOURNAL_BYTES:-0}" "${VAR_LOG:-0}"