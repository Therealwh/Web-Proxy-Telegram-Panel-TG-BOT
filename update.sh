#!/usr/bin/env bash
#
# =============================================================================
# TGGATE — Обновление панели (обёртка, вызывает scripts/update-panel.sh)
# Использование: sudo bash update.sh
# =============================================================================

set -euo pipefail

if [[ "${EUID}" -ne 0 ]]; then
    echo "Запустите с правами root: sudo bash update.sh" >&2
    exit 1
fi

exec bash /opt/tggate/scripts/update-panel.sh
