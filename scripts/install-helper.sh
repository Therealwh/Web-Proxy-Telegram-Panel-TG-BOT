#!/usr/bin/env bash
#
# =============================================================================
# TGGATE — установка привилегированного хелпера обновлений (запуск от root)
#
# Заменяет хрупкую схему с sudo: панель командует root-хелпером через
# 127.0.0.1:9443 с секретом. Обновления из панели работают всегда.
#
# Запуск: bash /opt/tggate/scripts/install-helper.sh
# =============================================================================

set -euo pipefail

INSTALL_DIR="/opt/tggate"
CONFIG_DIR="/etc/tggate"
PANEL_ENV="${INSTALL_DIR}/panel/backend/.env"

[[ "${EUID}" -eq 0 ]] || { echo "Запустите от root: sudo bash $0" >&2; exit 1; }
[[ -f "${CONFIG_DIR}/install.env" ]] || { echo "TGGATE не установлен" >&2; exit 1; }

echo "[helper] Установка..."

# 1. Секрет хелпера (генерируем один раз)
if grep -q '^HELPER_SECRET=' "${CONFIG_DIR}/install.env" 2>/dev/null; then
    HELPER_SECRET="$(grep '^HELPER_SECRET=' "${CONFIG_DIR}/install.env" | cut -d'"' -f2)"
else
    HELPER_SECRET="$(openssl rand -hex 32)"
    echo "HELPER_SECRET=\"${HELPER_SECRET}\"" >> "${CONFIG_DIR}/install.env"
fi

# 2. Юнит systemd
install -m 0644 "${INSTALL_DIR}/systemd/tggate-helper.service" /etc/systemd/system/tggate-helper.service
systemctl daemon-reload
systemctl enable --now tggate-helper

# 3. Секрет и адрес — в .env панели (идемпотентно)
if ! id -u tggate >/dev/null 2>&1; then useradd --system --home "${INSTALL_DIR}" --shell /usr/sbin/nologin tggate; fi
add_env() {
    local key="$1" val="$2"
    if grep -q "^${key}=" "${PANEL_ENV}" 2>/dev/null; then
        sed -i "s|^${key}=.*|${key}=${val}|" "${PANEL_ENV}"
    else
        echo "${key}=${val}" >> "${PANEL_ENV}"
    fi
}
add_env "HELPER_URL" "http://127.0.0.1:9443"
add_env "HELPER_SECRET" "${HELPER_SECRET}"

# 4. Убираем sudo-правило (больше не нужно)
rm -f /etc/sudoers.d/tggate

# 5. Перезапуск панели, чтобы она прочитала новые переменные
systemctl restart tggate-panel 2>/dev/null || true

systemctl is-active --quiet tggate-helper && echo "[helper] Готово! Обновления из панели теперь работают всегда." \
    || { echo "[helper] ОШИБКА: сервис не запустился: journalctl -u tggate-helper" >&2; exit 1; }
