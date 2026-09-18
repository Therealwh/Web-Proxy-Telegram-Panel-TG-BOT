#!/usr/bin/env bash
#
# =============================================================================
# TGGATE — консольный менеджер панели (запуск: sudo TGGATE)
# =============================================================================

set -euo pipefail

readonly CONFIG_ENV="/etc/tggate/install.env"

# Цвета
readonly C_RESET="\033[0m" C_RED="\033[0;31m" C_GREEN="\033[0;32m"
readonly C_YELLOW="\033[0;33m" C_CYAN="\033[0;36m" C_BOLD="\033[1m"

info() { echo -e "${C_CYAN}[INFO]${C_RESET}  $*"; }
ok()   { echo -e "${C_GREEN}[ OK ]${C_RESET}  $*"; }
warn() { echo -e "${C_YELLOW}[WARN]${C_RESET}  $*"; }
fail() { echo -e "${C_RED}[FAIL]${C_RESET}  $*" >&2; exit 1; }

# Проверка root и наличия установки
[[ "${EUID}" -eq 0 ]] || fail "Запустите с правами root: sudo TGGATE"
[[ -f "${CONFIG_ENV}" ]] || fail "TGGATE не установлен (не найден ${CONFIG_ENV})"
# shellcheck source=/dev/null
source "${CONFIG_ENV}"

# ---------------------------------------------------------------------------
# Функции управления
# ---------------------------------------------------------------------------

# Статус всех сервисов с индикаторами
show_status() {
    echo
    echo -e "${C_BOLD}Статус сервисов:${C_RESET}"
    for svc in telemt tggate-panel nginx caddy; do
        if systemctl is-active --quiet "${svc}"; then
            echo -e "  ${C_GREEN}✅ ${svc}${C_RESET} — работает"
        else
            echo -e "  ${C_RED}❌ ${svc}${C_RESET} — остановлен"
        fi
    done
    echo
    echo -e "${C_BOLD}Версии:${C_RESET}"
    echo -e "  Панель:  ${PANEL_VERSION:-неизвестно}"
    echo -e "  Telemt:  $(/usr/local/bin/telemt --version 2>/dev/null | head -n1 || echo 'не определена')"
    echo -e "  Домен:   ${DOMAIN}"
    echo -e "  Админка: https://${DOMAIN}/${ADMIN_PATH}/"
}

# Просмотр логов сервиса
show_logs() {
    echo "1) telemt   2) tggate-panel   3) nginx   4) caddy"
    read -rp "Логи какого сервиса показать? [1-4]: " n
    case "${n}" in
        1) journalctl -u telemt -n 100 --no-pager ;;
        2) journalctl -u tggate-panel -n 100 --no-pager ;;
        3) tail -n 100 /var/log/nginx/error.log 2>/dev/null || warn "Лог nginx пуст" ;;
        4) journalctl -u caddy -n 100 --no-pager ;;
        *) warn "Отменено" ;;
    esac
}

# Смена логина/пароля администратора через API панели (через loopback)
change_credentials() {
    read -rp "Новый логин (Enter — оставить '${ADMIN_LOGIN}'): " new_login
    read -rsp "Новый пароль (Enter — не менять, мин. 8 символов): " new_pass
    echo
    local payload="{"
    local sep=""
    if [[ -n "${new_login}" ]]; then
        payload+="\"login\":\"${new_login}\""; sep=","
    fi
    if [[ -n "${new_pass}" ]]; then
        [[ ${#new_pass} -ge 8 ]] || fail "Пароль должен быть не короче 8 символов"
        payload+="${sep}\"password\":\"${new_pass}\""
    fi
    payload+="}"
    curl -fsS -X POST "http://127.0.0.1:${PANEL_PORT}/api/internal/reset-admin" \
        -H "Content-Type: application/json" -d "${payload}" >/dev/null \
        && ok "Учётные данные обновлены" \
        || fail "Не удалось обновить учётные данные (панель запущена?)"
    # Обновляем логин в конфиге, если меняли
    if [[ -n "${new_login}" ]]; then
        sed -i "s|^ADMIN_LOGIN=.*|ADMIN_LOGIN=\"${new_login}\"|" "${CONFIG_ENV}"
    fi
}

# Смена домена: обновляем конфиги и перевыпускаем сертификат
change_domain() {
    read -rp "Новый домен: " new_domain
    [[ "${new_domain}" =~ ^[a-z0-9.-]+\.[a-z]{2,}$ ]] || fail "Некорректный домен"
    warn "Меняю домен ${DOMAIN} → ${new_domain}..."
    sed -i "s|^DOMAIN=.*|DOMAIN=\"${new_domain}\"|" "${CONFIG_ENV}"
    # Перегенерируем конфиги
    DOMAIN="${new_domain}" bash "${INSTALL_DIR}/scripts/install_nginx.sh"
    DOMAIN="${new_domain}" bash "${INSTALL_DIR}/scripts/install_caddy.sh"
    systemctl reload nginx caddy
    ok "Домен изменён. SSL-сертификат будет выпущен автоматически."
}

# Ручной бэкап
do_backup() {
    local ts dest
    ts="$(date +%Y%m%d-%H%M%S)"
    dest="${BACKUP_DIR}/manual-${ts}"
    mkdir -p "${dest}"
    cp -a "${CONFIG_DIR}" "${dest}/etc-tggate"
    cp -a "${DATA_DIR}" "${dest}/data"
    cp -a "${DATA_DIR}/tggate.db" "${dest}/tggate.db" 2>/dev/null || true
    tar -czf "${BACKUP_DIR}/manual-${ts}.tar.gz" -C "${BACKUP_DIR}" "manual-${ts}"
    rm -rf "${dest}"
    ok "Бэкап создан: ${BACKUP_DIR}/manual-${ts}.tar.gz"
}

# Восстановление из бэкапа
do_restore() {
    echo "Доступные бэкапы:"
    ls -1 "${BACKUP_DIR}"/*.tar.gz 2>/dev/null || fail "Бэкапы не найдены в ${BACKUP_DIR}"
    read -rp "Введите имя файла бэкапа: " fname
    [[ -f "${BACKUP_DIR}/${fname}" ]] || fail "Файл не найден"
    warn "Восстановление перезапишет текущие данные!"
    read -rp "Продолжить? [y/N]: " ans
    [[ "${ans,,}" == "y" ]] || return
    systemctl stop tggate-panel
    tar -xzf "${BACKUP_DIR}/${fname}" -C /tmp
    local dir="/tmp/$(tar -tzf "${BACKUP_DIR}/${fname}" | head -n1 | cut -d/ -f1)"
    cp -a "${dir}/etc-tggate/." "${CONFIG_DIR}/"
    cp -a "${dir}/data/." "${DATA_DIR}/"
    rm -rf "${dir}"
    systemctl start tggate-panel
    ok "Восстановление завершено"
}

# ---------------------------------------------------------------------------
# Меню
# ---------------------------------------------------------------------------
print_menu() {
    clear
    echo -e "${C_CYAN}${C_BOLD}"
    echo "╔══════════════════════════════════════════╗"
    echo "║       TGGATE — МЕНЮ УПРАВЛЕНИЯ           ║"
    echo "╠══════════════════════════════════════════╣"
    echo "║ 1.  Статус сервисов                      ║"
    echo "║ 2.  Запустить панель                     ║"
    echo "║ 3.  Остановить панель                    ║"
    echo "║ 4.  Перезапустить панель                 ║"
    echo "║ 5.  Логи                                 ║"
    echo "║ 6.  Сменить логин/пароль                 ║"
    echo "║ 7.  Сменить домен                        ║"
    echo "║ 8.  Обновить панель                      ║"
    echo "║ 9.  Обновить Telemt                      ║"
    echo "║ 10. Проверить обновления                 ║"
    echo "║ 11. Бэкап                                ║"
    echo "║ 12. Восстановить из бэкапа               ║"
    echo "║ 13. Удалить всё                          ║"
    echo "║ 0.  Выход                                ║"
    echo "╚══════════════════════════════════════════╝"
    echo -e "${C_RESET}"
}

main_loop() {
    while true; do
        print_menu
        read -rp "Выберите пункт [0-13]: " choice
        case "${choice}" in
            1)  show_status ;;
            2)  systemctl start tggate-panel && ok "Панель запущена" ;;
            3)  systemctl stop tggate-panel && ok "Панель остановлена" ;;
            4)  systemctl restart tggate-panel && ok "Панель перезапущена" ;;
            5)  show_logs ;;
            6)  change_credentials ;;
            7)  change_domain ;;
            8)  bash "${INSTALL_DIR}/scripts/update-panel.sh" ;;
            9)  bash "${INSTALL_DIR}/scripts/update-telemt.sh" ;;
            10) bash "${INSTALL_DIR}/scripts/check-updates.sh" --verbose ;;
            11) do_backup ;;
            12) do_restore ;;
            13)
                read -rp "Удалить TGGATE полностью? Это необратимо! [y/N]: " ans
                [[ "${ans,,}" == "y" ]] && bash "${INSTALL_DIR}/uninstall.sh"
                ;;
            0)  exit 0 ;;
            *)  warn "Неизвестный пункт" ;;
        esac
        echo
        read -rp "Нажмите Enter для продолжения..."
    done
}

main_loop
