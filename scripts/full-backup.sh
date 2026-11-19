#!/usr/bin/env bash
# =============================================================================
# TGGATE — Полный бэкап всех файлов панели (запускается root-хелпером)
#
# Собирает в один архив: базу, /etc/tggate (секреты движка), код панели
# и обложки (без node_modules/.git/tests), .env, сайт-заглушку, systemd-юниты,
# конфиги nginx/Caddy. Снапшот БД через sqlite3 .backup (надёжно при живой
# записи), верификация архива и базы внутри, пометка верификацией,
# ротация (храним FULL_KEEP верифицированных пары «архив + манифест»).
#
# Архивы: 0640 root:tggate (секреты внутри!), каталог 750.
# stdout: JSON {ok, file, size, verified, removed:[...]} — читает панель.
# =============================================================================
set -uo pipefail
umask 077

BACKUP_DIR="/var/backups/tggate/full"
FULL_KEEP="${FULL_KEEP:-2}"          # сколько верифицированных бэкапов хранить
STAMP="$(date +%Y-%m-%d-%H%M%S)-$(date +%s%N | tail -c 7)"
FILE="${BACKUP_DIR}/full-${STAMP}.tar.gz"
DB_SRC="/var/lib/tggate/tggate.db"
LOCK="/var/backups/tggate/full/.lock"
LOG_ERR="/var/log/tggate/full-backup-last.err"

mkdir -p "${BACKUP_DIR}"
chown root:tggate "${BACKUP_DIR}" 2>/dev/null || true
chmod 750 "${BACKUP_DIR}" 2>/dev/null || true

# --- Мьютекс: двойной запуск исключён (flock на время работы) ---------------
exec 9>"${LOCK}"
if ! flock -n 9; then
    echo '{"ok":false,"error":"another full-backup is running"}'
    exit 1
fi

# --- Осиротевшие tar (убитые по таймауту запуски) старше 30 минут — удалить --
NOW=$(date +%s)
for f in "${BACKUP_DIR}"/full-*.tar.gz; do
    [ -f "${f}" ] || continue
    [ -f "${f}.json" ] && continue                       # без манифеста = мусор
    mtime=$(stat -c%Y "${f}" 2>/dev/null || echo 0)
    [ $((NOW - mtime)) -gt 1800 ] && rm -f "${f}"
done

# --- Контентный список: только существующие пути ---------------------------
LIST="$(mktemp)"
ARGS="$(mktemp)"
cat > "${LIST}" <<'PATHS'
opt/tggate/panel/backend/.env
opt/tggate/panel/backend/assets
opt/tggate/panel/backend/config.js
opt/tggate/panel/backend/db.js
opt/tggate/panel/backend/server.js
opt/tggate/panel/backend/middleware
opt/tggate/panel/backend/migrations
opt/tggate/panel/backend/package.json
opt/tggate/panel/backend/package-lock.json
opt/tggate/panel/backend/public-api
opt/tggate/panel/backend/routes
opt/tggate/panel/backend/services
opt/tggate/panel/backend/utils
opt/tggate/panel/frontend/dist
opt/tggate/panel/frontend/package.json
opt/tggate/panel/frontend/package-lock.json
opt/tggate/scripts
opt/tggate/templates
opt/tggate/systemd
opt/tggate/VERSION
opt/tggate/tggate.sh
etc/tggate
etc/systemd/system/tggate-panel.service
etc/systemd/system/telemt.service
etc/systemd/system/tggate-helper.service
etc/systemd/system/tggate-helper.service.d
etc/cron.d/tggate-updates
etc/nginx/tggate-telemt-proxy.inc
etc/nginx/conf.d/tggate-map.conf
etc/nginx/sites-available/tggate.conf
etc/caddy/Caddyfile
usr/local/bin/tggate-cleanup.sh
usr/local/bin/tggate-check-updates
usr/local/bin/tggate-update-panel
usr/local/bin/tggate-update-telemt
var/lib/tggate/website
var/lib/tggate/update-status.json
var/lib/telemt/tlsfront
PATHS

# tar падает, если хотя бы один путь из списка не существует (например,
# Caddyfile до первой установки Caddy) — поэтому в args идут только живые
while IFS= read -r p; do
    [ -e "/${p}" ] && printf '%s\n' "${p}" >> "${ARGS}"
done < "${LIST}"

# ВАЖНО: никаких wal_checkpoint(TRUNCATE) из этого скрипта! Кросс-процессный
# TRUNCATE-чекпоинт гоняется с записями панели — механизм порчи БД
# (инциденты 14.11/18.11/19.11). Снапшот .backup корректен и без чекпоинта.

# --- Снапшот БД через sqlite3 .backup: корректен при живой записи -----------
SNAP_DIR="$(mktemp -d)"
DB_SNAP="${SNAP_DIR}/tggate.db"
SNAP_OK=0
for attempt in 1 2 3; do
    if sqlite3 "${DB_SRC}" ".timeout 10000" ".backup '${DB_SNAP}'" 2>/dev/null && [ -s "${DB_SNAP}" ]; then
        SNAP_OK=1
        break
    fi
    sleep 3
done
rm -f "${DB_SNAP}-wal" "${DB_SNAP}-shm" 2>/dev/null || true
if [ "${SNAP_OK}" = "0" ]; then
    rm -rf "${SNAP_DIR}" "${LIST}" "${ARGS}"
    echo '{"ok":false,"error":"db snapshot failed"}'
    exit 1
fi
# Структура для tar: путь в архиве = var/lib/tggate/tggate.db
mkdir -p "${SNAP_DIR}/var/lib/tggate"
mv "${DB_SNAP}" "${SNAP_DIR}/var/lib/tggate/tggate.db"

# --- Сборка архива ----------------------------------------------------------
cd / || exit 1
if ! tar czf "${FILE}" \
        --exclude='opt/tggate/panel/backend/node_modules' \
        --exclude='opt/tggate/panel/frontend/node_modules' \
        --exclude='opt/tggate/.git' \
        --exclude='opt/tggate/docs' \
        --exclude='opt/tggate/.npm' \
        --exclude='opt/tggate/panel/backend/logs' \
        --exclude='opt/tggate/panel/backend/data' \
        --exclude='opt/tggate/panel/backend/backups' \
        --exclude='opt/tggate/panel/backend/tests' \
        -C "${SNAP_DIR}" var/lib/tggate/tggate.db \
        -C / -T "${ARGS}" 2>"${LOG_ERR}"; then
    rm -rf "${SNAP_DIR}" "${FILE}" "${FILE}.json" "${LIST}" "${ARGS}"
    echo '{"ok":false,"error":"tar failed"}'
    exit 1
fi
rm -rf "${SNAP_DIR}" "${LIST}" "${ARGS}"

SIZE=$(stat -c%s "${FILE}" 2>/dev/null || echo 0)

# --- Верификация: архив читается + база внутри целая ------------------------
VERIFY_DIR="$(mktemp -d)"
VERIFIED=0
DB_SHA="null"
if gzip -t "${FILE}" 2>/dev/null; then
    tar xzf "${FILE}" -C "${VERIFY_DIR}" var/lib/tggate/tggate.db 2>/dev/null || true
    if [ -f "${VERIFY_DIR}/var/lib/tggate/tggate.db" ]; then
        IC="$(sqlite3 "${VERIFY_DIR}/var/lib/tggate/tggate.db" 'PRAGMA integrity_check;' 2>/dev/null | head -1)"
        if [ "${IC}" = "ok" ]; then
            VERIFIED=1
            DB_SHA="$(sha256sum "${VERIFY_DIR}/var/lib/tggate/tggate.db" 2>/dev/null | cut -d' ' -f1)"
        fi
    fi
fi
rm -rf "${VERIFY_DIR}"

# --- Ротация: храним FULL_KEEP ПАР «архив + манифест» -----------------------
# Мусор без манифеста (осиротевшие tar) старше 30 минут уже удалён выше;
# при ротации считаем только верифицированные пары, чтобы убитые по
# таймауту запуски не вытесняли хорошие бэкапы.
REMOVED="[]"
if [ "${VERIFIED}" = "1" ]; then
    DOMAIN_OLD="$(grep '^DOMAIN=' /etc/tggate/install.env 2>/dev/null | cut -d'"' -f2)"
    SERVER_IP_OLD="$(grep '^SERVER_IP=' /etc/tggate/install.env 2>/dev/null | cut -d'"' -f2)"
    cat > "${FILE}.json" <<EOF
{"date":"$(date -u +%Y-%m-%dT%H:%M:%SZ)","size":${SIZE},"verified":true,"db_sha256":"${DB_SHA}","domain":"${DOMAIN_OLD}","server_ip":"${SERVER_IP_OLD}"}
EOF
    chown root:tggate "${FILE}" "${FILE}.json" 2>/dev/null || true
    chmod 640 "${FILE}" "${FILE}.json" 2>/dev/null || true

    OLD_LIST="$(mktemp)"
    ls -t "${BACKUP_DIR}"/full-*.tar.gz 2>/dev/null | while IFS= read -r f; do
        [ -f "${f}.json" ] && echo "${f}"
    done | tail -n +$((FULL_KEEP + 1)) > "${OLD_LIST}" || true
    REMOVED_LIST="$(mktemp)"
    printf '[' > "${REMOVED_LIST}"
    FIRST=1
    while IFS= read -r old; do
        [ -f "${old}" ] || continue
        rm -f "${old}" "${old}.json"
        if [ "${FIRST}" = "0" ]; then printf ',' >> "${REMOVED_LIST}"; fi
        FIRST=0
        printf '"%s"' "$(basename "${old}")" >> "${REMOVED_LIST}"
    done < "${OLD_LIST}"
    printf ']' >> "${REMOVED_LIST}"
    REMOVED="$(cat "${REMOVED_LIST}")"
    rm -f "${OLD_LIST}" "${REMOVED_LIST}"
else
    # Битый архив не держим: он бесполезен и место занимает
    rm -f "${FILE}" "${FILE}.json"
    echo '{"ok":false,"error":"verification failed","removed":[]}'
    exit 1
fi

echo "{\"ok\":true,\"file\":\"$(basename "${FILE}")\",\"size\":${SIZE},\"verified\":true,\"db_sha256\":\"${DB_SHA}\",\"removed\":${REMOVED}}"
