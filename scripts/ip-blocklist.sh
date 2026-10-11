#!/usr/bin/env bash
# =============================================================================
# TGGATE — Блокировка IP и подсетей
#
# Список приходит от панели файлом /etc/tggate/blocklist.txt и применяется
# двумя разными механизмами:
#
#   1) порт MTProto — наборы nftables. Пакеты отсекаются ДО попадания в движок,
#      что экономит память и не тратит сессии на заведомо заблокированных.
#   2) веб-прокси — директивы `deny` в Nginx. Панель и SSH сюда не попадают:
#      у панели собственный location, поэтому заблокированный IP не теряет
#      доступ к админке.
#
# Почему так, а не одним правилом на весь 443: администратор блокирует
# злоумышленника, а не себя. Общее правило на 443 отрезало бы и панель.
# =============================================================================
set -euo pipefail

readonly BLOCKLIST_FILE="${DATA_DIR:-/var/lib/tggate}/blocklist.txt"
readonly NGINX_INC="/etc/nginx/tggate-blocklist.inc"
readonly NFT_TABLE="tggate_blocklist"
readonly MTPROTO_PORT="${MTPROTO_PORT:-8443}"

log() { printf '[ip-blocklist] %s\n' "$*"; }

[[ -f "${BLOCKLIST_FILE}" ]] || { log "Файла списка нет: ${BLOCKLIST_FILE}"; exit 1; }

# Читаем список: по строке на правило, # в начале — комментарий, пустые пропускаем
mapfile -t RULES < <(grep -vE '^\s*(#|$)' "${BLOCKLIST_FILE}" || true)
log "Правил в списке: ${#RULES[@]}"

# --- 1. Веб-прокси: директивы deny для Nginx -------------------------------
# Пишем во временный файл и подменяем только после успеха: сломанный include
# не даст Nginx перезагрузиться и уронит всю выдачу сайта.
TMP_INC="$(mktemp)"
trap 'rm -f "${TMP_INC}"' EXIT

if [[ -f "${NGINX_INC}" ]]; then
    cat "${NGINX_INC}" > "${TMP_INC}"
else
    printf '# Блокировка IP и подсетей (создаётся TGGATE). Правьте только через панель.\n' > "${TMP_INC}"
fi

# Удаляем прежние правила, оставляя шапку
sed -i '/^deny /d' "${TMP_INC}"

for cidr in "${RULES[@]}"; do
    printf 'deny %s;\n' "${cidr}" >> "${TMP_INC}"
done

install -m 0644 "${TMP_INC}" "${NGINX_INC}"

# В include нельзя положить `deny` вне контекста, проверяем до перезагрузки
if ! nginx -t -q 2>/dev/null; then
    log "ОШИБКА: Nginx не принимает конфигурацию — возвращаю прежний include"
    log "nginx -t вывод:"
    nginx -t 2>&1 | sed 's/^/[ip-blocklist]   /' || true
    exit 1
fi
systemctl reload nginx || { log "ОШИБКА: не удалось перезагрузить Nginx"; exit 1; }
log "Правила Nginx применены"

# --- 2. MTProto: наборы nftables --------------------------------------------
# nft умеет работать и без iptables-совместимости, отдельная таблица не
# задевает правила файрвола, установленные при установке панели.
NFT_OK=false
if command -v nft >/dev/null 2>&1; then
    NFT_OK=true
else
    log "nft не найден — правило для порта MTProto применено не будет"
fi

if [[ "${NFT_OK}" == true ]]; then
    TMP_NFT="$(mktemp)"
    {
        printf 'table inet %s\n' "${NFT_TABLE}"
        printf 'delete table inet %s\n' "${NFT_TABLE}"
        printf 'table inet %s\n' "${NFT_TABLE}"
        printf '  set ipv4_blocked {\n    type ipv4_addr\n    flags interval\n'
        for cidr in "${RULES[@]}"; do
            # IPv6 уходит в свой набор; проверка через if, а не "&& continue":
            # при set -e ложное условие в теле цикла завершило бы скрипт.
            if [[ "${cidr}" != *:* ]]; then
                printf '    elements = { %s }\n' "${cidr}"
            fi
        done
        printf '  }\n'
        printf '  set ipv6_blocked {\n    type ipv6_addr\n    flags interval\n'
        for cidr in "${RULES[@]}"; do
            if [[ "${cidr}" == *:* ]]; then
                printf '    elements = { %s }\n' "${cidr}"
            fi
        done
        printf '  }\n'
        printf '}\n'
    } > "${TMP_NFT}"

    if nft -f "${TMP_NFT}" 2>/dev/null; then
        log "Наборы nftables обновлены"
    else
        log "ОШИБКА: nft отверг наборы — проверьте формат подсетей"
        rm -f "${TMP_NFT}"
        exit 1
    fi
    rm -f "${TMP_NFT}"

    # Правило цепочкой: inet -> тable inet tggate_blocklist.
    # Добавляем в table inet tggate (создаётся скриптом установки), если есть.
    if nft list table inet tggate >/dev/null 2>&1; then
        nft add rule inet tggate input ip saddr @ipv4_blocked tcp dport "${MTPROTO_PORT}" drop 2>/dev/null || true
        nft add rule inet tggate input ip6 saddr @ipv6_blocked tcp dport "${MTPROTO_PORT}" drop 2>/dev/null || true
        log "Правила отсечения на порту ${MTPROTO_PORT} добавлены"
    else
        log "Таблицы inet tggate нет — правило порта не добавлено (проверьте iptables)"
    fi
fi

log "Готово. Панель и SSH блокировкой не затрагиваются."
exit 0