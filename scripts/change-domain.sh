#!/usr/bin/env bash
#
# =============================================================================
# TGGATE — смена домена панели без переустановки (запуск от root через Helper)
#
# Использование: bash change-domain.sh <новый-домен>
# Делает то же, что «7. Сменить домен» в sudo TGGATE:
#   1. Обновляет DOMAIN в /etc/tggate/install.env и в .env панели (dotenv)
#   2. Перегенерирует конфиги nginx и Caddy под новый домен
#   3. Перезагружает nginx и Caddy (SSL-сертификат выпустится автоматически)
#   4. Перезапускает панель — она подхватит новый DOMAIN из .env
# =============================================================================

set -euo pipefail

NEW_DOMAIN="${1:-}"
CONFIG_DIR="/etc/tggate"
INSTALL_DIR="/opt/tggate"
PANEL_ENV="${INSTALL_DIR}/panel/backend/.env"

# Валидация: только готовый lowercase-FQDN, без путей, портов и пробелов
if [[ ! "${NEW_DOMAIN}" =~ ^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$ ]] \
   || (( ${#NEW_DOMAIN} > 253 )); then
    echo "ERROR: некорректный домен: '${NEW_DOMAIN}'" >&2
    exit 1
fi

CURRENT_DOMAIN="$(grep -oP '^DOMAIN="\K[^"]+' "${CONFIG_DIR}/install.env" 2>/dev/null || echo '')"
if [[ "${NEW_DOMAIN}" == "${CURRENT_DOMAIN}" ]]; then
    echo "ERROR: домен ${NEW_DOMAIN} уже установлен" >&2
    exit 1
fi

echo "[domain] Смена домена: ${CURRENT_DOMAIN:-?} → ${NEW_DOMAIN}"

# 1. Источник правды (install.env) + рабочее окружение панели (.env)
sed -i "s|^DOMAIN=.*|DOMAIN=\"${NEW_DOMAIN}\"|" "${CONFIG_DIR}/install.env"
if grep -q '^DOMAIN=' "${PANEL_ENV}" 2>/dev/null; then
    sed -i "s|^DOMAIN=.*|DOMAIN=${NEW_DOMAIN}|" "${PANEL_ENV}"
else
    echo "DOMAIN=${NEW_DOMAIN}" >> "${PANEL_ENV}"
fi

# 2. Перегенерация конфигов веб-серверов (идентично пункту 7 в tggate.sh)
DOMAIN="${NEW_DOMAIN}" bash "${INSTALL_DIR}/scripts/install_nginx.sh"
DOMAIN="${NEW_DOMAIN}" bash "${INSTALL_DIR}/scripts/install_caddy.sh"

# 3. Релоад веб-серверов + рестарт панели (новый DOMAIN подхватится из .env)
systemctl reload nginx caddy
systemctl restart tggate-panel

echo "[domain] Готово. SSL-сертификат для ${NEW_DOMAIN} выпустится автоматически (Caddy)."
