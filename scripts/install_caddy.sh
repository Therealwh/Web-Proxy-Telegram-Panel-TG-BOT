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

# Отдельный домен Web Proxy (WEB_DOMAIN в install.env, настраивается из панели).
# Тот же reverse_proxy на Nginx: Nginx маршрутизирует WEB-пути на Telemt по путям,
# поэтому второй vhost — точная копия основного с другим server_name.
WEB_DOMAIN="$(grep '^WEB_DOMAIN=' "${CONFIG_DIR}/install.env" 2>/dev/null | cut -d'"' -f2 || true)"
if [[ -n "${WEB_DOMAIN}" ]]; then
    cat >> /etc/caddy/Caddyfile <<WEBBLOCK

${WEB_DOMAIN} {
	reverse_proxy 127.0.0.1:${NGINX_LOCAL_PORT} {
		header_up X-Real-IP {remote_host}
		header_up X-Forwarded-For {remote_host}
		header_up Host {host}
	}

	header {
		-Server
		Strict-Transport-Security "max-age=31536000; includeSubDomains"
	}

	log {
		level ERROR
	}
}
WEBBLOCK
    echo "[Caddy] Добавлен домен Web Proxy: ${WEB_DOMAIN}"
fi

# Проверка корректности Caddyfile перед применением
caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile

# Применяем конфиг: при свежей установке сервис ещё не запущен —
# тогда включаем и стартуем его (reload бы упал с "not active")
if systemctl is-active --quiet caddy; then
    systemctl reload caddy
else
    systemctl enable --now caddy
fi

echo "[Caddy] Конфигурация применена"

