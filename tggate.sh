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

# ---------------------------------------------------------------------------
# Язык интерфейса: берётся из install.env (LANGUAGE, записывается install.sh),
# переопределяется переменной окружения TGGATE_LANG или аргументом ru|en.
# Использование: tr <ключ> [аргументы...]
# ---------------------------------------------------------------------------
INSTALL_LANG="ru"

tr() {
    local lang_key="${INSTALL_LANG:-ru}:$1"
    case "${lang_key}" in
        ru:err_root) echo "Запустите с правами root: sudo TGGATE" ;;
        en:err_root) echo "Run as root: sudo TGGATE" ;;
        ru:err_noinstall) echo "TGGATE не установлен (не найден $2)" ;;
        en:err_noinstall) echo "TGGATE is not installed ($2 not found)" ;;
        ru:st_title) echo "Статус сервисов:" ;;
        en:st_title) echo "Service status:" ;;
        ru:st_works) echo "работает" ;;
        en:st_works) echo "running" ;;
        ru:st_down) echo "остановлен" ;;
        en:st_down) echo "stopped" ;;
        ru:st_vers) echo "Версии:" ;;
        en:st_vers) echo "Versions:" ;;
        ru:st_panel) echo "Панель: " ;;
        en:st_panel) echo "Panel: " ;;
        ru:st_telemt_na) echo "не определена" ;;
        en:st_telemt_na) echo "unknown" ;;
        ru:st_unknown) echo "неизвестно" ;;
        en:st_unknown) echo "unknown" ;;
        ru:st_domain) echo "Домен: " ;;
        en:st_domain) echo "Domain: " ;;
        ru:st_admin) echo "Админка: " ;;
        en:st_admin) echo "Admin: " ;;
        ru:log_pick) echo "1) telemt   2) tggate-panel   3) nginx   4) caddy" ;;
        en:log_pick) echo "1) telemt   2) tggate-panel   3) nginx   4) caddy" ;;
        ru:log_which) echo "Логи какого сервиса показать? [1-4]: " ;;
        en:log_which) echo "Which service logs to show? [1-4]: " ;;
        ru:log_nginx_empty) echo "Лог nginx пуст" ;;
        en:log_nginx_empty) echo "nginx log is empty" ;;
        ru:cancelled) echo "Отменено" ;;
        en:cancelled) echo "Cancelled" ;;
        ru:cred_login) echo "Новый логин (Enter — оставить '$2'): " ;;
        en:cred_login) echo "New login (Enter — keep '$2'): " ;;
        ru:cred_pass) echo "Новый пароль (Enter — не менять, мин. 8 символов): " ;;
        en:cred_pass) echo "New password (Enter — keep, min 8 chars): " ;;
        ru:cred_short) echo "Пароль должен быть не короче 8 символов" ;;
        en:cred_short) echo "Password must be at least 8 chars" ;;
        ru:cred_ok) echo "Учётные данные обновлены" ;;
        en:cred_ok) echo "Credentials updated" ;;
        ru:cred_fail) echo "Не удалось обновить учётные данные (панель запущена?)" ;;
        en:cred_fail) echo "Failed to update credentials (is the panel running?)" ;;
        ru:dom_new) echo "Новый домен: " ;;
        en:dom_new) echo "New domain: " ;;
        ru:dom_bad) echo "Некорректный домен" ;;
        en:dom_bad) echo "Invalid domain" ;;
        ru:dom_changing) echo "Меняю домен $2 → $3..." ;;
        en:dom_changing) echo "Changing domain $2 → $3..." ;;
        ru:dom_ok) echo "Домен изменён. SSL-сертификат будет выпущен автоматически." ;;
        en:dom_ok) echo "Domain changed. The SSL certificate will be issued automatically." ;;
        ru:bk_ok) echo "Бэкап создан: $2" ;;
        en:bk_ok) echo "Backup created: $2" ;;
        ru:rs_list) echo "Доступные бэкапы:" ;;
        en:rs_list) echo "Available backups:" ;;
        ru:rs_none) echo "Бэкапы не найдены в $2" ;;
        en:rs_none) echo "No backups found in $2" ;;
        ru:rs_name) echo "Введите имя файла бэкапа: " ;;
        en:rs_name) echo "Enter backup file name: " ;;
        ru:rs_nofile) echo "Файл не найден" ;;
        en:rs_nofile) echo "File not found" ;;
        ru:rs_warn) echo "Восстановление перезапишет текущие данные!" ;;
        en:rs_warn) echo "Restore will overwrite current data!" ;;
        ru:rs_continue) echo "Продолжить? [y/N]: " ;;
        en:rs_continue) echo "Continue? [y/N]: " ;;
        ru:rs_done) echo "Восстановление завершено" ;;
        en:rs_done) echo "Restore finished" ;;
        ru:menu_title) echo "TGGATE — МЕНЮ УПРАВЛЕНИЯ" ;;
        en:menu_title) echo "TGGATE — CONTROL MENU" ;;
        ru:m_status) echo "Статус сервисов" ;;
        en:m_status) echo "Service status" ;;
        ru:m_start) echo "Запустить панель" ;;
        en:m_start) echo "Start panel" ;;
        ru:m_stop) echo "Остановить панель" ;;
        en:m_stop) echo "Stop panel" ;;
        ru:m_restart) echo "Перезапустить панель" ;;
        en:m_restart) echo "Restart panel" ;;
        ru:m_logs) echo "Логи" ;;
        en:m_logs) echo "Logs" ;;
        ru:m_cred) echo "Сменить логин/пароль" ;;
        en:m_cred) echo "Change login/password" ;;
        ru:m_domain) echo "Сменить домен" ;;
        en:m_domain) echo "Change domain" ;;
        ru:m_upd_panel) echo "Обновить панель" ;;
        en:m_upd_panel) echo "Update panel" ;;
        ru:m_upd_telemt) echo "Обновить Telemt" ;;
        en:m_upd_telemt) echo "Update Telemt" ;;
        ru:m_check) echo "Проверить обновления" ;;
        en:m_check) echo "Check updates" ;;
        ru:m_backup) echo "Бэкап" ;;
        en:m_backup) echo "Backup" ;;
        ru:m_restore) echo "Восстановить из бэкапа" ;;
        en:m_restore) echo "Restore from backup" ;;
        ru:m_remove) echo "Удалить всё" ;;
        en:m_remove) echo "Remove everything" ;;
        ru:m_exit) echo "Выход" ;;
        en:m_exit) echo "Exit" ;;
        ru:m_lang) echo "Язык / Language" ;;
        en:m_lang) echo "Язык / Language" ;;
        ru:choice) echo "Выберите пункт [0-14]: " ;;
        en:choice) echo "Choose an item [0-14]: " ;;
        ru:started) echo "Панель запущена" ;;
        en:started) echo "Panel started" ;;
        ru:stopped) echo "Панель остановлена" ;;
        en:stopped) echo "Panel stopped" ;;
        ru:restarted) echo "Панель перезапущена" ;;
        en:restarted) echo "Panel restarted" ;;
        ru:rm_confirm) echo "Удалить TGGATE полностью? Это необратимо! [y/N]: " ;;
        en:rm_confirm) echo "Remove TGGATE completely? This is irreversible! [y/N]: " ;;
        ru:unknown) echo "Неизвестный пункт" ;;
        en:unknown) echo "Unknown item" ;;
        ru:press_enter) echo "Нажмите Enter для продолжения..." ;;
        en:press_enter) echo "Press Enter to continue..." ;;
        ru:lang_picked) echo "Язык: Русский" ;;
        en:lang_picked) echo "Language: English" ;;
        *) echo "$1" ;;
    esac
}

# Проверка root и наличия установки (язык здесь — только из TGGATE_LANG,
# т.к. install.env может отсутствовать)
if [[ -n "${TGGATE_LANG:-}" ]]; then INSTALL_LANG="${TGGATE_LANG}"; fi
[[ "${EUID}" -eq 0 ]] || fail "$(tr err_root)"
[[ -f "${CONFIG_ENV}" ]] || fail "$(tr err_noinstall "${CONFIG_ENV}")"
# shellcheck source=/dev/null
source "${CONFIG_ENV}"

# Язык: аргумент > переменная окружения > сохранённый при установке > ru
if [[ "${1:-}" == "ru" || "${1:-}" == "en" ]]; then
    INSTALL_LANG="$1"
    sed -i "s|^LANGUAGE=.*|LANGUAGE=\"${INSTALL_LANG}\"|" "${CONFIG_ENV}"
    shift
elif [[ -n "${TGGATE_LANG:-}" ]]; then
    INSTALL_LANG="${TGGATE_LANG}"
else
    INSTALL_LANG="${LANGUAGE:-ru}"
fi

# ---------------------------------------------------------------------------
# Функции управления
# ---------------------------------------------------------------------------

# Статус всех сервисов с индикаторами
show_status() {
    echo
    echo -e "${C_BOLD}$(tr st_title)${C_RESET}"
    for svc in telemt tggate-panel nginx caddy; do
        if systemctl is-active --quiet "${svc}"; then
            echo -e "  ${C_GREEN}✅ ${svc}${C_RESET} — $(tr st_works)"
        else
            echo -e "  ${C_RED}❌ ${svc}${C_RESET} — $(tr st_down)"
        fi
    done
    echo
    echo -e "${C_BOLD}$(tr st_vers)${C_RESET}"
    echo -e "  $(tr st_panel) ${PANEL_VERSION:-$(tr st_unknown)}"
    echo -e "  Telemt:  $(/usr/local/bin/telemt --version 2>/dev/null | head -n1 || tr st_telemt_na)"
    echo -e "  $(tr st_domain)  ${DOMAIN}"
    echo -e "  $(tr st_admin)https://${DOMAIN}/${ADMIN_PATH}/"
}

# Просмотр логов сервиса
show_logs() {
    echo "$(tr log_pick)"
    read -rp "$(tr log_which)" n
    case "${n}" in
        1) journalctl -u telemt -n 100 --no-pager ;;
        2) journalctl -u tggate-panel -n 100 --no-pager ;;
        3) tail -n 100 /var/log/nginx/error.log 2>/dev/null || warn "$(tr log_nginx_empty)" ;;
        4) journalctl -u caddy -n 100 --no-pager ;;
        *) warn "$(tr cancelled)" ;;
    esac
}

# Смена логина/пароля администратора через API панели (через loopback)
change_credentials() {
    read -rp "$(tr cred_login "${ADMIN_LOGIN}")" new_login
    read -rsp "$(tr cred_pass)" new_pass
    echo
    local payload="{"
    local sep=""
    if [[ -n "${new_login}" ]]; then
        payload+="\"login\":\"${new_login}\""; sep=","
    fi
    if [[ -n "${new_pass}" ]]; then
        [[ ${#new_pass} -ge 8 ]] || fail "$(tr cred_short)"
        payload+="${sep}\"password\":\"${new_pass}\""
    fi
    payload+="}"
    curl -fsS -X POST "http://127.0.0.1:${PANEL_PORT}/api/internal/reset-admin" \
        -H "Content-Type: application/json" -d "${payload}" >/dev/null \
        && ok "$(tr cred_ok)" \
        || fail "$(tr cred_fail)"
    # Обновляем логин в конфиге, если меняли
    if [[ -n "${new_login}" ]]; then
        sed -i "s|^ADMIN_LOGIN=.*|ADMIN_LOGIN=\"${new_login}\"|" "${CONFIG_ENV}"
    fi
}

# Смена домена: обновляем конфиги и перевыпускаем сертификат
change_domain() {
    read -rp "$(tr dom_new)" new_domain
    [[ "${new_domain}" =~ ^[a-z0-9.-]+\.[a-z]{2,}$ ]] || fail "$(tr dom_bad)"
    warn "$(tr dom_changing "${DOMAIN}" "${new_domain}")"
    sed -i "s|^DOMAIN=.*|DOMAIN=\"${new_domain}\"|" "${CONFIG_ENV}"
    # Перегенерируем конфиги
    DOMAIN="${new_domain}" bash "${INSTALL_DIR}/scripts/install_nginx.sh"
    DOMAIN="${new_domain}" bash "${INSTALL_DIR}/scripts/install_caddy.sh"
    systemctl reload nginx caddy
    ok "$(tr dom_ok)"
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
    ok "$(tr bk_ok "${BACKUP_DIR}/manual-${ts}.tar.gz")"
}

# Восстановление из бэкапа
do_restore() {
    echo "$(tr rs_list)"
    ls -1 "${BACKUP_DIR}"/*.tar.gz 2>/dev/null || fail "$(tr rs_none "${BACKUP_DIR}")"
    read -rp "$(tr rs_name)" fname
    [[ -f "${BACKUP_DIR}/${fname}" ]] || fail "$(tr rs_nofile)"
    warn "$(tr rs_warn)"
    read -rp "$(tr rs_continue)" ans
    [[ "${ans,,}" == "y" ]] || return
    systemctl stop tggate-panel
    tar -xzf "${BACKUP_DIR}/${fname}" -C /tmp
    local dir="/tmp/$(tar -tzf "${BACKUP_DIR}/${fname}" | head -n1 | cut -d/ -f1)"
    cp -a "${dir}/etc-tggate/." "${CONFIG_DIR}/"
    cp -a "${dir}/data/." "${DATA_DIR}/"
    rm -rf "${dir}"
    systemctl start tggate-panel
    ok "$(tr rs_done)"
}

# Переключение языка меню (RU/EN) с сохранением в install.env
switch_language() {
    if [[ "${INSTALL_LANG}" == "en" ]]; then
        INSTALL_LANG="ru"
    else
        INSTALL_LANG="en"
    fi
    sed -i "s|^LANGUAGE=.*|LANGUAGE=\"${INSTALL_LANG}\"|" "${CONFIG_ENV}"
    ok "$(tr lang_picked)"
}

# ---------------------------------------------------------------------------
# Меню
# ---------------------------------------------------------------------------
mi() { printf '║ %-41s ║\n' "$1"; }

print_menu() {
    clear
    echo -e "${C_CYAN}${C_BOLD}"
    echo "╔═══════════════════════════════════════════╗"
    mi "      $(tr menu_title)"
    echo "╠═══════════════════════════════════════════╣"
    mi " 1.  $(tr m_status)"
    mi " 2.  $(tr m_start)"
    mi " 3.  $(tr m_stop)"
    mi " 4.  $(tr m_restart)"
    mi " 5.  $(tr m_logs)"
    mi " 6.  $(tr m_cred)"
    mi " 7.  $(tr m_domain)"
    mi " 8.  $(tr m_upd_panel)"
    mi " 9.  $(tr m_upd_telemt)"
    mi " 10. $(tr m_check)"
    mi " 11. $(tr m_backup)"
    mi " 12. $(tr m_restore)"
    mi " 13. $(tr m_remove)"
    mi " 14. $(tr m_lang)"
    mi " 0.  $(tr m_exit)"
    echo "╚═══════════════════════════════════════════╝"
    echo -e "${C_RESET}"
}

main_loop() {
    while true; do
        print_menu
        read -rp "$(tr choice)" choice
        case "${choice}" in
            1)  show_status ;;
            2)  systemctl start tggate-panel && ok "$(tr started)" ;;
            3)  systemctl stop tggate-panel && ok "$(tr stopped)" ;;
            4)  systemctl restart tggate-panel && ok "$(tr restarted)" ;;
            5)  show_logs ;;
            6)  change_credentials ;;
            7)  change_domain ;;
            8)  bash "${INSTALL_DIR}/scripts/update-panel.sh" ;;
            9)  bash "${INSTALL_DIR}/scripts/update-telemt.sh" ;;
            10) bash "${INSTALL_DIR}/scripts/check-updates.sh" --verbose ;;
            11) do_backup ;;
            12) do_restore ;;
            13)
                read -rp "$(tr rm_confirm)" ans
                [[ "${ans,,}" == "y" ]] && bash "${INSTALL_DIR}/uninstall.sh"
                ;;
            14) switch_language ;;
            0)  exit 0 ;;
            *)  warn "$(tr unknown)" ;;
        esac
        echo
        read -rp "$(tr press_enter)"
    done
}

main_loop
