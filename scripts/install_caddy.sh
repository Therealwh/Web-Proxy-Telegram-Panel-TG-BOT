#!/usr/bin/env bash
#
# =============================================================================
# TGGATE — Настройка Caddy: HTTPS (Let's Encrypt) + терминация TLS
#
# Caddy — единственная точка входа снаружи (80/443):
#   - Автоматически выпускает и продлевает SSL-сертификат
#   - Передаёт трафик на Nginx (127.0.0.1:8080), сохраняя заголовки
# =============================================================================

set -euo pipefail

source /etc/tggate/install.env

echo "[Caddy] Настройка HTTPS для ${DOMAIN}..."

# Генерируем Caddyfile из шаблона
sed -e "s|{{DOMAIN}}|${DOMAIN}|g" \
    -e "s|{{EMAIL}}|${EMAIL}|g" \
    -e "s|{{NGINX_LOCAL_PORT}}|${NGINX_LOCAL_PORT}|g" \
    "${INSTALL_DIR}/templates/caddyfile.tmpl" > /etc/caddy/Caddyfile

# Проверяем валидность конфигурации
caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile

echo "[Caddy] Конфигурация применена"
