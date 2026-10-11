#!/usr/bin/env bash
# =============================================================================
# TGGATE — Резервный маршрут к Telegram DC через WARP
#
# Что делает: заворачивает ТОЛЬКО трафик к адресам Telegram DC в туннель
# Cloudflare WARP. Весь остальной трафик (панель, сайты, обновления) идёт
# напрямую и не зависит от Cloudflare.
#
# Зачем: если доступ с IP сервера к адресам Telegram закрывается, клиенты
# подключаются к прокси, но ничего не грузится — обрыв на участке
# «сервер → Telegram». Перезапуск движка не помогает: маршрут тот же.
# Через туннель оператор видит соединение с Cloudflare, а не с Telegram,
# и содержимое для него непрозрачно.
#
# По умолчанию выключено и включается только явной командой. Если что-то
# пойдёт не так — маршрут снимается тем же скриптом без перезагрузки.
#
# Использование: bash warp.sh status | enable | disable
# =============================================================================
set -euo pipefail

readonly RULE_PRIORITY=1100
readonly TABLE4="tggate_warp"
readonly TABLE6="tggate_warp6"

# Подсети Telegram DC (core.telegram.org)
readonly CIDRS4="149.154.160.0/20 149.154.167.48/20 149.154.175.0/24 91.108.4.0/22 91.108.8.0/22 91.108.12.0/22 91.108.20.0/22 91.108.56.0/22 95.161.64.0/20"
readonly CIDRS6="2001:b28:f23d:f001::/64 2001:b28:f23d:f003::/64 2001:b28:f23f:f001::/64 2001:67c:4e8:f002::/64 2001:67c:4e8:f004::/64 2001:67c:4e8:f006::/64"

log() { printf '[warp] %s\n' "$*"; }
die() { log "ОШИБКА: $*"; exit 1; }

# --- Определяем интерфейс туннеля ---------------------------------------------
# Имя интерфейса отличается между версиями клиента и способами подключения.
detect_iface() {
    local iface=""
    iface="$(ip -o link show 2>/dev/null | awk -F': ' '{print $2}' \
        | grep -Ei '^(warp|Cloudflare|WARP)' | head -n1 || true)"
    if [[ -z "${iface}" ]]; then
        die "интерфейс WARP не найден. Сначала подключите туннель: warp-cli connect"
    fi
    printf '%s' "${iface}"
}

cmd_status() {
    if ! command -v warp-cli >/dev/null 2>&1; then
        log "warp-cli не установлен — резервный маршрут недоступен"
        exit 0
    fi

    local raw connected="нет"
    raw="$(warp-cli status 2>&1 || true)"
    if printf '%s' "${raw}" | grep -qiE 'status update: connected'; then
        connected="да"
    fi

    local rules=0
    rules="$(ip rule show 2>/dev/null | grep -c "lookup ${TABLE4}" || true)"

    printf 'warp-cli: установлен\n'
    printf 'подключено: %s\n' "${connected}"
    printf 'правил маршрутизации: %s из %s\n' "${rules}" "$(wc -w <<< "${CIDRS4}")"
    printf 'туннель: %s\n' "$(detect_iface 2>/dev/null || echo 'не найден')"
}

cmd_enable() {
    command -v warp-cli >/dev/null 2>&1 || die "warp-cli не установлен"

    local raw
    raw="$(warp-cli status 2>&1 || true)"
    if ! printf '%s' "${raw}" | grep -qiE 'status update: connected'; then
        log "подключаю туннель..."
        warp-cli connect >/dev/null 2>&1 || die "не удалось подключить WARP"
        sleep 3
    fi

    local iface
    iface="$(detect_iface)"

    # Сначала маршрут по умолчанию, потом правила: если что-то упадёт,
    # лучше не будет ни одного правила, чем правило в пустую таблицу,
    # где трафик к Telegram просто пропадёт.
    ip route replace default dev "${iface}" table "${TABLE4}"
    log "таблица ${TABLE4}: маршрут через ${iface}"

    local added=0 failed=0 cidr
    for cidr in ${CIDRS4}; do
        # delete перед add: правило могло остаться с прошлого раза
        ip rule del priority "${RULE_PRIORITY}" to "${cidr}" lookup "${TABLE4}" 2>/dev/null || true
        if ip rule add priority "${RULE_PRIORITY}" to "${cidr}" lookup "${TABLE4}" 2>/dev/null; then
            added=$((added + 1))
        else
            failed=$((failed + 1))
            log "  не удалось добавить правило для ${cidr}"
        fi
    done

    if (( added == 0 )); then
        die "не добавлено ни одного правила — маршрут не включён"
    fi
    log "добавлено правил IPv4: ${added}, с ошибкой: ${failed}"

    # IPv6: необязательно, отсутствие поддержки не должно ломать включение
    local added6=0
    if ip -6 route replace default dev "${iface}" table "${TABLE6}" 2>/dev/null; then
        for cidr in ${CIDRS6}; do
            ip -6 rule del priority "${RULE_PRIORITY}" to "${cidr}" lookup "${TABLE6}" 2>/dev/null || true
            if ip -6 rule add priority "${RULE_PRIORITY}" to "${cidr}" lookup "${TABLE6}" 2>/dev/null; then
                added6=$((added6 + 1))
            fi
        done
        log "добавлено правил IPv6: ${added6}"
    else
        log "IPv6 через туннель не настроен — это не критично"
    fi

    log "резервный маршрут включён. Проверка:"
    cmd_status
}

cmd_disable() {
    local removed=0 cidr
    for cidr in ${CIDRS4}; do
        # По одной: часть правил может отсутствовать, и падение на первом
        # delete не должно оставить маршрут включённым наполовину.
        if ip rule del priority "${RULE_PRIORITY}" to "${cidr}" lookup "${TABLE4}" 2>/dev/null; then
            removed=$((removed + 1))
        fi
    done
    for cidr in ${CIDRS6}; do
        ip -6 rule del priority "${RULE_PRIORITY}" to "${cidr}" lookup "${TABLE6}" 2>/dev/null || true
    done
    ip route flush table "${TABLE4}" 2>/dev/null || true
    ip -6 route flush table "${TABLE6}" 2>/dev/null || true

    log "снято правил: ${removed}"

    if command -v warp-cli >/dev/null 2>&1; then
        warp-cli disconnect >/dev/null 2>&1 || true
    fi
    log "резервный маршрут выключен, трафик идёт напрямую"
}

case "${1:-status}" in
    status) cmd_status ;;
    enable) cmd_enable ;;
    disable) cmd_disable ;;
    *)
        die "использование: bash warp.sh status|enable|disable"
        ;;
esac