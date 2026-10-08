#!/usr/bin/env bash
#
# =============================================================================
# TGGATE — старт zapret2 (nfqws2) для MTProto: nft-правила + демон.
# Порт берётся из /etc/tggate/install.env (MTPROTO_PORT).
# Правила только на порт MTProto — панель/веб/другие сервисы не трогаются.
# fail-open: queue ... bypass — при падении nfqws2 пакеты идут мимо очереди.
# =============================================================================

set -euo pipefail

source /etc/tggate/install.env

DIR="/opt/tggate-zapret2"
CONF_DIR="/etc/tggate-zapret2"

TABLE="TGGATE"
FWMARK="0x40000000"
PORT="${MTPROTO_PORT:?MTPROTO_PORT не задан}"
QNUM="200"
CT_MARK="0x00040000"
COMBINED_MARK="0x40040000"
# Мимо очереди — только пакеты с данными; FIN/SYN/RST продолжают видеть nfqws2
# (защита от утечки conntrack при переиспользовании портов за NAT, см. zapret2.md)
BYPASS_MATCH="tcp flags & (fin | syn | rst | ack) == ack"

# Переиспользование сокета в TIME_WAIT (закрывает дыру переиспользования кортежа)
sysctl -w net.ipv4.tcp_tw_reuse=1 >/dev/null 2>&1 || true

# Таблица пересоздаётся на каждом старте — не зависит от порядка загрузки
nft delete table ip "$TABLE" 2>/dev/null || true
nft add table ip "$TABLE"

nft "add chain ip $TABLE predefrag { type filter hook output priority -401; policy accept; }"
nft "add rule ip $TABLE predefrag meta mark $COMBINED_MARK counter accept"
nft "add rule ip $TABLE predefrag meta mark and $FWMARK != 0x00000000 counter notrack"

nft "add chain ip $TABLE output { type route hook output priority mangle; policy accept; }"
nft "add rule ip $TABLE output meta mark and $COMBINED_MARK == $COMBINED_MARK ct mark set $CT_MARK counter accept"

nft "add chain ip $TABLE postrouting { type filter hook postrouting priority srcnat + 1; policy accept; }"
nft "add rule ip $TABLE postrouting $BYPASS_MATCH ct mark $CT_MARK counter accept"
nft "add rule ip $TABLE postrouting meta mark and $FWMARK == 0x00000000 tcp sport $PORT counter queue num $QNUM bypass"

nft "add chain ip $TABLE prerouting { type route hook input priority mangle; policy accept; }"
nft "add rule ip $TABLE prerouting $BYPASS_MATCH ct mark $CT_MARK counter accept"
nft "add rule ip $TABLE prerouting meta mark and $FWMARK == 0x00000000 tcp dport $PORT counter queue num $QNUM bypass"

echo "[zapret2] NFT table $TABLE applied (port=$PORT qnum=$QNUM)"

exec "${DIR}/bin/nfqws2" @"${CONF_DIR}/mtproto.conf"
