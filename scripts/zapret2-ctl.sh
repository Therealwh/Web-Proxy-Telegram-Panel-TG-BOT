#!/usr/bin/env bash
#
# =============================================================================
# TGGATE — управление zapret2 (nfqws2): обход DPI-блокировок MTProto.
# Устанавливается ОПЦИОНАЛЬНО из панели (вкладка «Обход DPI»), только на
# конкретный сервер. Действия: install | remove | start | stop | restart
#
# Безопасность:
#   - nft-правила только на MTPROTO_PORT, с флагом bypass (fail-open)
#   - снятие полностью убирает правила, файлы и sysctl
# Запуск: ТОЛЬКО через root-хелпер (scripts/helper.js, ключ zapret2)
# =============================================================================

set -euo pipefail

[[ "${EUID}" -eq 0 ]] || { echo "Запустите от root" >&2; exit 1; }
[[ -f /etc/tggate/install.env ]] || { echo "TGGATE не установлен" >&2; exit 1; }
# shellcheck source=/dev/null
source /etc/tggate/install.env

readonly ACTION="${1:-}"
readonly INSTALL_DIR="/opt/tggate"
readonly DIR="/opt/tggate-zapret2"
readonly CONF_DIR="/etc/tggate-zapret2"
readonly START_SCRIPT="/usr/local/sbin/tggate-zapret2-start.sh"
readonly UNIT="/etc/systemd/system/tggate-zapret2.service"
readonly TABLE="TGGATE"
readonly ZAPRET2_VERSION="v1.0.3"
readonly REPO_URL="https://github.com/bol-van/zapret2/releases/download/${ZAPRET2_VERSION}"

log() { echo "[zapret2] $*"; }
fail() { echo "[zapret2] ОШИБКА: $*" >&2; exit 1; }

# ---------------------------------------------------------------------------
# Удаление: сервис, правила, файлы, sysctl — всё обратимо
# ---------------------------------------------------------------------------
do_remove() {
    systemctl disable --now tggate-zapret2.service 2>/dev/null || true
    nft delete table ip "${TABLE}" 2>/dev/null || true
    rm -f "${UNIT}" "${START_SCRIPT}"
    # Восстанавливаем sysctl до установки
    if [[ -f "${DIR}/prev-sysctl.env" ]]; then
        declare -A PREV_SYSCTL=()
        # shellcheck source=/dev/null
        source "${DIR}/prev-sysctl.env"
        for k in "${!PREV_SYSCTL[@]}"; do
            sysctl -w "${k}=${PREV_SYSCTL[$k]}" >/dev/null 2>&1 || true
        done
    fi
    rm -f /etc/sysctl.d/99-tggate-zapret2.conf /etc/sysctl.d/99-tggate-wscale.conf
    rm -rf "${DIR}" "${CONF_DIR}"
    systemctl daemon-reload
    log "Удалено полностью. sysctl восстановлены."
}

# ---------------------------------------------------------------------------
# Установка: бинарь + lua + конфиг + nft + systemd
# ---------------------------------------------------------------------------
do_install() {
    [[ -n "${MTPROTO_PORT:-}" ]] || fail "MTPROTO_PORT не задан в install.env"

    # Зависимости ядра и пакетов
    modprobe nfnetlink_queue 2>/dev/null || fail "модуль nfnetlink_queue недоступен (нужен хост, не LXC без модулей ядра)"
    command -v nft >/dev/null 2>&1 || apt-get install -y -qq nftables || fail "не удалось поставить nftables"

    mkdir -p "${DIR}/bin" "${DIR}/lua" "${CONF_DIR}"

    # Скачиваем релиз zapret2 (nfqws2 + lua-библиотеки)
    local tmp arch asset
    tmp="$(mktemp -d)"
    case "$(uname -m)" in
        x86_64)  arch="linux-x86_64" ;;
        aarch64) arch="linux-arm64" ;;
        *) fail "архитектура $(uname -m) не поддерживается" ;;
    esac
    asset="zapret2-${ZAPRET2_VERSION}.tar.gz"
    log "Скачиваю ${asset} (${arch})..."
    curl -fsSL -o "${tmp}/${asset}" "${REPO_URL}/${asset}"
    # sha256 — если опубликован, проверяем (best effort)
    if curl -fsSL -o "${tmp}/${asset}.sha256" "${REPO_URL}/${asset}.sha256" 2>/dev/null; then
        (cd "${tmp}" && sha256sum -c "${asset}.sha256") || { rm -rf "${tmp}"; fail "sha256 не совпал"; }
    fi
    tar -xzf "${tmp}/${asset}" -C "${tmp}"
    local root
    root="$(find "${tmp}" -maxdepth 1 -mindepth 1 -type d | head -n1)"
    cp -f "${root}/binaries/${arch}/nfqws2" "${DIR}/bin/nfqws2"
    chmod +x "${DIR}/bin/nfqws2"
    local lua
    lua="$(for d in "${root}/nfq2/lua" "${root}/lua" "${root}/nfq/lua"; do
            ls "$d"/zapret-lib.lua* >/dev/null 2>&1 && echo "$d" && break; done)"
    [[ -n "${lua}" ]] || { rm -rf "${tmp}"; fail "lua-библиотеки не найдены в архиве"; }
    cp -f "${lua}"/zapret-lib.lua* "${lua}"/zapret-antidpi.lua* "${DIR}/lua/"
    rm -rf "${tmp}"
    "${DIR}/bin/nfqws2" --version || true

    # Конфиг nfqws2. Параметры (400/1400/10) подобраны zapret2 — не менять.
    cat > "${CONF_DIR}/mtproto.conf" <<CONF
--qnum 200
--fwmark=0x40000000
--server

--lua-init=@${DIR}/lua/zapret-lib.lua
--lua-init=@${DIR}/lua/zapret-antidpi.lua
--lua-init=@${DIR}/lua/mtproto.lua
--filter-tcp=${MTPROTO_PORT}
--out-range=a
--in-range=a
--payload-disable=all
--lua-desync=lets_resend
--new
CONF

    # Lua-скрипт обхода (iOS-fingerprint bypass + window clamp + disorder/badsum)
    cat > "${DIR}/lua/mtproto.lua" <<'LUA'
-- Zapret2 MTProto fix
-- Серверный обход: disorder + badsum + window control + iOS fwmark bypass

function lets_resend(ctx, desync)
    -- iOS fingerprint bypass: пропускаем через fwmark без обработки
    if bitand(desync.dis.tcp.th_flags, TH_SYN + TH_ACK) == TH_SYN then
        if desync.dis.tcp.th_win == 65535 and
           #desync.dis.tcp.options == 8 and
           desync.dis.tcp.options[1].kind == 2 and
           desync.dis.tcp.options[2].kind == 1 and
           desync.dis.tcp.options[3].kind == 3 and
           desync.dis.tcp.options[4].kind == 1 and
           desync.dis.tcp.options[5].kind == 1 and
           desync.dis.tcp.options[6].kind == 8 and
           desync.dis.tcp.options[7].kind == 4 and
           desync.dis.tcp.options[8].kind == 0 then
            instance_cutoff(ctx, nil)
            desync.arg.fwmark = 0x40000
            rawsend_dissect_segmented(desync)
            return VERDICT_DROP
        end
    end

    -- SYN+ACK: запоминаем ack и зажимаем окно
    if bitand(desync.dis.tcp.th_flags, TH_SYN + TH_ACK) == (TH_SYN + TH_ACK) then
        desync.track.lua_state["ack0"] = desync.dis.tcp.th_ack
        desync.dis.tcp.th_win = 1400
        return VERDICT_MODIFY
    end

    -- Пустые ACK: зажимаем окно, отпускаем после первого payload
    if direction_check(desync) and bitand(desync.dis.tcp.th_flags, TH_SYN + TH_ACK) == (TH_ACK) then
        local ack0 = desync.track and desync.track.lua_state["ack0"]
        if ack0 and (desync.dis.tcp.th_ack - ack0 >= 1400) then
            instance_cutoff(ctx, true)
            desync.arg.fwmark = 0x40000
            rawsend_dissect_segmented(desync)
            return VERDICT_DROP
        end
        desync.dis.tcp.th_win = 10
        return VERDICT_MODIFY
    end

    -- Только первый data-пакет клиента
    if #desync.dis.payload == 0 or desync.track == nil or desync.track.pos.client.tcp.rseq ~= 1 then
        return VERDICT_PASS
    end

    -- Split на 3 части, средняя с битой контрольной суммой (disorder)
    local len = 400
    local first  = string.sub(desync.dis.payload, 1, len)
    local second = string.sub(desync.dis.payload, len + 1, 2 * len)
    local third  = string.sub(desync.dis.payload, 2 * len + 1)
    rawsend_payload_segmented(desync, first)
    rawsend_payload_segmented(desync, third, 2 * len)
    desync.arg["badsum"] = true
    rawsend_payload_segmented(desync, second, len)
    instance_cutoff(ctx, false)
    return VERDICT_DROP
end
LUA

    # Старт-скрипт: nft-правила + запуск демона
    install -m 0755 "${INSTALL_DIR}/scripts/zapret2-start.sh" "${START_SCRIPT}"

    # systemd-юнит
    cat > "${UNIT}" <<UNIT
[Unit]
Description=TGGATE Zapret2 MTProto fix (nfqws2)
After=network-online.target nftables.service
Wants=network-online.target

[Service]
Type=simple
ExecStart=${START_SCRIPT}
ExecStop=/usr/sbin/nft delete table ip ${TABLE}
Restart=on-failure
RestartSec=2
StandardOutput=journal
StandardError=journal
SyslogIdentifier=tggate-zapret2

[Install]
WantedBy=multi-user.target
UNIT
    systemctl daemon-reload

    # sysctl: сохраняем текущие значения (для отката) и ставим свои
    declare -A PREV_SYSCTL=(
        [net.ipv4.tcp_tw_reuse]="$(sysctl -n net.ipv4.tcp_tw_reuse 2>/dev/null || echo 2)"
        [net.core.rmem_max]="$(sysctl -n net.core.rmem_max 2>/dev/null || echo 212992)"
        [net.core.wmem_max]="$(sysctl -n net.core.wmem_max 2>/dev/null || echo 212992)"
        [net.ipv4.tcp_rmem]="$(sysctl -n net.ipv4.tcp_rmem 2>/dev/null || echo '4096 131072 6291456')"
        [net.ipv4.tcp_wmem]="$(sysctl -n net.ipv4.tcp_wmem 2>/dev/null || echo '4096 16384 4194304')"
    )
    {
        echo "# Сгенерировано TGGATE zapret2 (для отката см. $DIR/prev-sysctl.env)"
        for k in "${!PREV_SYSCTL[@]}"; do echo "PREV_SYSCTL[$k]=\"${PREV_SYSCTL[$k]}\""; done
    } > "${DIR}/prev-sysctl.env"
    cat > /etc/sysctl.d/99-tggate-zapret2.conf <<'SYSCTL'
net.ipv4.tcp_tw_reuse = 1
SYSCTL
    # wscale: гранулярность окна должна позволять win=10 быть меньше порога
    cat > /etc/sysctl.d/99-tggate-wscale.conf <<'SYSCTL'
net.core.rmem_max = 16777216
net.core.wmem_max = 16777216
net.ipv4.tcp_rmem = 4096 131072 16777216
net.ipv4.tcp_wmem = 4096 131072 16777216
SYSCTL
    sysctl --system >/dev/null 2>&1 || true

    systemctl enable --now tggate-zapret2.service
    sleep 2
    systemctl is-active --quiet tggate-zapret2.service \
        || fail "служба не поднялась: journalctl -u tggate-zapret2"
    log "Установлено и запущено. Порт MTProto: ${MTPROTO_PORT}"
}

case "${ACTION}" in
    install) do_install ;;
    remove)  do_remove ;;
    start|stop|restart)
        systemctl "${ACTION}" tggate-zapret2.service
        log "Команда ${ACTION} выполнена"
        ;;
    *) fail "действие: install | remove | start | stop | restart (получено: '${ACTION}')" ;;
esac
