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
# Проверки окружения
# ---------------------------------------------------------------------------

# Проверяет, что скрипт запущен от root
check_root() {
    if [[ "${EUID}" -ne 0 ]]; then
        fail "Скрипт должен быть запущен от root. Используйте: sudo bash install.sh"
    fi
}

# Проверяет поддерживаемую версию ОС (Ubuntu 22.04+ / 24.04+)
check_os() {
    if [[ ! -f /etc/os-release ]]; then
        fail "Не удалось определить ОС. Поддерживается только Ubuntu 22.04+ / 24.04+."
    fi
    # shellcheck source=/dev/null
    source /etc/os-release
    if [[ "${ID}" != "ubuntu" ]]; then
        fail "Поддерживается только Ubuntu. Обнаружено: ${ID}. Для других ОС установка не проверялась."
    fi
    local major="${VERSION_ID%%.*}"
    if [[ "${major}" -lt 22 ]]; then
        fail "Требуется Ubuntu 22.04 или новее. Обнаружено: ${VERSION_ID}."
    fi
    ok "ОС: Ubuntu ${VERSION_ID}"
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
        fail "Порты ${busy[*]} уже заняты другими сервисами. Остановите их или используйте чистый VPS."
    fi
    ok "Порты 80/443 свободны"
}

# ---------------------------------------------------------------------------
# Интерактивный ввод параметров установки
# ---------------------------------------------------------------------------

# Запрашивает домен панели
ask_domain() {
    echo
    read -rp "🌐 Домен для панели (например, proxy.example.com): " DOMAIN
    DOMAIN="${DOMAIN,,}" # приводим к нижнему регистру
    if [[ ! "${DOMAIN}" =~ ^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$ ]] || [[ "${DOMAIN}" != *.* ]]; then
        fail "Некорректный домен: '${DOMAIN}'. Укажите FQDN, например proxy.example.com"
    fi
}

# Запрашивает email для Let's Encrypt
ask_email() {
    read -rp "📧 Email для SSL-сертификата Let's Encrypt: " EMAIL
    if [[ ! "${EMAIL}" =~ ^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$ ]]; then
        fail "Некорректный email: '${EMAIL}'"
    fi
}

# Запрашивает логин администратора (латиница + цифры)
ask_admin_login() {
    read -rp "👤 Логин администратора (латиница и цифры): " ADMIN_LOGIN
    if [[ ! "${ADMIN_LOGIN}" =~ ^[A-Za-z0-9_]{3,32}$ ]]; then
        fail "Логин должен содержать только латиницу, цифры и '_' (3-32 символа)."
    fi
}

# Запрашивает пароль администратора с проверкой сложности
ask_admin_password() {
    while true; do
        read -rsp "🔑 Пароль администратора (минимум 8 символов): " ADMIN_PASSWORD
        echo
        if [[ ${#ADMIN_PASSWORD} -lt 8 ]]; then
            warn "Пароль слишком короткий (минимум 8 символов). Попробуйте ещё раз."
            continue
        fi
        # Требуем хотя бы букву и цифру для базовой стойкости
        if [[ ! "${ADMIN_PASSWORD}" =~ [A-Za-z] ]] || [[ ! "${ADMIN_PASSWORD}" =~ [0-9] ]]; then
            warn "Пароль должен содержать буквы и цифры. Попробуйте ещё раз."
            continue
        fi
        read -rsp "🔑 Повторите пароль: " ADMIN_PASSWORD2
        echo
        if [[ "${ADMIN_PASSWORD}" != "${ADMIN_PASSWORD2}" ]]; then
            warn "Пароли не совпадают. Попробуйте ещё раз."
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
        read -rp "🌍 Внешний IP VPS [${detected}] (Enter — оставить): " SERVER_IP
        SERVER_IP="${SERVER_IP:-${detected}}"
    else
        read -rp "🌍 Не удалось определить внешний IP автоматически. Введите вручную: " SERVER_IP
    fi
    if [[ ! "${SERVER_IP}" =~ ^[0-9]{1,3}(\.[0-9]{1,3}){3}$ ]]; then
        fail "Некорректный IP-адрес: '${SERVER_IP}'"
    fi
}

# ---------------------------------------------------------------------------
# Проверка DNS: домен должен указывать на этот сервер до выпуска SSL
# ---------------------------------------------------------------------------
check_dns() {
    step "Проверка DNS"
    local resolved=""
    resolved="$(getent ahostsv4 "${DOMAIN}" 2>/dev/null | awk 'NR==1{print $1}' || true)"
    if [[ -z "${resolved}" ]]; then
        warn "Домен ${DOMAIN} не резолвится (нет A-записи)."
        read -rp "Продолжить установку без проверки DNS? SSL может не выпуститься. [y/N]: " ans
        [[ "${ans,,}" == "y" ]] || fail "Настройте A-запись домена на ${SERVER_IP} и запустите установку снова."
        return
    fi
    if [[ "${resolved}" != "${SERVER_IP}" ]]; then
        warn "Домен ${DOMAIN} указывает на ${resolved}, а внешний IP сервера — ${SERVER_IP}."
        read -rp "Продолжить всё равно? [y/N]: " ans
        [[ "${ans,,}" == "y" ]] || fail "Исправьте A-запись домена и запустите установку снова."
        return
    fi
    ok "DNS настроен корректно: ${DOMAIN} → ${SERVER_IP}"
}

# ---------------------------------------------------------------------------
# Установка зависимостей ОС
# ---------------------------------------------------------------------------
install_dependencies() {
    step "Установка системных зависимостей"
    export DEBIAN_FRONTEND=noninteractive
    apt-get -o DPkg::Lock::Timeout=600 update -qq
    apt-get -o DPkg::Lock::Timeout=600 install -y -qq \
        curl ca-certificates git jq unzip ufw nginx sqlite3 \
        dnsutils openssl cron logrotate

    # Node.js LTS через NodeSource (если не установлен нужной версии)
    if ! command -v node >/dev/null 2>&1 || [[ "$(node -v | cut -d. -f1 | tr -d v)" -lt ${NODE_MAJOR} ]]; then
        info "Устанавливаю Node.js ${NODE_MAJOR}.x LTS..."
        curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash -
        apt-get -o DPkg::Lock::Timeout=600 install -y -qq nodejs
    fi
    ok "Node.js $(node -v), npm $(npm -v)"

    # Caddy из официального репозитория
    if ! command -v caddy >/dev/null 2>&1; then
        info "Устанавливаю Caddy..."
        apt-get -o DPkg::Lock::Timeout=600 install -y -qq debian-keyring debian-archive-keyring apt-transport-https
        curl -fsSL "https://dl.cloudsmith.io/public/caddy/stable/gpg.key" \
            | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
        echo "deb [signed-by=/usr/share/keyrings/caddy-stable-archive-keyring.gpg] https://dl.cloudsmith.io/public/caddy/stable/deb/debian any-version main" \
            > /etc/apt/sources.list.d/caddy-stable.list
        apt-get -o DPkg::Lock::Timeout=600 update -qq
        apt-get -o DPkg::Lock::Timeout=600 install -y -qq caddy
    fi
    ok "Caddy $(caddy version | awk '{print $1}')"
}

# ---------------------------------------------------------------------------
# Загрузка исходников панели
# ---------------------------------------------------------------------------
fetch_panel_sources() {
    step "Загрузка исходников TGGATE"
    if [[ -d "${INSTALL_DIR}/.git" ]]; then
        info "Репозиторий уже существует, обновляю..."
        git -C "${INSTALL_DIR}" pull --ff-only
    elif [[ -d "${INSTALL_DIR}" && -n "$(ls -A "${INSTALL_DIR}" 2>/dev/null)" ]]; then
        # Запуск из локальной копии (например, при разработке)
        info "Использую локальные исходники в ${INSTALL_DIR}"
    else
        git clone --depth 1 "${PANEL_REPO}" "${INSTALL_DIR}"
    fi
    ok "Исходники размещены в ${INSTALL_DIR}"
}

# ---------------------------------------------------------------------------
# Генерация секретов и сохранение конфигурации
# ---------------------------------------------------------------------------
generate_secrets() {
    step "Генерация секретов"
    mkdir -p "${CONFIG_DIR}" "${DATA_DIR}/website" "${BACKUP_DIR}" "${LOG_DIR}"

    # Токен Telemt Control API — случайный, только для loopback
    TELEMT_API_TOKEN="$(openssl rand -hex 32)"
    # Секрет JWT для сессий панели
    JWT_SECRET="$(openssl rand -hex 48)"
    # Секретный путь админки — затрудняет перебор (не /admin)
    ADMIN_PATH="cp-$(openssl rand -hex 6)"
    # Домен маскировки Fake-TLS по умолчанию (можно сменить в настройках)
    MASK_DOMAIN="www.cloudflare.com"
    # Версия панели
    PANEL_VERSION="$(cat "${INSTALL_DIR}/VERSION" 2>/dev/null || echo '1.0.0')"

    # Сохраняем конфигурацию установки (используется скриптами и панелью)
    cat > "${CONFIG_DIR}/install.env" <<EOF
# Конфигурация установки TGGATE (сгенерировано install.sh)
DOMAIN="${DOMAIN}"
EMAIL="${EMAIL}"
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
    ok "Секреты сгенерированы, конфигурация сохранена в ${CONFIG_DIR}"
}

# ---------------------------------------------------------------------------
# Подготовка сайта-заглушки по умолчанию
# ---------------------------------------------------------------------------
install_default_website() {
    step "Установка сайта-заглушки"
    if [[ -d "${INSTALL_DIR}/templates/websites/repair" ]]; then
        cp -r "${INSTALL_DIR}/templates/websites/repair/." "${DATA_DIR}/website/"
    else
        echo '<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>Сайт на ремонте</title></head><body><h1>Технические работы</h1></body></html>' \
            > "${DATA_DIR}/website/index.html"
    fi
    ok "Заглушка размещена в ${DATA_DIR}/website"
}

# ---------------------------------------------------------------------------
# Установка панели: зависимости backend, сборка frontend
# ---------------------------------------------------------------------------
install_panel() {
    step "Установка панели управления"
    cd "${INSTALL_DIR}/panel/backend"
    npm install --omit=dev --no-audit --no-fund

    cd "${INSTALL_DIR}/panel/frontend"
    npm install --no-audit --no-fund
    npm run build

    # Служебный пользователь для запуска панели (минимальные права)
    if ! id -u tggate >/dev/null 2>&1; then
        useradd --system --home "${INSTALL_DIR}" --shell /usr/sbin/nologin tggate
    fi
    chown -R tggate:tggate "${INSTALL_DIR}/panel" "${DATA_DIR}" "${LOG_DIR}"
    ok "Панель установлена и собрана"
}

# ---------------------------------------------------------------------------
# Systemd-сервисы
# ---------------------------------------------------------------------------
install_systemd() {
    step "Настройка systemd"
    cp "${INSTALL_DIR}/systemd/telemt.service" /etc/systemd/system/telemt.service
    cp "${INSTALL_DIR}/systemd/tggate-panel.service" /etc/systemd/system/tggate-panel.service
    systemctl daemon-reload
    systemctl enable telemt tggate-panel caddy nginx
    systemctl restart telemt tggate-panel caddy nginx
    ok "Сервисы запущены: telemt, tggate-panel, caddy, nginx"
}

# ---------------------------------------------------------------------------
# Создание учётной записи администратора в панели
# ---------------------------------------------------------------------------
create_admin() {
    step "Создание администратора"
    # Ждём запуска backend
    local tries=0
    until curl -fsS "http://127.0.0.1:${PANEL_PORT}/api/health" >/dev/null 2>&1; do
        tries=$((tries + 1))
        [[ ${tries} -gt 30 ]] && fail "Панель не запустилась за 30 секунд. Смотрите: journalctl -u tggate-panel"
        sleep 1
    done
    # Внутренний эндпоинт первичной инициализации (работает только с loopback).
    # При повторной установке админ уже существует (409) — это нормально, пропускаем.
    local response http_code
    response="$(curl -sS -X POST "http://127.0.0.1:${PANEL_PORT}/api/internal/setup-admin" \
        -H "Content-Type: application/json" \
        -d "{\"login\":\"${ADMIN_LOGIN}\",\"password\":\"${ADMIN_PASSWORD}\"}" \
        -w $'\n%{http_code}' 2>&1)" || fail "Не удалось создать администратора: ${response}"
    http_code="$(echo "${response}" | tail -n1)"
    if [[ "${http_code}" == "409" ]]; then
        ok "Администратор уже существует — пропускаю"
        info "Если нужно сменить логин/пароль: sudo TGGATE → пункт 6"
    elif [[ "${http_code}" == "201" ]]; then
        ok "Администратор '${ADMIN_LOGIN}' создан"
    else
        fail "Не удалось создать администратора (HTTP ${http_code}): ${response}"
    fi
}

# ---------------------------------------------------------------------------
# Команда управления sudo TGGATE
# ---------------------------------------------------------------------------
install_cli() {
    step "Установка команды управления TGGATE"
    cp "${INSTALL_DIR}/tggate.sh" /usr/local/bin/TGGATE
    chmod +x /usr/local/bin/TGGATE
    ok "Команда управления: sudo TGGATE"
}

# ---------------------------------------------------------------------------
# Cron-задача автопроверки обновлений
# ---------------------------------------------------------------------------
install_cron() {
    step "Настройка автопроверки обновлений"
    cp "${INSTALL_DIR}/scripts/check-updates.sh" /usr/local/bin/tggate-check-updates
    chmod +x /usr/local/bin/tggate-check-updates
    # По умолчанию — раз в сутки в 04:00 (меняется в настройках панели)
    echo "0 4 * * * root /usr/local/bin/tggate-check-updates >/dev/null 2>&1" > /etc/cron.d/tggate-updates
    ok "Cron-задача добавлена"
}

# ---------------------------------------------------------------------------
# Итоговая информация для пользователя
# ---------------------------------------------------------------------------
print_summary() {
    echo
    echo -e "${C_GREEN}${C_BOLD}╔══════════════════════════════════════════════════════════════╗${C_RESET}"
    echo -e "${C_GREEN}${C_BOLD}║          TGGATE успешно установлен!                          ║${C_RESET}"
    echo -e "${C_GREEN}${C_BOLD}╚══════════════════════════════════════════════════════════════╝${C_RESET}"
    echo
    echo -e "  🌐 Панель управления:  ${C_CYAN}https://${DOMAIN}/${ADMIN_PATH}/${C_RESET}"
    echo -e "  👤 Логин:              ${C_CYAN}${ADMIN_LOGIN}${C_RESET}"
    echo -e "  🔑 Пароль:             (тот, что вы ввели при установке)"
    echo
    echo -e "  🔌 MTProto порт:       ${C_CYAN}${MTPROTO_PORT}${C_RESET}"
    echo -e "  🌐 Web Proxy:          ${C_CYAN}https://${DOMAIN}${C_RESET} (через Telemt)"
    echo
    echo -e "  🛠  Управление:         ${C_CYAN}sudo TGGATE${C_RESET}"
    echo -e "  📁 Конфигурация:       ${CONFIG_DIR}"
    echo -e "  📦 Бэкапы:             ${BACKUP_DIR}"
    echo
    warn "Сохраните секретный путь админки — без него вход в панель невозможен!"
}

# ---------------------------------------------------------------------------
# Точка входа
# ---------------------------------------------------------------------------
main() {
    echo -e "${C_CYAN}${C_BOLD}"
    echo "  ╔═══════════════════════════════════════╗"
    echo "  ║   TGGATE — Telegram Gate              ║"
    echo "  ║   Установка панели управления         ║"
    echo "  ╚═══════════════════════════════════════╝"
    echo -e "${C_RESET}"

    check_root
    check_os
    check_ports_free

    step "Параметры установки"
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
