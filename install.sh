#!/usr/bin/env bash
#
# =============================================================================
# TGGATE — Telegram Gate
# Главный скрипт установки панели управления Telegram-прокси (Telemt)
#
# Использование (одна команда на чистом VPS Ubuntu 22.04/24.04):
#   apt-get -o DPkg::Lock::Timeout=600 update && \
#   apt-get -o DPkg::Lock::Timeout=600 install -y curl ca-certificates git && \
#   bash -c "$(curl -fsSL --proto '=https' --tlsv1.2 \
#     https://raw.githubusercontent.com/Therealwh/Web-Proxy-Telegram-Panel-TG-BOT/main/install.sh)"
#
# Скрипт интерактивно спросит: домен, email, логин/пароль администратора,
# внешний IP. Затем установит и настроит весь комплекс.
# =============================================================================

set -euo pipefail

# ---------------------------------------------------------------------------
# Константы проекта
# ВНИМАНИЕ: без readonly — эти же имена записываются в install.env
# и подгружаются через source (readonly вызвал бы ошибку при повторном source).
# ---------------------------------------------------------------------------
PANEL_REPO="https://github.com/Therealwh/Web-Proxy-Telegram-Panel-TG-BOT"
PANEL_REPO_RAW="https://raw.githubusercontent.com/Therealwh/Web-Proxy-Telegram-Panel-TG-BOT/main"
INSTALL_DIR="/opt/tggate"            # Каталог с кодом панели
CONFIG_DIR="/etc/tggate"             # Конфигурация панели
DATA_DIR="/var/lib/tggate"           # Данные: БД, сайт-заглушка
BACKUP_DIR="/var/backups/tggate"     # Резервные копии
LOG_DIR="/var/log/tggate"            # Логи
PANEL_PORT="3000"                    # Внутренний порт backend панели
TELEMT_API_PORT="9091"               # Порт Telemt Control API (loopback)
TELEMT_WEB_PORT="18080"              # WEB-listener Telemt (loopback)
MTPROTO_PORT="8443"                  # Публичный порт MTProto
NGINX_LOCAL_PORT="8080"              # Nginx слушает loopback (за Caddy)
readonly NODE_MAJOR="22"             # Мажорная версия Node.js LTS (в install.env не пишется)

# ---------------------------------------------------------------------------
# Цвета для красивого вывода
# ---------------------------------------------------------------------------
readonly C_RESET="\033[0m"
readonly C_RED="\033[0;31m"
readonly C_GREEN="\033[0;32m"
readonly C_YELLOW="\033[0;33m"
readonly C_BLUE="\033[0;34m"
readonly C_CYAN="\033[0;36m"
readonly C_BOLD="\033[1m"

# ---------------------------------------------------------------------------
# Функции вывода сообщений
# ---------------------------------------------------------------------------

# Информационное сообщение
info()  { echo -e "${C_BLUE}[INFO]${C_RESET}  $*"; }

# Успешное завершение шага
ok()    { echo -e "${C_GREEN}[ OK ]${C_RESET}  $*"; }

# Предупреждение (не критично)
warn()  { echo -e "${C_YELLOW}[WARN]${C_RESET}  $*"; }

# Критическая ошибка — завершает установку
fail()  { echo -e "${C_RED}[FAIL]${C_RESET}  $*" >&2; exit 1; }

# Заголовок шага установки
step()  { echo -e "\n${C_CYAN}${C_BOLD}=== $* ===${C_RESET}"; }

# ---------------------------------------------------------------------------
# Язык установщика: ru (по умолчанию) или en
# Выбор спрашивается первым делом в main(); язык сохраняется в install.env
# как LANGUAGE и подхватывается командой TGGATE.
# Использование: tr <ключ> [аргументы...] — аргументы подставляются как $2, $3...
# ---------------------------------------------------------------------------
INSTALL_LANG="ru"

tr() {
    local lang_key="${INSTALL_LANG:-ru}:$1"
    case "${lang_key}" in
        # --- выбор языка ---
        ru:lang_title) echo "Выберите язык установки:" ;;
        en:lang_title) echo "Choose installation language:" ;;
        ru:lang_prompt) echo "Язык / Language [1=Русский, 2=English, по умолчанию 1]: " ;;
        en:lang_prompt) echo "Язык / Language [1=Русский, 2=English, default 1]: " ;;
        # --- проверки окружения ---
        ru:err_root) echo "Скрипт должен быть запущен от root. Используйте: sudo bash install.sh" ;;
        en:err_root) echo "This script must be run as root. Use: sudo bash install.sh" ;;
        ru:err_os1) echo "Не удалось определить ОС. Поддерживается только Ubuntu 22.04+ / 24.04+." ;;
        en:err_os1) echo "Could not detect OS. Only Ubuntu 22.04+ / 24.04+ is supported." ;;
        ru:err_os2) echo "Поддерживается только Ubuntu. Обнаружено: $2. Для других ОС установка не проверялась." ;;
        en:err_os2) echo "Only Ubuntu is supported. Detected: $2. Other OSes were not tested." ;;
        ru:err_os3) echo "Требуется Ubuntu 22.04 или новее. Обнаружено: $2." ;;
        en:err_os3) echo "Ubuntu 22.04 or newer is required. Detected: $2." ;;
        ru:ok_os) echo "ОС: Ubuntu $2" ;;
        en:ok_os) echo "OS: Ubuntu $2" ;;
        ru:err_ports) echo "Порты $2 уже заняты другими сервисами. Остановите их или используйте чистый VPS." ;;
        en:err_ports) echo "Ports $2 are already used by other services. Stop them or use a clean VPS." ;;
        ru:ok_ports) echo "Порты 80/443 свободны" ;;
        en:ok_ports) echo "Ports 80/443 are free" ;;
        # --- ввод параметров ---
        ru:step_params) echo "Параметры установки" ;;
        en:step_params) echo "Installation parameters" ;;
        ru:ask_domain) echo "🌐 Домен для панели (например, proxy.example.com): " ;;
        en:ask_domain) echo "🌐 Domain for the panel (e.g. proxy.example.com): " ;;
        ru:err_domain) echo "Некорректный домен: '$2'. Укажите FQDN, например proxy.example.com" ;;
        en:err_domain) echo "Invalid domain: '$2'. Specify an FQDN, e.g. proxy.example.com" ;;
        ru:ask_email) echo "📧 Email для SSL-сертификата Let's Encrypt: " ;;
        en:ask_email) echo "📧 Email for the Let's Encrypt SSL certificate: " ;;
        ru:err_email) echo "Некорректный email: '$2'" ;;
        en:err_email) echo "Invalid email: '$2'" ;;
        ru:ask_login) echo "👤 Логин администратора (латиница и цифры): " ;;
        en:ask_login) echo "👤 Admin login (latin letters and digits): " ;;
        ru:err_login) echo "Логин должен содержать только латиницу, цифры и '_' (3-32 символа)." ;;
        en:err_login) echo "Login may contain only latin letters, digits and '_' (3-32 chars)." ;;
        ru:ask_pass) echo "🔑 Пароль администратора (минимум 8 символов): " ;;
        en:ask_pass) echo "🔑 Admin password (min 8 chars): " ;;
        ru:pass_short) echo "Пароль слишком короткий (минимум 8 символов). Попробуйте ещё раз." ;;
        en:pass_short) echo "Password too short (min 8 chars). Try again." ;;
        ru:pass_weak) echo "Пароль должен содержать буквы и цифры. Попробуйте ещё раз." ;;
        en:pass_weak) echo "Password must contain letters and digits. Try again." ;;
        ru:ask_pass2) echo "🔑 Повторите пароль: " ;;
        en:ask_pass2) echo "🔑 Repeat password: " ;;
        ru:pass_mismatch) echo "Пароли не совпадают. Попробуйте ещё раз." ;;
        en:pass_mismatch) echo "Passwords do not match. Try again." ;;
        ru:ask_ip) echo "🌍 Внешний IP VPS [$2] (Enter — оставить): " ;;
        en:ask_ip) echo "🌍 VPS public IP [$2] (Enter — keep): " ;;
        ru:ask_ip_manual) echo "🌍 Не удалось определить внешний IP автоматически. Введите вручную: " ;;
        en:ask_ip_manual) echo "🌍 Could not detect public IP automatically. Enter manually: " ;;
        ru:err_ip) echo "Некорректный IP-адрес: '$2'" ;;
        en:err_ip) echo "Invalid IP address: '$2'" ;;
        # --- DNS ---
        ru:step_dns) echo "Проверка DNS" ;;
        en:step_dns) echo "DNS check" ;;
        ru:warn_dns1) echo "Домен $2 не резолвится (нет A-записи)." ;;
        en:warn_dns1) echo "Domain $2 does not resolve (no A record)." ;;
        ru:ask_dns1) echo "Продолжить установку без проверки DNS? SSL может не выпуститься. [y/N]: " ;;
        en:ask_dns1) echo "Continue without DNS check? SSL may fail to issue. [y/N]: " ;;
        ru:err_dns1) echo "Настройте A-запись домена на $2 и запустите установку снова." ;;
        en:err_dns1) echo "Point the domain A-record to $2 and run the installer again." ;;
        ru:warn_dns2) echo "Домен $2 указывает на $3, а внешний IP сервера — $4." ;;
        en:warn_dns2) echo "Domain $2 points to $3, but the server public IP is $4." ;;
        ru:ask_dns2) echo "Продолжить всё равно? [y/N]: " ;;
        en:ask_dns2) echo "Continue anyway? [y/N]: " ;;
        ru:err_dns2) echo "Исправьте A-запись домена и запустите установку снова." ;;
        en:err_dns2) echo "Fix the domain A-record and run the installer again." ;;
        ru:ok_dns) echo "DNS настроен корректно: $2 → $3" ;;
        en:ok_dns) echo "DNS is correct: $2 → $3" ;;
        # --- зависимости ---
        ru:step_deps) echo "Установка системных зависимостей" ;;
        en:step_deps) echo "Installing system dependencies" ;;
        ru:info_node) echo "Устанавливаю Node.js $2.x LTS..." ;;
        en:info_node) echo "Installing Node.js $2.x LTS..." ;;
        ru:ok_node) echo "Node.js $2, npm $3" ;;
        en:ok_node) echo "Node.js $2, npm $3" ;;
        ru:info_caddy) echo "Устанавливаю Caddy..." ;;
        en:info_caddy) echo "Installing Caddy..." ;;
        ru:ok_caddy) echo "Caddy $2" ;;
        en:ok_caddy) echo "Caddy $2" ;;
        # --- исходники ---
        ru:step_fetch) echo "Загрузка исходников TGGATE" ;;
        en:step_fetch) echo "Fetching TGGATE sources" ;;
        ru:info_fetch_upd) echo "Репозиторий уже существует, обновляю..." ;;
        en:info_fetch_upd) echo "Repository already exists, updating..." ;;
        ru:info_fetch_local) echo "Использую локальные исходники в $2" ;;
        en:info_fetch_local) echo "Using local sources in $2" ;;
        ru:ok_fetch) echo "Исходники размещены в $2" ;;
        en:ok_fetch) echo "Sources placed in $2" ;;
        # --- секреты ---
        ru:step_secrets) echo "Генерация секретов" ;;
        en:step_secrets) echo "Generating secrets" ;;
        ru:ok_secrets) echo "Секреты сгенерированы, конфигурация сохранена в $2" ;;
        en:ok_secrets) echo "Secrets generated, configuration saved to $2" ;;
        # --- сайт-заглушка ---
        ru:step_website) echo "Установка сайта-заглушки" ;;
        en:step_website) echo "Installing decoy website" ;;
        ru:ok_website) echo "Заглушка размещена в $2" ;;
        en:ok_website) echo "Decoy placed in $2" ;;
        # --- панель ---
        ru:step_panel) echo "Установка панели управления" ;;
        en:step_panel) echo "Installing control panel" ;;
        ru:ok_panel) echo "Панель установлена и собрана" ;;
        en:ok_panel) echo "Panel installed and built" ;;
        # --- systemd ---
        ru:step_systemd) echo "Настройка systemd" ;;
        en:step_systemd) echo "Configuring systemd" ;;
        ru:ok_systemd) echo "Сервисы запущены: telemt, tggate-panel, caddy, nginx" ;;
        en:ok_systemd) echo "Services started: telemt, tggate-panel, caddy, nginx" ;;
        # --- админ ---
        ru:step_admin) echo "Создание администратора" ;;
        en:step_admin) echo "Creating administrator" ;;
        ru:err_admin_timeout) echo "Панель не запустилась за 30 секунд. Смотрите: journalctl -u tggate-panel" ;;
        en:err_admin_timeout) echo "Panel did not start within 30 seconds. See: journalctl -u tggate-panel" ;;
        ru:err_admin_create) echo "Не удалось создать администратора: $2" ;;
        en:err_admin_create) echo "Failed to create administrator: $2" ;;
        ru:ok_admin_exists) echo "Администратор уже существует — пропускаю" ;;
        en:ok_admin_exists) echo "Administrator already exists — skipping" ;;
        ru:info_admin_change) echo "Если нужно сменить логин/пароль: sudo TGGATE → пункт 6" ;;
        en:info_admin_change) echo "To change login/password: sudo TGGATE → item 6" ;;
        ru:ok_admin_created) echo "Администратор '$2' создан" ;;
        en:ok_admin_created) echo "Administrator '$2' created" ;;
        ru:err_admin_http) echo "Не удалось создать администратора (HTTP $2): $3" ;;
        en:err_admin_http) echo "Failed to create administrator (HTTP $2): $3" ;;
        # --- CLI / cron ---
        ru:step_cli) echo "Установка команды управления TGGATE" ;;
        en:step_cli) echo "Installing TGGATE management command" ;;
        ru:ok_cli) echo "Команда управления: sudo TGGATE" ;;
        en:ok_cli) echo "Management command: sudo TGGATE" ;;
        ru:step_cron) echo "Настройка автопроверки обновлений" ;;
        en:step_cron) echo "Configuring update auto-check" ;;
        ru:ok_cron) echo "Cron-задача добавлена" ;;
        en:ok_cron) echo "Cron job added" ;;
        # --- итог ---
        ru:sum_title) echo "TGGATE успешно установлен!" ;;
        en:sum_title) echo "TGGATE installed successfully!" ;;
        ru:sum_panel) echo "🌐 Панель управления: " ;;
        en:sum_panel) echo "🌐 Control panel: " ;;
        ru:sum_login) echo "👤 Логин: " ;;
        en:sum_login) echo "👤 Login: " ;;
        ru:sum_pass) echo "🔑 Пароль: (тот, что вы ввели при установке)" ;;
        en:sum_pass) echo "🔑 Password: (the one you entered during setup)" ;;
        ru:sum_mtproto) echo "🔌 MTProto порт: " ;;
        en:sum_mtproto) echo "🔌 MTProto port: " ;;
        ru:sum_web) echo "🌐 Web Proxy: " ;;
        en:sum_web) echo "🌐 Web Proxy: " ;;
        ru:sum_via) echo " (через Telemt)" ;;
        en:sum_via) echo " (via Telemt)" ;;
        ru:sum_manage) echo "🛠  Управление: " ;;
        en:sum_manage) echo "🛠  Manage: " ;;
        ru:sum_config) echo "📁 Конфигурация: " ;;
        en:sum_config) echo "📁 Configuration: " ;;
        ru:sum_backups) echo "📦 Бэкапы: " ;;
        en:sum_backups) echo "📦 Backups: " ;;
        ru:warn_save_path) echo "Сохраните секретный путь админки — без него вход в панель невозможен!" ;;
        en:warn_save_path) echo "Save the secret admin path — you cannot log in without it!" ;;
        ru:banner2) echo "  ║   Установка панели управления         ║" ;;
        en:banner2) echo "  ║   Control panel installation          ║" ;;
        *) echo "$1" ;;
    esac
}

# Спрашивает язык установки первым делом (по умолчанию — русский)
ask_language() {
    echo
    echo "  $(tr lang_title)"
    echo "  [1] Русский"
    echo "  [2] English"
    local choice=""
    read -rp "  $(tr lang_prompt)" choice
    if [[ "${choice}" == "2" ]]; then
        INSTALL_LANG="en"
    else
        INSTALL_LANG="ru"
    fi
}

# ---------------------------------------------------------------------------
# Проверки окружения
# ---------------------------------------------------------------------------

# Проверяет, что скрипт запущен от root
check_root() {
    if [[ "${EUID}" -ne 0 ]]; then
        fail "$(tr err_root)"
    fi
}

# Проверяет поддерживаемую версию ОС (Ubuntu 22.04+ / 24.04+)
check_os() {
    if [[ ! -f /etc/os-release ]]; then
        fail "$(tr err_os1)"
    fi
    # shellcheck source=/dev/null
    source /etc/os-release
    if [[ "${ID}" != "ubuntu" ]]; then
        fail "$(tr err_os2 "${ID}")"
    fi
    local major="${VERSION_ID%%.*}"
    if [[ "${major}" -lt 22 ]]; then
        fail "$(tr err_os3 "${VERSION_ID}")"
    fi
    ok "$(tr ok_os "${VERSION_ID}")"
}

# Проверяет, что порты 80 и 443 свободны (VPS «чистый»).
# При повторном запуске останавливает уже установленные сервисы TGGATE.
check_ports_free() {
    # Идемпотентность: при повторной установке наши сервисы уже держат порты
    for svc in caddy nginx telemt tggate-panel; do
        systemctl stop "${svc}" 2>/dev/null || true
    done
    sleep 1
    local busy=()
    for port in 80 443; do
        if ss -tlnp 2>/dev/null | grep -qE "[:.]${port}\s"; then
            busy+=("${port}")
        fi
    done
    if [[ ${#busy[@]} -gt 0 ]]; then
        fail "$(tr err_ports "${busy[*]}")"
    fi
    ok "$(tr ok_ports)"
}

# ---------------------------------------------------------------------------
# Интерактивный ввод параметров установки
# ---------------------------------------------------------------------------

# Запрашивает домен панели
ask_domain() {
    echo
    read -rp "$(tr ask_domain)" DOMAIN
    DOMAIN="${DOMAIN,,}" # приводим к нижнему регистру
    if [[ ! "${DOMAIN}" =~ ^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$ ]] || [[ "${DOMAIN}" != *.* ]]; then
        fail "$(tr err_domain "${DOMAIN}")"
    fi
}

# Запрашивает email для Let's Encrypt
ask_email() {
    read -rp "$(tr ask_email)" EMAIL
    if [[ ! "${EMAIL}" =~ ^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$ ]]; then
        fail "$(tr err_email "${EMAIL}")"
    fi
}

# Запрашивает логин администратора (латиница + цифры)
ask_admin_login() {
    read -rp "$(tr ask_login)" ADMIN_LOGIN
    if [[ ! "${ADMIN_LOGIN}" =~ ^[A-Za-z0-9_]{3,32}$ ]]; then
        fail "$(tr err_login)"
    fi
}

# Запрашивает пароль администратора с проверкой сложности
ask_admin_password() {
    while true; do
        read -rsp "$(tr ask_pass)" ADMIN_PASSWORD
        echo
        if [[ ${#ADMIN_PASSWORD} -lt 8 ]]; then
            warn "$(tr pass_short)"
            continue
        fi
        # Требуем хотя бы букву и цифру для базовой стойкости
        if [[ ! "${ADMIN_PASSWORD}" =~ [A-Za-z] ]] || [[ ! "${ADMIN_PASSWORD}" =~ [0-9] ]]; then
            warn "$(tr pass_weak)"
            continue
        fi
        read -rsp "$(tr ask_pass2)" ADMIN_PASSWORD2
        echo
        if [[ "${ADMIN_PASSWORD}" != "${ADMIN_PASSWORD2}" ]]; then
            warn "$(tr pass_mismatch)"
            continue
        fi
        break
    done
}

# Определяет внешний IP и предлагает переопределить при необходимости
ask_server_ip() {
    local detected=""
    detected="$(curl -fsSL --max-time 10 https://api.ipify.org 2>/dev/null || true)"
    if [[ -z "${detected}" ]]; then
        detected="$(curl -fsSL --max-time 10 https://ifconfig.me 2>/dev/null || true)"
    fi
    if [[ -n "${detected}" ]]; then
        read -rp "$(tr ask_ip "${detected}")" SERVER_IP
        SERVER_IP="${SERVER_IP:-${detected}}"
    else
        read -rp "$(tr ask_ip_manual)" SERVER_IP
    fi
    if [[ ! "${SERVER_IP}" =~ ^[0-9]{1,3}(\.[0-9]{1,3}){3}$ ]]; then
        fail "$(tr err_ip "${SERVER_IP}")"
    fi
}

# ---------------------------------------------------------------------------
# Проверка DNS: домен должен указывать на этот сервер до выпуска SSL
# ---------------------------------------------------------------------------
check_dns() {
    step "$(tr step_dns)"
    local resolved=""
    resolved="$(getent ahostsv4 "${DOMAIN}" 2>/dev/null | awk 'NR==1{print $1}' || true)"
    if [[ -z "${resolved}" ]]; then
        warn "$(tr warn_dns1 "${DOMAIN}")"
        read -rp "$(tr ask_dns1)" ans
        [[ "${ans,,}" == "y" ]] || fail "$(tr err_dns1 "${SERVER_IP}")"
        return
    fi
    if [[ "${resolved}" != "${SERVER_IP}" ]]; then
        warn "$(tr warn_dns2 "${DOMAIN}" "${resolved}" "${SERVER_IP}")"
        read -rp "$(tr ask_dns2)" ans
        [[ "${ans,,}" == "y" ]] || fail "$(tr err_dns2)"
        return
    fi
    ok "$(tr ok_dns "${DOMAIN}" "${SERVER_IP}")"
}

# ---------------------------------------------------------------------------
# Установка зависимостей ОС
# ---------------------------------------------------------------------------
install_dependencies() {
    step "$(tr step_deps)"
    export DEBIAN_FRONTEND=noninteractive
    apt-get -o DPkg::Lock::Timeout=600 update -qq
    apt-get -o DPkg::Lock::Timeout=600 install -y -qq \
        curl ca-certificates git jq unzip ufw nginx sqlite3 \
        dnsutils openssl cron logrotate

    # Node.js LTS через NodeSource (если не установлен нужной версии)
    if ! command -v node >/dev/null 2>&1 || [[ "$(node -v | cut -d. -f1 | command tr -d v)" -lt ${NODE_MAJOR} ]]; then
        info "$(tr info_node "${NODE_MAJOR}")"
        curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash -
        apt-get -o DPkg::Lock::Timeout=600 install -y -qq nodejs
    fi
    ok "$(tr ok_node "$(node -v)" "$(npm -v)")"

    # Caddy из официального репозитория
    if ! command -v caddy >/dev/null 2>&1; then
        info "$(tr info_caddy)"
        apt-get -o DPkg::Lock::Timeout=600 install -y -qq debian-keyring debian-archive-keyring apt-transport-https
        curl -fsSL "https://dl.cloudsmith.io/public/caddy/stable/gpg.key" \
            | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
        echo "deb [signed-by=/usr/share/keyrings/caddy-stable-archive-keyring.gpg] https://dl.cloudsmith.io/public/caddy/stable/deb/debian any-version main" \
            > /etc/apt/sources.list.d/caddy-stable.list
        apt-get -o DPkg::Lock::Timeout=600 update -qq
        apt-get -o DPkg::Lock::Timeout=600 install -y -qq caddy
    fi
    ok "$(tr ok_caddy "$(caddy version | awk '{print $1}')")"
}

# ---------------------------------------------------------------------------
# Загрузка исходников панели
# ---------------------------------------------------------------------------
fetch_panel_sources() {
    step "$(tr step_fetch)"
    if [[ -d "${INSTALL_DIR}/.git" ]]; then
        info "$(tr info_fetch_upd)"
        git -C "${INSTALL_DIR}" pull --ff-only
    elif [[ -d "${INSTALL_DIR}" && -n "$(ls -A "${INSTALL_DIR}" 2>/dev/null)" ]]; then
        # Запуск из локальной копии (например, при разработке)
        info "$(tr info_fetch_local "${INSTALL_DIR}")"
    else
        git clone --depth 1 "${PANEL_REPO}" "${INSTALL_DIR}"
    fi
    ok "$(tr ok_fetch "${INSTALL_DIR}")"
}

# ---------------------------------------------------------------------------
# Генерация секретов и сохранение конфигурации
# ---------------------------------------------------------------------------
generate_secrets() {
    step "$(tr step_secrets)"
    mkdir -p "${CONFIG_DIR}" "${DATA_DIR}/website" "${BACKUP_DIR}" "${LOG_DIR}"

    # Повторная установка: сохраняем существующие секреты и путь админки,
    # чтобы не инвалидировать сессии и ссылку на панель
    local old_admin_path="" old_api_token="" old_jwt=""
    if [[ -f "${CONFIG_DIR}/install.env" ]]; then
        old_admin_path="$(grep -oP '^ADMIN_PATH="\K[^"]+' "${CONFIG_DIR}/install.env" 2>/dev/null || true)"
        old_api_token="$(grep -oP '^TELEMT_API_TOKEN="\K[^"]+' "${CONFIG_DIR}/install.env" 2>/dev/null || true)"
        old_jwt="$(grep -oP '^JWT_SECRET=\K.*' "${INSTALL_DIR}/panel/backend/.env" 2>/dev/null || true)"
    fi

    # Токен Telemt Control API — случайный, только для loopback
    TELEMT_API_TOKEN="${old_api_token:-$(openssl rand -hex 32)}"
    # Секрет JWT для сессий панели
    JWT_SECRET="${old_jwt:-$(openssl rand -hex 48)}"
    # Секретный путь админки — затрудняет перебор (не /admin)
    ADMIN_PATH="${old_admin_path:-cp-$(openssl rand -hex 6)}"
    # Домен маскировки Fake-TLS по умолчанию (можно сменить в настройках)
    MASK_DOMAIN="www.cloudflare.com"
    # Версия панели
    PANEL_VERSION="$(cat "${INSTALL_DIR}/VERSION" 2>/dev/null || echo '1.0.0')"

    # Сохраняем конфигурацию установки (используется скриптами и панелью)
    cat > "${CONFIG_DIR}/install.env" <<EOF
# Конфигурация установки TGGATE (сгенерировано install.sh)
DOMAIN="${DOMAIN}"
EMAIL="${EMAIL}"
LANGUAGE="${INSTALL_LANG}"
SERVER_IP="${SERVER_IP}"
ADMIN_LOGIN="${ADMIN_LOGIN}"
ADMIN_PATH="${ADMIN_PATH}"
PANEL_PORT="${PANEL_PORT}"
TELEMT_API_PORT="${TELEMT_API_PORT}"
TELEMT_WEB_PORT="${TELEMT_WEB_PORT}"
MTPROTO_PORT="${MTPROTO_PORT}"
NGINX_LOCAL_PORT="${NGINX_LOCAL_PORT}"
MASK_DOMAIN="${MASK_DOMAIN}"
PANEL_VERSION="${PANEL_VERSION}"
TELEMT_API_TOKEN="${TELEMT_API_TOKEN}"
INSTALL_DIR="${INSTALL_DIR}"
CONFIG_DIR="${CONFIG_DIR}"
DATA_DIR="${DATA_DIR}"
BACKUP_DIR="${BACKUP_DIR}"
LOG_DIR="${LOG_DIR}"
EOF
    chmod 600 "${CONFIG_DIR}/install.env"

    # Приватный .env для backend (секреты — только root)
    cat > "${INSTALL_DIR}/panel/backend/.env" <<EOF
# Секреты панели TGGATE — НЕ публиковать!
NODE_ENV=production
PORT=${PANEL_PORT}
DOMAIN=${DOMAIN}
SERVER_IP=${SERVER_IP}
ADMIN_PATH=${ADMIN_PATH}
JWT_SECRET=${JWT_SECRET}
TELEMT_API_URL=http://127.0.0.1:${TELEMT_API_PORT}
TELEMT_API_AUTH=Bearer ${TELEMT_API_TOKEN}
TELEMT_CONFIG=${CONFIG_DIR}/telemt.toml
DB_PATH=${DATA_DIR}/tggate.db
DATA_DIR=${DATA_DIR}
BACKUP_DIR=${BACKUP_DIR}
LOG_DIR=${LOG_DIR}
MTPROTO_PORT=${MTPROTO_PORT}
EOF
    chmod 600 "${INSTALL_DIR}/panel/backend/.env"
    ok "$(tr ok_secrets "${CONFIG_DIR}")"
}

# ---------------------------------------------------------------------------
# Подготовка сайта-заглушки по умолчанию
# ---------------------------------------------------------------------------
install_default_website() {
    step "$(tr step_website)"
    if [[ -d "${INSTALL_DIR}/templates/websites/repair" ]]; then
        cp -r "${INSTALL_DIR}/templates/websites/repair/." "${DATA_DIR}/website/"
    else
        echo '<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>Сайт на ремонте</title></head><body><h1>Технические работы</h1></body></html>' \
            > "${DATA_DIR}/website/index.html"
    fi
    ok "$(tr ok_website "${DATA_DIR}/website")"
}

# ---------------------------------------------------------------------------
# Установка панели: зависимости backend, сборка frontend
# ---------------------------------------------------------------------------
install_panel() {
    step "$(tr step_panel)"
    cd "${INSTALL_DIR}/panel/backend"
    npm install --omit=dev --no-audit --no-fund

    cd "${INSTALL_DIR}/panel/frontend"
    npm install --no-audit --no-fund
    npm run build

    # Служебный пользователь для запуска панели (минимальные права)
    if ! id -u tggate >/dev/null 2>&1; then
        useradd --system --home "${INSTALL_DIR}" --shell /usr/sbin/nologin tggate
    fi
    chown -R tggate:tggate "${INSTALL_DIR}/panel" "${DATA_DIR}" "${LOG_DIR}" "${BACKUP_DIR}"

    # Совместный доступ к конфигам: панель (tggate) редактирует telemt.toml,
    # telemt его читает. install.env с секретами остаётся только для root.
    usermod -aG tggate telemt 2>/dev/null || true
    chgrp -R tggate "${CONFIG_DIR}"
    chmod 2775 "${CONFIG_DIR}"
    chmod 664 "${CONFIG_DIR}/telemt.toml" 2>/dev/null || true
    chmod 600 "${CONFIG_DIR}/install.env"
    ok "$(tr ok_panel)"
}

# ---------------------------------------------------------------------------
# Systemd-сервисы
# ---------------------------------------------------------------------------
install_systemd() {
    step "$(tr step_systemd)"
    cp "${INSTALL_DIR}/systemd/telemt.service" /etc/systemd/system/telemt.service
    cp "${INSTALL_DIR}/systemd/tggate-panel.service" /etc/systemd/system/tggate-panel.service
    systemctl daemon-reload
    systemctl enable telemt tggate-panel caddy nginx
    systemctl restart telemt tggate-panel caddy nginx
    ok "$(tr ok_systemd)"
}

# ---------------------------------------------------------------------------
# Создание учётной записи администратора в панели
# ---------------------------------------------------------------------------
create_admin() {
    step "$(tr step_admin)"
    # Ждём запуска backend
    local tries=0
    until curl -fsS "http://127.0.0.1:${PANEL_PORT}/api/health" >/dev/null 2>&1; do
        tries=$((tries + 1))
        [[ ${tries} -gt 30 ]] && fail "$(tr err_admin_timeout)"
        sleep 1
    done
    # Внутренний эндпоинт первичной инициализации (работает только с loopback).
    # При повторной установке админ уже существует (409) — это нормально, пропускаем.
    local response http_code
    response="$(curl -sS -X POST "http://127.0.0.1:${PANEL_PORT}/api/internal/setup-admin" \
        -H "Content-Type: application/json" \
        -d "{\"login\":\"${ADMIN_LOGIN}\",\"password\":\"${ADMIN_PASSWORD}\"}" \
        -w $'\n%{http_code}' 2>&1)" || fail "$(tr err_admin_create "${response}")"
    http_code="$(echo "${response}" | tail -n1)"
    if [[ "${http_code}" == "409" ]]; then
        ok "$(tr ok_admin_exists)"
        info "$(tr info_admin_change)"
    elif [[ "${http_code}" == "201" ]]; then
        ok "$(tr ok_admin_created "${ADMIN_LOGIN}")"
    else
        fail "$(tr err_admin_http "${http_code}" "${response}")"
    fi
}

# ---------------------------------------------------------------------------
# Команда управления sudo TGGATE + sudo-правила для обновлений
# ---------------------------------------------------------------------------
install_cli() {
    step "$(tr step_cli)"
    cp "${INSTALL_DIR}/tggate.sh" /usr/local/bin/TGGATE
    chmod +x /usr/local/bin/TGGATE

    # Привилегированный хелпер обновлений (вместо хрупкого sudo):
    # root-сервис на 127.0.0.1:9443, панель командует ему по секрету.
    bash "${INSTALL_DIR}/scripts/install-helper.sh"

    ok "$(tr ok_cli)"
}

# ---------------------------------------------------------------------------
# Cron-задача автопроверки обновлений
# ---------------------------------------------------------------------------
install_cron() {
    step "$(tr step_cron)"
    # Скрипт запускается прямо из репозитория — при обновлении кода cron
    # автоматически использует свежую версию
    echo "0 4 * * * root ${INSTALL_DIR}/scripts/check-updates.sh >/dev/null 2>&1" > /etc/cron.d/tggate-updates
    ok "$(tr ok_cron)"
}

# ---------------------------------------------------------------------------
# Итоговая информация для пользователя
# ---------------------------------------------------------------------------
print_summary() {
    echo
    echo -e "${C_GREEN}${C_BOLD}╔══════════════════════════════════════════════════════════════╗${C_RESET}"
    echo -e "${C_GREEN}${C_BOLD}║          $(tr sum_title)${C_RESET}"
    echo -e "${C_GREEN}${C_BOLD}╚══════════════════════════════════════════════════════════════╝${C_RESET}"
    echo
    echo -e "  $(tr sum_panel) ${C_CYAN}https://${DOMAIN}/${ADMIN_PATH}/${C_RESET}"
    echo -e "  $(tr sum_login)             ${C_CYAN}${ADMIN_LOGIN}${C_RESET}"
    echo -e "  $(tr sum_pass)"
    echo
    echo -e "  $(tr sum_mtproto)      ${C_CYAN}${MTPROTO_PORT}${C_RESET}"
    echo -e "  $(tr sum_web)         ${C_CYAN}https://${DOMAIN}${C_RESET}$(tr sum_via)"
    echo
    echo -e "  $(tr sum_manage)        ${C_CYAN}sudo TGGATE${C_RESET}"
    echo -e "  $(tr sum_config)      ${CONFIG_DIR}"
    echo -e "  $(tr sum_backups)            ${BACKUP_DIR}"
    echo
    warn "$(tr warn_save_path)"
}

# ---------------------------------------------------------------------------
# Точка входа
# ---------------------------------------------------------------------------
main() {
    echo -e "${C_CYAN}${C_BOLD}"
    echo "  ╔═══════════════════════════════════════╗"
    echo "  ║   TGGATE — Telegram Gate              ║"
    echo "  $(tr banner2)"
    echo "  ╚═══════════════════════════════════════╝"
    echo -e "${C_RESET}"

    ask_language
    check_root
    check_os
    check_ports_free

    step "$(tr step_params)"
    ask_domain
    ask_email
    ask_admin_login
    ask_admin_password
    ask_server_ip

    check_dns
    install_dependencies
    fetch_panel_sources
    generate_secrets

    # Шаги из отдельных скриптов (с передачей параметров через окружение)
    source "${CONFIG_DIR}/install.env"
    bash "${INSTALL_DIR}/scripts/setup_firewall.sh"
    bash "${INSTALL_DIR}/scripts/install_telemt.sh"
    install_default_website
    bash "${INSTALL_DIR}/scripts/install_nginx.sh"
    bash "${INSTALL_DIR}/scripts/install_caddy.sh"

    install_panel
    install_systemd
    create_admin
    install_cli
    install_cron

    print_summary
}

main "$@"
