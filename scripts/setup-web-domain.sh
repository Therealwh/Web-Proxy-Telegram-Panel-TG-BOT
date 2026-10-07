#!/usr/bin/env bash
#
# =============================================================================
# TGGATE — настройка отдельного домена Web Proxy (за Cloudflare или прямой)
#
# Делает три вещи:
#   1. Записывает WEB_DOMAIN в /etc/tggate/install.env (источник правды)
#   2. Перегенерирует Caddyfile (install_caddy.sh добавит блок из install.env)
#   3. Перегенерирует конфиг Nginx (install_nginx.sh добавит server_name)
#
# Запуск: ТОЛЬКО через root-хелпер (scripts/helper.js, ключ web-domain).
# Руками: sudo bash setup-web-domain.sh proxy-web.example.com
# =============================================================================

set -euo pipefail

INSTALL_DIR="/opt/tggate"
CONFIG_DIR="/etc/tggate"

[[ "${EUID}" -eq 0 ]] || { echo "Запустите от root" >&2; exit 1; }
[[ -f "${CONFIG_DIR}/install.env" ]] || { echo "TGGATE не установлен" >&2; exit 1; }

DOMAIN_ARG="${1:-}"
DOMAIN_RE='^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$'
[[ "${DOMAIN_ARG}" =~ ${DOMAIN_RE} ]] || { echo "Некорректный домен: ${DOMAIN_ARG}" >&2; exit 1; }

# 1. WEB_DOMAIN в install.env (идемпотентно)
if grep -q '^WEB_DOMAIN=' "${CONFIG_DIR}/install.env" 2>/dev/null; then
    sed -i "s|^WEB_DOMAIN=.*|WEB_DOMAIN=\"${DOMAIN_ARG}\"|" "${CONFIG_DIR}/install.env"
else
    echo "WEB_DOMAIN=\"${DOMAIN_ARG}\"" >> "${CONFIG_DIR}/install.env"
fi

# 2-3. Перегенерация Caddyfile + Nginx (скрипты сами читают WEB_DOMAIN из install.env)
bash "${INSTALL_DIR}/scripts/install_caddy.sh"
bash "${INSTALL_DIR}/scripts/install_nginx.sh"

echo "[web-domain] Готово: ${DOMAIN_ARG} обслуживается Caddy и Nginx"
