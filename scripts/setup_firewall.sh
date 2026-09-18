#!/usr/bin/env bash
#
# =============================================================================
# TGGATE — Настройка файрвола UFW
# Открывает только необходимые порты: 80/tcp, 443/tcp, 8443/tcp, SSH
# =============================================================================

set -euo pipefail

# Подтягиваем параметры установки (MTPROTO_PORT и др.)
source /etc/tggate/install.env

echo "[UFW] Настройка правил файрвола..."

# Сбрасываем до предсказуемого состояния
ufw --force reset >/dev/null

# Политики по умолчанию: входящие запрещены, исходящие разрешены
ufw default deny incoming >/dev/null
ufw default allow outgoing >/dev/null

# SSH — критично не заблокировать доступ к серверу!
ufw allow ssh >/dev/null

# HTTP/HTTPS для Caddy (SSL + сайт-заглушка + Web Proxy через reverse proxy)
ufw allow 80/tcp >/dev/null
ufw allow 443/tcp >/dev/null

# MTProto прокси (Telemt)
ufw allow "${MTPROTO_PORT}/tcp" >/dev/null

# Включаем файрвол
ufw --force enable >/dev/null

echo "[UFW] Готово. Открыты порты: 22(ssh), 80, 443, ${MTPROTO_PORT}"
