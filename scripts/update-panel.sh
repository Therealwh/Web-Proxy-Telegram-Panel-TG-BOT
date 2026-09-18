#!/usr/bin/env bash
#
# =============================================================================
# TGGATE — Обновление панели из репозитория
# Бэкап → скачивание → миграции → зависимости → сборка → запуск → проверка.
# При ошибке — автоматический откат на бэкап.
# =============================================================================

set -euo pipefail

source /etc/tggate/install.env

readonly PANEL_REPO="https://github.com/Therealwh/Web-Proxy-Telegram-Panel-TG-BOT"
readonly TS="$(date +%Y%m%d-%H%M%S)"
readonly BACKUP_PATH="${BACKUP_DIR}/pre-update-${TS}"

info() { echo "[update] $*"; }
fail() { echo "[update] ОШИБКА: $*" >&2; exit 1; }

# ---------------------------------------------------------------------------
# Откат на бэкап при неудаче
# ---------------------------------------------------------------------------
rollback() {
    echo "[update] Выполняю откат на бэкап ${BACKUP_PATH}..." >&2
    systemctl stop tggate-panel || true
    cp -a "${BACKUP_PATH}/panel/." "${INSTALL_DIR}/panel/" || true
    cp -a "${BACKUP_PATH}/tggate.db" "${DATA_DIR}/tggate.db" 2>/dev/null || true
    cp -a "${BACKUP_PATH}/etc-tggate/." "${CONFIG_DIR}/" || true
    systemctl start tggate-panel || true
    fail "Обновление не удалось, выполнен откат на предыдущую версию."
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
cp -a "${DATA_DIR}/tggate.db" "${BACKUP_PATH}/tggate.db" 2>/dev/null || true

# ---------------------------------------------------------------------------
# 2. Получаем новую версию кода
# ---------------------------------------------------------------------------
info "Загружаю последнюю версию из ${PANEL_REPO}..."
cd "${INSTALL_DIR}"
if [[ -d .git ]]; then
    git fetch --depth 1 origin main
    git reset --hard origin/main
else
    fail "Каталог ${INSTALL_DIR} не является git-репозиторием"
fi

NEW_VERSION="$(cat VERSION 2>/dev/null || echo 'unknown')"
info "Новая версия: ${NEW_VERSION}"

# ---------------------------------------------------------------------------
# 3. Останавливаем панель, обновляем зависимости, собираем фронтенд
# ---------------------------------------------------------------------------
systemctl stop tggate-panel

cd "${INSTALL_DIR}/panel/backend"
npm install --omit=dev --no-audit --no-fund

cd "${INSTALL_DIR}/panel/frontend"
npm install --no-audit --no-fund
npm run build

# ---------------------------------------------------------------------------
# 4. Запускаем (миграции БД применяются автоматически при старте)
# ---------------------------------------------------------------------------
systemctl start tggate-panel

# ---------------------------------------------------------------------------
# 5. Проверка работоспособности
# ---------------------------------------------------------------------------
tries=0
until curl -fsS "http://127.0.0.1:${PANEL_PORT}/api/health" >/dev/null 2>&1; do
    tries=$((tries + 1))
    [[ ${tries} -gt 30 ]] && fail "Панель не запустилась после обновления"
    sleep 1
done

# Обновляем версию в конфиге
sed -i "s|^PANEL_VERSION=.*|PANEL_VERSION=\"${NEW_VERSION}\"|" /etc/tggate/install.env

trap - ERR
info "Обновление до ${NEW_VERSION} завершено успешно!"
info "Бэкап сохранён: ${BACKUP_PATH}"
