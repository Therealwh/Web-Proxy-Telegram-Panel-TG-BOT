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

# Дополнительный домен статус-страницы (опционально: STATUS_DOMAIN в install.env).
# ВАЖНО: добавляем ДО валидации и релоада, иначе конфиг применится без него.
if [[ -n "${STATUS_DOMAIN:-}" ]]; then
    cat >> /etc/caddy/Caddyfile <<STATUSBLOCK

${STATUS_DOMAIN} {
	reverse_proxy 127.0.0.1:${PANEL_PORT}
	log {
		level ERROR
	}
}
STATUSBLOCK
    echo "[Caddy] Добавлен статус-домен: ${STATUS_DOMAIN}"
fi

# Проверка корректности Caddyfile перед применением
caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile

echo "[Caddy] Конфигурация применена"

# Дополнительный домен статус-страницы (опционально: STATUS_DOMAIN в install.env)
if [[ -n "${STATUS_DOMAIN:-}" ]]; then
    cat >> /etc/caddy/Caddyfile <<STATUSBLOCK

${STATUS_DOMAIN} {
	reverse_proxy 127.0.0.1:${PANEL_PORT}
	log {
		level ERROR
	}
}
STATUSBLOCK
    echo "[Caddy] Добавлен статус-домен: ${STATUS_DOMAIN}"
fi
