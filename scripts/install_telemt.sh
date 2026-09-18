#!/usr/bin/env bash
#
# =============================================================================
# TGGATE — Установка и настройка Telemt (MTProto + Web Proxy)
#
# Что делает скрипт:
#   1. Определяет архитектуру CPU (x86_64 / aarch64)
#   2. Скачивает бинарник Telemt из официальных релизов GitHub
#   3. Проверяет контрольную сумму SHA-256
#   4. Устанавливает в /usr/local/bin/telemt
#   5. Создаёт служебного пользователя telemt
#   6. Генерирует /etc/tggate/telemt.toml из шаблона
# =============================================================================

set -euo pipefail

source /etc/tggate/install.env

# Версия Telemt по умолчанию (можно переопределить переменной окружения)
TELEMT_VERSION="${TELEMT_VERSION:-3.5.7}"
readonly TELEMT_REPO="https://github.com/telemt/telemt"
readonly BIN_PATH="/usr/local/bin/telemt"
readonly CONFIG_PATH="/etc/tggate/telemt.toml"
readonly TLSFRONT_DIR="/var/lib/telemt/tlsfront"

echo "[Telemt] Установка версии ${TELEMT_VERSION}..."

# ---------------------------------------------------------------------------
# 1. Определяем архитектуру
# ---------------------------------------------------------------------------
ARCH="$(uname -m)"
case "${ARCH}" in
    x86_64)  TELEMT_ARCH="x86_64" ;;
    aarch64) TELEMT_ARCH="aarch64" ;;
    *)       echo "[Telemt] Неподдерживаемая архитектура: ${ARCH}" >&2; exit 1 ;;
esac
echo "[Telemt] Архитектура: ${TELEMT_ARCH}"

# ---------------------------------------------------------------------------
# 2. Скачиваем бинарник из официальных релизов
# ---------------------------------------------------------------------------
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "${TMP_DIR}"' EXIT

ASSET_NAME="telemt-${TELEMT_ARCH}-unknown-linux-gnu.tar.gz"
DOWNLOAD_URL="${TELEMT_REPO}/releases/download/v${TELEMT_VERSION}/${ASSET_NAME}"

echo "[Telemt] Скачивание: ${DOWNLOAD_URL}"
if ! curl -fsSL --retry 3 -o "${TMP_DIR}/telemt.tar.gz" "${DOWNLOAD_URL}"; then
    echo "[Telemt] Не удалось скачать релиз v${TELEMT_VERSION}." >&2
    echo "[Telemt] Проверьте доступные релизы: ${TELEMT_REPO}/releases" >&2
    exit 1
fi

# Контрольная сумма релиза (если опубликована — проверяем обязательно)
SUMS_URL="${TELEMT_REPO}/releases/download/v${TELEMT_VERSION}/SHA256SUMS"
if curl -fsSL --retry 3 -o "${TMP_DIR}/SHA256SUMS" "${SUMS_URL}" 2>/dev/null; then
    echo "[Telemt] Проверка SHA-256..."
    (cd "${TMP_DIR}" && grep "${ASSET_NAME}" SHA256SUMS | sha256sum -c -) \
        || { echo "[Telemt] Контрольная сумма не совпала! Прерываю установку." >&2; exit 1; }
    echo "[Telemt] Контрольная сумма OK"
else
    echo "[Telemt] Файл контрольных сумм не найден в релизе — продолжаю без проверки"
fi

# ---------------------------------------------------------------------------
# 3. Устанавливаем бинарник
# ---------------------------------------------------------------------------
tar -xzf "${TMP_DIR}/telemt.tar.gz" -C "${TMP_DIR}"
# Бинарник может лежать в корне архива или в подкаталоге
TELEMT_BIN="$(find "${TMP_DIR}" -type f -name telemt | head -n1)"
[[ -n "${TELEMT_BIN}" ]] || { echo "[Telemt] Бинарник не найден в архиве" >&2; exit 1; }

install -m 0755 "${TELEMT_BIN}" "${BIN_PATH}"
echo "[Telemt] Установлен: ${BIN_PATH} ($(${BIN_PATH} --version 2>/dev/null || echo 'версия не определена'))"

# ---------------------------------------------------------------------------
# 4. Служебный пользователь (безопасность: не запускаем от root)
# ---------------------------------------------------------------------------
if ! id -u telemt >/dev/null 2>&1; then
    useradd --system --home /var/lib/telemt --shell /usr/sbin/nologin telemt
fi
mkdir -p "${TLSFRONT_DIR}" /var/lib/telemt
chown -R telemt:telemt /var/lib/telemt

# ---------------------------------------------------------------------------
# 5. Генерируем конфигурацию из шаблона
# ---------------------------------------------------------------------------
# TELEMT_API_TOKEN задан в install.env через окружение installer'а
: "${TELEMT_API_TOKEN:?Требуется TELEMT_API_TOKEN (генерируется в install.sh)}"

sed -e "s|{{DOMAIN}}|${DOMAIN}|g" \
    -e "s|{{SERVER_IP}}|${SERVER_IP}|g" \
    -e "s|{{MTPROTO_PORT}}|${MTPROTO_PORT}|g" \
    -e "s|{{TELEMT_WEB_PORT}}|${TELEMT_WEB_PORT}|g" \
    -e "s|{{TELEMT_API_PORT}}|${TELEMT_API_PORT}|g" \
    -e "s|{{TELEMT_API_TOKEN}}|${TELEMT_API_TOKEN}|g" \
    -e "s|{{MASK_DOMAIN}}|${MASK_DOMAIN}|g" \
    -e "s|{{WEBSITE_DIR}}|${DATA_DIR}/website|g" \
    -e "s|{{TLSFRONT_DIR}}|${TLSFRONT_DIR}|g" \
    "${INSTALL_DIR}/templates/telemt.toml.tmpl" > "${CONFIG_PATH}"

chmod 640 "${CONFIG_PATH}"
chown root:telemt "${CONFIG_PATH}"

echo "[Telemt] Конфигурация: ${CONFIG_PATH}"
echo "[Telemt] Установка завершена"
