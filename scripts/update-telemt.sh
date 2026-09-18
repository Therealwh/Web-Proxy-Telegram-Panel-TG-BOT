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
fail() { echo "[telemt-update] ОШИБКА: $*" >&2; exit 1; }

# ---------------------------------------------------------------------------
# Определяем текущую и последнюю версии
# ---------------------------------------------------------------------------
CURRENT="$(${BIN_PATH} --version 2>/dev/null | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -n1 || echo '0.0.0')"
LATEST="$(curl -fsSL "${TELEMT_API_URL}" | jq -r '.tag_name' | sed 's/^v//')"
[[ -n "${LATEST}" && "${LATEST}" != "null" ]] || fail "Не удалось получить последнюю версию с GitHub"

info "Текущая версия: ${CURRENT}, последняя: ${LATEST}"
if [[ "${CURRENT}" == "${LATEST}" ]]; then
    info "Уже установлена последняя версия. Обновление не требуется."
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
trap 'rm -rf "${TMP_DIR}"' EXIT

ASSET="telemt-${ARCH}-unknown-linux-gnu.tar.gz"
curl -fsSL --retry 3 -o "${TMP_DIR}/telemt.tar.gz" \
    "${TELEMT_REPO}/releases/download/v${LATEST}/${ASSET}" \
    || fail "Не удалось скачать релиз v${LATEST}"

# Проверка SHA-256 (обязательна, если файл сумм опубликован)
if curl -fsSL -o "${TMP_DIR}/SHA256SUMS" \
    "${TELEMT_REPO}/releases/download/v${LATEST}/SHA256SUMS" 2>/dev/null; then
    (cd "${TMP_DIR}" && grep "${ASSET}" SHA256SUMS | sha256sum -c -) \
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
else
    warn "Проверка не пройдена — откатываю на предыдущую версию..."
    systemctl stop telemt || true
    mv "${BIN_BACKUP}" "${BIN_PATH}"
    cp -a "${CONFIG_DIR}/telemt.toml.bak" "${CONFIG_DIR}/telemt.toml"
    systemctl start telemt
    fail "Откат выполнен на v${CURRENT}"
fi
