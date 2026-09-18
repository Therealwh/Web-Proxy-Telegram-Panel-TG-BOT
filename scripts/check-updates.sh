#!/usr/bin/env bash
#
# =============================================================================
# TGGATE — Проверка наличия обновлений (вызывается по cron и из панели)
# Результат сохраняется в /etc/tggate/versions.json
# Флаг --verbose выводит результат в консоль (для sudo TGGATE)
# =============================================================================

set -euo pipefail

source /etc/tggate/install.env

readonly VERSIONS_FILE="/etc/tggate/versions.json"
readonly PANEL_API_URL="https://api.github.com/repos/Therealwh/Web-Proxy-Telegram-Panel-TG-BOT/releases/latest"
readonly TELEMT_API_URL="https://api.github.com/repos/telemt/telemt/releases/latest"

VERBOSE=0
[[ "${1:-}" == "--verbose" ]] && VERBOSE=1

now="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

# --- Версия панели ---
panel_latest="$(curl -fsSL --max-time 15 "${PANEL_API_URL}" 2>/dev/null | jq -r '.tag_name' 2>/dev/null | sed 's/^v//' || echo '')"
[[ "${panel_latest}" == "null" ]] && panel_latest=""

# --- Версия Telemt ---
telemt_current="$(/usr/local/bin/telemt --version 2>/dev/null | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -n1 || echo '')"
telemt_latest="$(curl -fsSL --max-time 15 "${TELEMT_API_URL}" 2>/dev/null | jq -r '.tag_name' 2>/dev/null | sed 's/^v//' || echo '')"
[[ "${telemt_latest}" == "null" ]] && telemt_latest=""

# --- Срок действия SSL ---
ssl_expires=""
ssl_cert="$(echo | openssl s_client -servername "${DOMAIN}" -connect "${DOMAIN}:443" 2>/dev/null | openssl x509 -noout -enddate 2>/dev/null | cut -d= -f2 || true)"
if [[ -n "${ssl_cert}" ]]; then
    ssl_expires="$(date -u -d "${ssl_cert}" +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || echo '')"
fi

# Сохраняем результат
cat > "${VERSIONS_FILE}" <<EOF
{
  "panel": {
    "current": "${PANEL_VERSION:-1.0.0}",
    "latest": "${panel_latest}",
    "last_check": "${now}"
  },
  "telemt": {
    "current": "${telemt_current}",
    "latest": "${telemt_latest}",
    "last_check": "${now}"
  },
  "ssl": {
    "expires": "${ssl_expires}"
  }
}
EOF

# Уведомляем панель о результате проверки (для бейджа и TG-уведомлений)
curl -fsS -X POST "http://127.0.0.1:${PANEL_PORT}/api/internal/updates-status" \
    -H "Content-Type: application/json" \
    -d @"${VERSIONS_FILE}" >/dev/null 2>&1 || true

if [[ ${VERBOSE} -eq 1 ]]; then
    echo "Панель:  текущая ${PANEL_VERSION:-?} → последняя ${panel_latest:-н/д}"
    echo "Telemt:  текущая ${telemt_current:-?} → последняя ${telemt_latest:-н/д}"
    echo "SSL:     истекает ${ssl_expires:-н/д}"
fi
