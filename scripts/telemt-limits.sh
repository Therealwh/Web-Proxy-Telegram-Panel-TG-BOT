#!/usr/bin/env bash
# =============================================================================
# TGGATE — Лимиты ресурсов для Telemt (память и CPU)
#
# Зачем: один неадекватный клиент способен разъесть память движка, и без
# потолка OOM- killer выбирает жертвой наугад — панель, nginx или caddy.
# MemoryMax ограничивает именно процессы telemt: при достижении предела
# systemd убивает ТОЛЬКО их, и панель остаётся доступной для диагностики.
#
# Почему drop-in, а не правка telemt.service: обновление движка перезаписывает
# юнит, а drop-in переживает обновления и работает на уже установленных серверах.
#
# Лимиты считаются от фактической памяти сервера, поэтому одинаково подходят
# и к 2 ГБ VPS, и к более крупным машинам.
# =============================================================================
set -euo pipefail

readonly DROPIN_DIR="/etc/systemd/system/telemt.service.d"
readonly DROPIN_FILE="${DROPIN_DIR}/limits.conf"

log() { printf '[telemt-limits] %s\n' "$*"; }

# --- Сколько памяти можно отдать движку ---------------------------------------
# Системе оставляем ~25% (ядро, caddy, nginx, панель, ssh). Остальное — движку.
# Минимум 256 МБ, максимум 8 ГБ: на очень больших машинах разумно не душить
# движок искусственно, отдав ему не более 8 ГБ.
detect_memory_bytes() {
    local kb
    kb="$(awk '/^MemTotal:/ {print $2; exit}' /proc/meminfo)"
    if [[ -z "${kb}" ]]; then
        log "не удалось определить память, беру 1 ГБ"
        kb=$((1024 * 1024))
    fi
    local avail=$((kb * 75 / 100))
    # Важно: при set -e конструкция "(( условие )) && действие" завершает скрипт,
    # когда условие ложно, поэтому здесь только явные if.
    if (( avail < 256 * 1024 )); then avail=$((256 * 1024)); fi
    if (( avail > 8 * 1024 * 1024 )); then avail=$((8 * 1024 * 1024)); fi
    printf '%s' "$((avail * 1024))"
}

# --- Сколько CPU можно дать ---------------------------------------------------
# Проценты от одного ядра: 200% = два ядра целиком. Считаем от числа ядер,
# но не даём больше 400%: выше начинается бесполезное переизбыточность.
detect_cpu_quota() {
    local cores
    cores="$(nproc 2>/dev/null || echo 1)"
    if [[ -z "${cores}" ]] || (( cores < 1 )); then cores=1; fi
    local quota=$((cores * 100))
    if (( quota > 400 )); then quota=400; fi
    printf '%s' "$quota"
}

MEM_BYTES="$(detect_memory_bytes)"
MEM_HIGH="$(($MEM_BYTES * 80 / 100))"   # мягкий порог: начинаем сжимать кучи
MEM_SWAP="$(($MEM_BYTES / 8))"           # позволяет выйти из лимита под swap
CPU_QUOTA="$(detect_cpu_quota)"
CORES="$(nproc 2>/dev/null || echo 1)"

install -d -m 0755 "${DROPIN_DIR}"

cat > "${DROPIN_FILE}" <<EOF
# Создано TGGATE: $(date -Is)
# Лимиты ресурсов движка Telemt. Правьте MemoryMax/CPUQuotaPerSecUSec
# под свою нагрузку; после изменения: systemctl daemon-reload && systemctl restart telemt
[Service]
# Жёсткий предел памяти. Достигнут — systemd перезапустит ТОЛЬКО telemt.
MemoryMax=${MEM_BYTES}
# Мягкий предел: раньше MemoryMax включает reclaim, обычно успевает без OOM.
MemoryHigh=${MEM_HIGH}
# Сколько памяти разрешено забрать под swap, чтобы не упасть мгновенно.
MemorySwapMax=${MEM_SWAP}
# Потолок CPU в процентах от одного ядра (200% = два ядра).
# ВАЖНО: CPUQuotaPerSecUSec задавать нельзя — systemd считает его взаимоисключающим
# с CPUQuota, и при обоих сервис не стартует вовсе.
CPUQuota=${CPU_QUOTA}%
EOF

log "RAM сервера: $(( $(awk '/^MemTotal:/ {print $2}' /proc/meminfo) / 1024 )) МБ, ядер: ${CORES}"
log "Записано: MemoryMax=$((MEM_BYTES / 1024 / 1024)) МБ, MemoryHigh=$((MEM_HIGH / 1024 / 1024)) МБ, CPUQuota=${CPU_QUOTA}%"

systemctl daemon-reload
# Перезапуск двигателя короткий: клиенты переподключатся сами.
systemctl restart telemt

sleep 2
if systemctl is-active --quiet telemt; then
    log "telemt запущен с лимитами"
else
    log "ОШИБКА: telemt не стартовал после применения лимитов"
    log "Откатываем: systemctl stop telemt && rm -f ${DROPIN_FILE} && systemctl daemon-reload && systemctl restart telemt"
    systemctl stop telemt || true
    rm -f "${DROPIN_FILE}"
    systemctl daemon-reload
    systemctl restart telemt
    exit 1
fi

# Показываем, что systemd действительно применил лимиты
log "Фактически применено systemd:"
systemctl show telemt -p MemoryMax -p MemoryHigh -p CPUQuotaPerSecUSec -p MemoryCurrent 2>/dev/null | sed 's/^/[telemt-limits]   /' || true