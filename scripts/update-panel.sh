#!/usr/bin/env bash
#
# =============================================================================
# TGGATE — Обновление панели из репозитория
#
# ВАЖНО: скрипт запускается ИЗ РАБОТАЮЩЕЙ панели (через sudo).
# Нельзя останавливать панель до завершения — systemd убьёт cgroup сервиса
# вместе с этим скриптом. Панель перезапускается ОДНИМ ФИНАЛЬНЫМ шагом.
# =============================================================================

# ---------------------------------------------------------------------------
# КРИТИЧНО: скрипт переписывает сам себя.
# В середине выполнения делается `git checkout` нового тега — то есть файл, из
# которого bash продолжает читать команды, подменяется другим содержимым.
# Bash читает файл по смещению и после подмены «уезжает» в произвольное место:
# наблюдались запуск npm не в том каталоге и выпадение кусков кода.
# Поэтому запускаем тело из pipe: там оно читается целиком и подмена файла
# больше ни на что не влияет. Всё, что нужно инициализировать, объявляется
# ПОСЛЕ маркера — до него при перезапуске ничего не доходит.
# ---------------------------------------------------------------------------
if [[ "${TGGATE_UPDATE_REEXEC:-0}" != "1" ]]; then
    export TGGATE_UPDATE_REEXEC=1
    exec bash <(sed -n '/^# __TGGATE_BODY__$/,$p' "$0")
fi
# __TGGATE_BODY__

# ВАЖНО: set -euo pipefail объявлен ПОСЛЕ маркера — иначе перезапуск через exec
# потерял бы его, а вместе с ним и trap отката: при ошибке панель осталась бы
# в промежуточном состоянии молча, без отката.
set -euo pipefail

# Защита от двойного запуска: flock держится, пока скрипт жив;
# при смерти процесса блокировка снимается сама
exec 9>/run/tggate-panel-update.lock
# В detached-юните (systemd-run) окружение чистое — npm требует HOME для кэша
export HOME="${HOME:-/root}"
flock -n 9 || { echo "[update] Другое обновление уже выполняется" >&2; exit 2; }

source /etc/tggate/install.env

readonly PANEL_REPO="https://github.com/Therealwh/Web-Proxy-Telegram-Panel-TG-BOT"
readonly TS="$(date +%Y%m%d-%H%M%S)"
readonly BACKUP_PATH="${BACKUP_DIR}/pre-update-${TS}"
readonly DB_PATH="${DATA_DIR}/tggate.db"

info() { echo "[update] $*"; }

# Живой статус для статус-бара панели (атомарная запись в /var/lib/tggate)
STATUS_FILE="/var/lib/tggate/update-status.json"
STARTED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
set_status() {
    local step="$1" total="$2" message="$3" status="$4"
    local tmp="${STATUS_FILE}.$$"
    mkdir -p /var/lib/tggate 2>/dev/null || true
    printf '{"component":"panel","step":%s,"total":%s,"message":"%s","status":"%s","updated_at":"%s","started_at":"%s"}\n' \
        "${step}" "${total}" "${message//\"/\\\"}" "${status}" \
        "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "${STARTED_AT}" > "${tmp}"
    mv -f "${tmp}" "${STATUS_FILE}"
    chmod 644 "${STATUS_FILE}" 2>/dev/null || true
}

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
    local failed_cmd="${BASH_COMMAND:-неизвестно}"
    echo "[update] ОШИБКА (команда: ${failed_cmd})! Откатываюсь на бэкап ${BACKUP_PATH}..." >&2
    # Откат: возвращаем ДЕРЕВО на тег версии, что работала до обновления
    # (cp из бэкапа оставлял бы старые файлы поверх новых — «отравление» дерева)
    git -C "${INSTALL_DIR}" checkout -f "v${PANEL_VERSION}" 2>/dev/null || true
    cp -a "${BACKUP_PATH}/tggate.db" "${DATA_DIR}/tggate.db" 2>/dev/null || true
    cp -a "${BACKUP_PATH}/etc-tggate/." "${CONFIG_DIR}/" 2>/dev/null || true
    [[ -f "${BACKUP_PATH}/VERSION" ]] && cp -a "${BACKUP_PATH}/VERSION" "${INSTALL_DIR}/VERSION"
    log_history "panel" "failed" "упала команда: ${failed_cmd} (бэкап: ${BACKUP_PATH})"
    set_status 0 6 "Ошибка: выполнен откат из бэкапа" failed
    systemctl restart tggate-panel 2>/dev/null || true
    echo "[update] Откат выполнен, панель перезапущена." >&2
    exit 1
}
trap rollback ERR

# ---------------------------------------------------------------------------
# 1. Ротация старых бэкапов (иначе диск забивается: каждый бэкап — вся панель)
# Хаускилинг: падение ротации (нет бэкапов, права) НЕ должно срывать обновление
# ---------------------------------------------------------------------------
info "Ротация бэкапов: оставляю последние 3"
find "${BACKUP_DIR}" -maxdepth 1 -type d -name 'pre-update-*' 2>/dev/null \
    | sort -r | tail -n +4 | xargs -r rm -rf 2>/dev/null || true

# ---------------------------------------------------------------------------
# 1.5 Бэкап перед обновлением
# ---------------------------------------------------------------------------
info "Создаю бэкап: ${BACKUP_PATH}"
set_status 1 6 "Создание бэкапа..." running
mkdir -p "${BACKUP_PATH}"
# Панель копируем БЕЗ node_modules и dist (сотни МБ, пересоздаются npm) —
# бэкап занимает мегабайты вместо гигабайтов
mkdir -p "${BACKUP_PATH}/panel"
tar -C "${INSTALL_DIR}" \
    --exclude='panel/backend/node_modules' \
    --exclude='panel/frontend/node_modules' \
    --exclude='panel/frontend/dist' \
    -cf - panel | tar -C "${BACKUP_PATH}" -xf -
cp -a "${INSTALL_DIR}/VERSION" "${BACKUP_PATH}/VERSION" 2>/dev/null || true
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
set_status 2 6 "Загрузка релиза из GitHub..." running
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
# Установка зависимостей с повторами.
# Транзиентный обрыв связи с реестром npm ронял всё обновление и откатывало
# панель на старый тег. Повторяем попытку, а при окончательной ошибке
# сохраняем вывод команды — иначе в панели видно только имя команды,
# и причину приходится выяснять вслепую.
# ---------------------------------------------------------------------------
npm_install_robust() {
    run_robust "npm install" "$@"
}

# ---------------------------------------------------------------------------
# Запуск npm-команды с повторами и сохранением вывода.
# Используется и для установки, и для сборки: обе команды падали по-разному,
# и без лога обе были «непонятно что произошло».
#   $1 — человекочитаемое имя команды
#   $2 — каталог
#   $3.. — аргументы npm ЦЕЛИКОМ, вместе с подкомандой (install / run ...)
# ---------------------------------------------------------------------------
run_robust() {
    local label="$1" dir="$2"; shift 2
    local sub="${1:-build}"
    local log="${BACKUP_PATH}/npm-${sub}-$(basename "${dir}")-$(date +%H%M%S).log"
    mkdir -p "${BACKUP_PATH}"
    local attempt
    for attempt in 1 2 3; do
        info "${label} в $(basename "${dir}") (попытка ${attempt}/3)..."
        if (cd "${dir}" && npm "$@") 2>&1 | tee "${log}"; then
            return 0
        fi
        info "Попытка ${attempt} не удалась, жду перед повтором..."
        sleep $((attempt * 10))
    done
    echo "[update] ФАТАЛЬНО: ${label} в ${dir} не удался после 3 попыток." >&2
    echo "[update] Последние строки вывода:" >&2
    tail -40 "${log}" >&2 || true
    echo "[update] Полный лог: ${log}" >&2
    log_history "panel" "failed" "${label} в ${dir} не удался после 3 попыток; лог: ${log}"
    set_status 4 6 "Ошибка: ${label}, выполняется откат" failed
    return 1
}

# ---------------------------------------------------------------------------
# 3. Обновляем зависимости и пересобираем фронтенд (панель ещё работает)
# ---------------------------------------------------------------------------
# Git от root в каталоге пользователя tggate: явно доверяем репозиторию
git config --global --add safe.directory "${INSTALL_DIR}" 2>/dev/null || true

set_status 3 6 "Установка зависимостей backend..." running
npm_install_robust "${INSTALL_DIR}/panel/backend" install --omit=dev --no-audit --no-fund

set_status 4 6 "Установка зависимостей и сборка фронтенда..." running
npm_install_robust "${INSTALL_DIR}/panel/frontend" install --no-audit --no-fund

# Потолок heap для сборки подбираем по реально доступной памяти, а не задаём
# константой: на VPS с 2 ГБ RAM и без swap константа либо мешает, либо приводит
# к тому, что сборку прибивает OOM-killer. Переопределяется через TGGATE_BUILD_HEAP.
detect_build_heap() {
    local avail_kb avail_mb heap
    avail_kb="$(awk '/^MemAvailable:/ {print $2}' /proc/meminfo 2>/dev/null || echo 0)"
    avail_mb=$(( avail_kb / 1024 ))
    (( avail_mb <= 0 )) && { echo 1024; return 0; }
    heap=$(( avail_mb * 60 / 100 ))
    (( heap < 768 )) && heap=768
    (( heap > 2048 )) && heap=2048
    echo "${heap}"
}

BUILD_HEAP="${TGGATE_BUILD_HEAP:-$(detect_build_heap)}"
export NODE_OPTIONS="--max-old-space-size=${BUILD_HEAP}"
info "Сборка фронтенда (доступно памяти ~${BUILD_HEAP} МБ потолка heap)"
sync
echo 3 > /proc/sys/vm/drop_caches 2>/dev/null || true   # сбрасываем файловый кэш перед сборкой
run_robust "npm run build" "${INSTALL_DIR}/panel/frontend" run build

# npm от root создаёт root-owned файлы — возвращаем владение панели
chown -R tggate:tggate "${INSTALL_DIR}/panel" 2>/dev/null || true

info "Готово! Перезапускаю панель..."

# ---------------------------------------------------------------------------
# Финал: версия в конфиг, права на БД, запись в историю, перезапуск
# (рестарт — ПОСЛЕДНЯЯ строка: systemd убьёт этот скрипт вместе с сервисом,
#  поэтому всё важное должно быть сделано выше!)
# ---------------------------------------------------------------------------
sed -i "s|^PANEL_VERSION=.*|PANEL_VERSION=\"${NEW_VERSION}\"|" /etc/tggate/install.env
set_status 5 6 "Перезапуск панели..." running

# Владелец базы: любые sqlite3-записи от root ломают доступ панели
chown tggate:tggate "${DB_PATH}" "${DB_PATH}-wal" "${DB_PATH}-shm" 2>/dev/null || true

log_history "panel" "success" "обновлено до ${NEW_VERSION} (бэкап: ${BACKUP_PATH})"

info "Готово! Перезапускаю панель..."
systemctl restart tggate-panel
# Успех пишем ДО рестарта хелпера: скрипт запущен хелпером, и рестарт хелпера
# убьёт этот скрипт (cgroup) — запись после него просто не выполнится
set_status 6 6 "Обновлено до ${NEW_VERSION}" success
# Helper code (helper.js) is updated with the repo - restart it too
systemctl restart tggate-helper 2>/dev/null || true
