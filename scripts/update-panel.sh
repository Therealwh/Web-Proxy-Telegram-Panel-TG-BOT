#!/usr/bin/env bash
#
# =============================================================================
# TGGATE — Обновление панели из репозитория
#
# ВАЖНО: скрипт запускается ИЗ РАБОТАЮЩЕЙ панели (через sudo).
# Нельзя останавливать панель до завершения — systemd убьёт cgroup сервиса
# вместе с этим скриптом. Панель перезапускается ОДНИМ ФИНАЛЬНЫМ шагом.
# =============================================================================

set -euo pipefail

source /etc/tggate/install.env

readonly PANEL_REPO="https://github.com/Therealwh/Web-Proxy-Telegram-Panel-TG-BOT"
readonly TS="$(date +%Y%m%d-%H%M%S)"
readonly BACKUP_PATH="${BACKUP_DIR}/pre-update-${TS}"
readonly DB_PATH="${DATA_DIR}/tggate.db"

info() { echo "[update] $*"; }

fail_missing_tag() {
    echo "[update] ФАТАЛЬНО: тег не найден в репозитории" >&2
    log_history "panel" "failed" "тег не найден"
    exit 1
}

# Запись в историю обновлений (sqlite3 из состава Ubuntu).
# ВАЖНО: sqlite3 от root создаёт root-owned WAL-файлы — после записи
# обязательно возвращаем владение пользователю панели tggate!
log_history() {
    local component="$1" status="$2" log="$3"
    sqlite3 "${DB_PATH}" \
        "INSERT INTO updates_log (component, from_version, to_version, status, log) VALUES ('${component}', NULL, NULL, '${status}', '${log//\'/\'\'}');" \
        2>/dev/null || true
    chown tggate:tggate "${DB_PATH}" 2>/dev/null || true
    chown tggate:tggate "${DB_PATH}-wal" "${DB_PATH}-shm" 2>/dev/null || true
}

# ---------------------------------------------------------------------------
# Откат при любой ошибке ДО финального рестарта
# ---------------------------------------------------------------------------
rollback() {
    echo "[update] ОШИБКА! Откатываюсь на бэкап ${BACKUP_PATH}..." >&2
    cp -a "${BACKUP_PATH}/panel/." "${INSTALL_DIR}/panel/" 2>/dev/null || true
    cp -a "${BACKUP_PATH}/tggate.db" "${DATA_DIR}/tggate.db" 2>/dev/null || true
    cp -a "${BACKUP_PATH}/etc-tggate/." "${CONFIG_DIR}/" 2>/dev/null || true
    log_history "panel" "failed" "откат на бэкап ${BACKUP_PATH}"
    systemctl restart tggate-panel 2>/dev/null || true
    echo "[update] Откат выполнен, панель перезапущена." >&2
    exit 1
}
trap rollback ERR

# ---------------------------------------------------------------------------
# 1. Бэкап перед обновлением
# ---------------------------------------------------------------------------
info "Создаю бэкап: ${BACKUP_PATH}"
mkdir -p "${BACKUP_PATH}"
cp -a "${INSTALL_DIR}/panel" "${BACKUP_PATH}/panel"
cp -a "${CONFIG_DIR}" "${BACKUP_PATH}/etc-tggate"
cp -a "${DATA_DIR}/website" "${BACKUP_PATH}/website" 2>/dev/null || true
cp -a "${DB_PATH}" "${BACKUP_PATH}/tggate.db" 2>/dev/null || true

# ---------------------------------------------------------------------------
# 2. Получаем новую версию кода
# TARGET (опционально): тег релиза, например v1.0.9 или 1.0.9
# Без аргумента — последняя версия из ветки main.
# Панель продолжает работать во время обновления — не останавливаем её!
# ---------------------------------------------------------------------------
TARGET="${1:-}"
info "Загружаю ${TARGET:-последнюю версию} из ${PANEL_REPO}..."
cd "${INSTALL_DIR}"
if [[ -d .git ]]; then
    if [[ -n "${TARGET}" ]]; then
    if ! git fetch --depth 1 origin "refs/tags/${TARGET}:refs/tags/${TARGET}" 2>/dev/null; then
        TARGET="v${TARGET#v}"
        git fetch --depth 1 origin "refs/tags/${TARGET}:refs/tags/${TARGET}" \
            || fail_missing_tag
    fi
    git checkout --force "${TARGET}"
    else
        git fetch --depth 1 origin main
        git reset --hard origin/main
    fi
else
    echo "[update] ФАТАЛЬНО: ${INSTALL_DIR} не git-репозиторий" >&2
    log_history "panel" "failed" "не git-репозиторий"
    exit 1
fi

NEW_VERSION="$(cat VERSION 2>/dev/null || echo 'unknown')"
info "Новая версия: ${NEW_VERSION}"

# ---------------------------------------------------------------------------
# 3. Обновляем зависимости и пересобираем фронтенд (панель ещё работает)
# ---------------------------------------------------------------------------
cd "${INSTALL_DIR}/panel/backend"
npm install --omit=dev --no-audit --no-fund

cd "${INSTALL_DIR}/panel/frontend"
npm install --no-audit --no-fund
npm run build

# ---------------------------------------------------------------------------
# 4. Обновляем root-копии скриптов (иначе из панели запускается старьё)
# ---------------------------------------------------------------------------
install -m 0755 "${INSTALL_DIR}/scripts/update-panel.sh"  /usr/local/bin/tggate-update-panel
install -m 0755 "${INSTALL_DIR}/scripts/update-telemt.sh" /usr/local/bin/tggate-update-telemt
install -m 0755 "${INSTALL_DIR}/scripts/check-updates.sh" /usr/local/bin/tggate-check-updates

# ---------------------------------------------------------------------------
# 5. Финал: версия в конфиг, запись в историю, перезапуск панели
# (рестарт — ПОСЛЕДНЯЯ строка: systemd убьёт этот скрипт вместе с сервисом,
#  поэтому всё важное должно быть сделано выше!)
# ---------------------------------------------------------------------------
sed -i "s|^PANEL_VERSION=.*|PANEL_VERSION=\"${NEW_VERSION}\"|" /etc/tggate/install.env

# Владелец базы: любые sqlite3-записи от root ломают доступ панели
chown tggate:tggate "${DB_PATH}" "${DB_PATH}-wal" "${DB_PATH}-shm" 2>/dev/null || true

log_history "panel" "success" "обновлено до ${NEW_VERSION} (бэкап: ${BACKUP_PATH})"

info "Готово! Перезапускаю панель..."
systemctl restart tggate-panel
