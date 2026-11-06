#!/usr/bin/env bash
# =============================================================================
# TGGATE — Применение конфига Telemt из черновика TOML-редактора панели.
#   $1 — путь к черновику (строго /var/lib/tggate/telemt-editor-draft.toml)
# Бэкап → установка → рестарт → проверка → автооткат при сбое.
# =============================================================================
set -uo pipefail

DRAFT="${1:-}"
CFG="/etc/tggate/telemt.toml"

[[ -f "$DRAFT" ]] || { echo "ОШИБКА: черновик не найден"; exit 1; }
[[ "$DRAFT" == /var/lib/tggate/* ]] || { echo "ОШИБКА: черновик вне разрешённого каталога"; exit 1; }

TS=$(date +%Y%m%d-%H%M%S)
BAK="/var/backups/tggate/telemt.toml.pre-editor-$TS"
mkdir -p /var/backups/tggate
cp -a "$CFG" "$BAK"

install -m 640 -o telemt -g telemt "$DRAFT" "$CFG"
systemctl restart telemt
sleep 3

if systemctl is-active --quiet telemt; then
  echo "OK: конфиг применён, Telemt активен. Бэкап: $BAK"
  rm -f "$DRAFT"
else
  cp -a "$BAK" "$CFG"
  systemctl restart telemt
  echo "ОШИБКА: Telemt не поднялся с новым конфигом — откат из $BAK"
  exit 1
fi
