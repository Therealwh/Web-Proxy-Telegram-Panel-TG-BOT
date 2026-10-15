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

# Убирает дубликаты сайтов в Caddyfile. Повторный запуск установщика
# или включение того же статус-домена дописывали блок заново, а Caddy
# на дубликат отвечает «ambiguous site definition» и не стартует —
# порт 443 оставался неслушанным, сайт и веб-прокси падали целиком.
dedupe_caddyfile() {
    python3 - "$1" <<'PYEOF'
import re, sys
path = sys.argv[1]
src = open(path).read()
lines = src.split('\n')
out, seen, removed = [], set(), []
i, n = 0, len(lines)

def site_name(line):
    m = re.match(r'^([^\s{#][^\s{]*)\s*\{', line)
    return m.group(1) if m else None

while i < n and site_name(lines[i]) is None:
    out.append(lines[i]); i += 1

while i < n:
    site = site_name(lines[i])
    if not site:
        out.append(lines[i]); i += 1; continue
    depth, block = 0, []
    while i < n:
        line = lines[i]
        block.append(line)
        depth += line.count('{') - line.count('}')
        i += 1
        if depth <= 0:
            break
    if site in seen:
        removed.append(site)
    else:
        seen.add(site); out.extend(block)

if removed:
    open(path, 'w').write('\n'.join(out) + '\n')
    print('[Caddy] Удалены дубликаты сайтов:', ', '.join(removed))
PYEOF
}

echo "[Caddy] Настройка HTTPS для ${DOMAIN}..."

# Если конфиг уже существует — сохраняем пользовательские блоки:
# перегенерация затирает их, а статус/WEB-домены дописываются ниже
if [[ -f /etc/caddy/Caddyfile ]]; then
    cp /etc/caddy/Caddyfile "/etc/caddy/Caddyfile.bak-$(date +%s)"
fi

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

# Дедупликация: повторные запуски дописывали одинаковые блоки,
# а Caddy с дубликатом не стартует
dedupe_caddyfile /etc/caddy/Caddyfile

# Проверка корректности Caddyfile перед применением.
# Если конфиг невалиден — НЕ трогаем работающий сервис и откатываемся
# на бэкап, иначе сайт и веб-прокси останутся без TLS
if ! caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile >/tmp/caddy-validate.log 2>&1; then
    echo "[Caddy] ОШИБКА: конфиг невалиден:" >&2
    tail -5 /tmp/caddy-validate.log >&2
    LATEST_BAK=$(ls -t /etc/caddy/Caddyfile.bak-* 2>/dev/null | head -1 || true)
    if [[ -n "${LATEST_BAK}" ]]; then
        cp "${LATEST_BAK}" /etc/caddy/Caddyfile
        echo "[Caddy] Восстановлен предыдущий конфиг: ${LATEST_BAK}" >&2
        if caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null 2>&1; then
            echo "[Caddy] Бэкап валиден, применяю его" >&2
        else
            echo "[Caddy] Бэкап тоже невалиден — конфиг оставлен как есть, разбирайтесь вручную" >&2
        fi
    fi
    exit 1
fi

# Применяем конфиг: при свежей установке сервис ещё не запущен —
# тогда включаем и стартуем его (reload бы упал с "not active")
if systemctl is-active --quiet caddy; then
    systemctl reload caddy
else
    systemctl enable --now caddy
fi

echo "[Caddy] Конфигурация применена"

