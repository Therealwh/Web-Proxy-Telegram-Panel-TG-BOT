#!/usr/bin/env bash
#
# =============================================================================
# TGGATE — Настройка Nginx как reverse proxy (за Caddy)
#
# Схема маршрутизации:
#   Caddy (443, TLS) → Nginx (127.0.0.1:8080) → панель (127.0.0.1:3000)
#                                            ↘ Telemt WEB (127.0.0.1:18080)
#
# Весь публичный vhost направляется в Telemt (требование WEB-режима):
# Telemt сам обрабатывает carrier-запросы, а обычные — отправляет в decoy.
# Панель доступна только по секретному пути и служебным префиксам.
# =============================================================================

set -euo pipefail

source /etc/tggate/install.env

echo "[Nginx] Настройка reverse proxy..."

# map для WebSocket Upgrade должен быть в контексте http
cat > /etc/nginx/conf.d/tggate-map.conf <<'EOF'
# Преобразование заголовка Upgrade для WebSocket (панель + Telemt carriers)
map $http_upgrade $tggate_connection_upgrade {
    default upgrade;
    ''      '';
}
EOF

# Общий фрагмент проксирования в Telemt WEB-listener
# (используется и для carrier-путей, и для catch-all)
# X-Forwarded-For передаём РОВНО как пришёл от Caddy (реальный IP клиента) —
# Telemt требует один корректно разбираемый адрес, а не цепочку.
cat > /etc/nginx/tggate-telemt-proxy.inc <<'EOF'
proxy_http_version 1.1;
proxy_set_header Host $host;
proxy_set_header X-Forwarded-For $http_x_forwarded_for;
proxy_set_header Upgrade $http_upgrade;
proxy_set_header Connection $tggate_connection_upgrade;

proxy_connect_timeout 5s;
proxy_send_timeout 65s;
proxy_read_timeout 65s;
proxy_request_buffering off;
proxy_buffering off;
proxy_next_upstream off;
EOF

# Генерируем конфиг vhost из шаблона
sed -e "s|{{DOMAIN}}|${DOMAIN}|g" \
    -e "s|{{ADMIN_PATH}}|${ADMIN_PATH}|g" \
    -e "s|{{PANEL_PORT}}|${PANEL_PORT}|g" \
    -e "s|{{TELEMT_WEB_PORT}}|${TELEMT_WEB_PORT}|g" \
    -e "s|{{NGINX_LOCAL_PORT}}|${NGINX_LOCAL_PORT}|g" \
    "${INSTALL_DIR}/templates/nginx.conf.tmpl" > /etc/nginx/sites-available/tggate.conf

ln -sf /etc/nginx/sites-available/tggate.conf /etc/nginx/sites-enabled/tggate.conf

# Убираем дефолтный сайт, чтобы он не перехватывал запросы
rm -f /etc/nginx/sites-enabled/default

# Проверяем конфигурацию перед применением
nginx -t

echo "[Nginx] Конфигурация применена"
