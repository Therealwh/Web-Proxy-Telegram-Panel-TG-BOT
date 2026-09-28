#!/usr/bin/env bash
#
# =============================================================================
# TGGATE — Обновление Telemt до последней версии
# Бэкап конфига → скачивание → SHA-256 → замена → рестарт → проверка → откат.
# =============================================================================

set -euo pipefail

source /etc/tggate/install.env

readonly TELEMT_REPO="https://github.com/telemt/telemt"
readonly TELEMT_API_URL="https://api.github.com/repos/telemt/telemt/releases/latest"
readonly BIN_PATH="/usr/local/bin/telemt"
readonly BIN_BACKUP="/usr/local/bin/telemt.bak"

info() { echo "[telemt-update] $*"; }
warn() { echo "[telemt-update] WARN: $*" >&2; }
fail() { echo "[telemt-update] ОШИБКА: $*" >&2; exit 1; }

# Живой статус для статус-бара панели (атомарная запись в /var/lib/tggate)
STATUS_FILE="/var/lib/tggate/update-status.json"
STARTED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
set_status() {
    local step="$1" total="$2" message="$3" status="$4"
    local tmp="${STATUS_FILE}.$$"
    mkdir -p /var/lib/tggate 2>/dev/null || true
    printf '{"component":"telemt","step":%s,"total":%s,"message":"%s","status":"%s","updated_at":"%s","started_at":"%s"}\n' \
        "${step}" "${total}" "${message//\"/\\\"}" "${status}" \
        "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "${STARTED_AT}" > "${tmp}"
    mv -f "${tmp}" "${STATUS_FILE}"
    chmod 644 "${STATUS_FILE}" 2>/dev/null || true
}

# ---------------------------------------------------------------------------
# Определяем целевую версию: аргумент скрипта или последний релиз
# Использование: update-telemt.sh [версия]   (например: update-telemt.sh 3.5.6)
# ---------------------------------------------------------------------------
TARGET="${1:-}"
set_status 1 5 "Проверка версий..." running
CURRENT="$(${BIN_PATH} --version 2>/dev/null | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -n1 || echo '0.0.0')"

if [[ -n "${TARGET}" ]]; then
    LATEST="${TARGET}"
else
    LATEST="$(curl -fsSL "${TELEMT_API_URL}" | jq -r '.tag_name' | sed 's/^v//')"
    [[ -n "${LATEST}" && "${LATEST}" != "null" ]] || fail "Не удалось получить последнюю версию с GitHub"
fi

info "Текущая версия: ${CURRENT}, целевая: ${LATEST}"
if [[ "${CURRENT}" == "${LATEST}" ]]; then
    info "Версия ${LATEST} уже установлена. Обновление не требуется."
    set_status 5 5 "Уже последняя версия (${LATEST})" success
    exit 0
fi

# ---------------------------------------------------------------------------
# Архитектура
# ---------------------------------------------------------------------------
case "$(uname -m)" in
    x86_64)  ARCH="x86_64" ;;
    aarch64) ARCH="aarch64" ;;
    *)       fail "Неподдерживаемая архитектура" ;;
esac

# ---------------------------------------------------------------------------
# Скачиваем и проверяем
# ---------------------------------------------------------------------------
TMP_DIR="$(mktemp -d)"
set_status 2 5 "Скачивание релиза ${LATEST}..." running
trap 'rm -rf "${TMP_DIR}"' EXIT

# Формат ассетов Telemt: telemt-<arch>-linux-gnu.tar.gz, тег без "v"
ASSET="telemt-${ARCH}-linux-gnu.tar.gz"
curl -fsSL --retry 3 -o "${TMP_DIR}/telemt.tar.gz" \
    "${TELEMT_REPO}/releases/download/${LATEST}/${ASSET}" \
    || fail "Не удалось скачать релиз ${LATEST}"

# Проверка SHA-256 (обязательна, если файл сумм опубликован)
set_status 3 5 "Проверка SHA-256..." running
if curl -fsSL -o "${TMP_DIR}/telemt.sha256" \
    "${TELEMT_REPO}/releases/download/${LATEST}/${ASSET}.sha256" 2>/dev/null; then
    EXPECTED="$(awk '{print $1}' "${TMP_DIR}/telemt.sha256")"
    ACTUAL="$(sha256sum "${TMP_DIR}/telemt.tar.gz" | awk '{print $1}')"
    [[ "${EXPECTED}" == "${ACTUAL}" ]] \
        || fail "Контрольная сумма не совпала! Обновление отменено."
    info "SHA-256 проверен"
fi

tar -xzf "${TMP_DIR}/telemt.tar.gz" -C "${TMP_DIR}"
NEW_BIN="$(find "${TMP_DIR}" -type f -name telemt | head -n1)"
[[ -n "${NEW_BIN}" ]] || fail "Бинарник не найден в архиве"

# ---------------------------------------------------------------------------
# Замена с бэкапом и проверкой
# ---------------------------------------------------------------------------
info "Останавливаю Telemt и обновляю бинарник..."
set_status 4 5 "Установка и рестарт Telemt..." running
cp -a "${CONFIG_DIR}/telemt.toml" "${CONFIG_DIR}/telemt.toml.bak"
cp -a "${BIN_PATH}" "${BIN_BACKUP}" 2>/dev/null || true
systemctl stop telemt
install -m 0755 "${NEW_BIN}" "${BIN_PATH}"
systemctl start telemt

# Проверка работоспособности через Control API
sleep 3
if curl -fsS "http://127.0.0.1:${TELEMT_API_PORT}/v1/health" \
    -H "Authorization: Bearer ${TELEMT_API_TOKEN}" >/dev/null 2>&1; then
    info "Telemt обновлён до v${LATEST} и работает"
    set_status 5 5 "Обновлено до v${LATEST}" success
else
    warn "Проверка не пройдена — откатываю на предыдущую версию..."
    set_status 5 5 "Проверка не пройдена — откат на v${CURRENT}" failed
    systemctl stop telemt || true
    mv "${BIN_BACKUP}" "${BIN_PATH}"
    cp -a "${CONFIG_DIR}/telemt.toml.bak" "${CONFIG_DIR}/telemt.toml"
    systemctl start telemt
    fail "Откат выполнен на v${CURRENT}"
fi
