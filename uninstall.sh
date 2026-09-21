#!/usr/bin/env bash
#
# =============================================================================
# TGGATE — Полное удаление панели и всех компонентов
# ВНИМАНИЕ: необратимая операция! Бэкапы в /var/backups/tggate сохраняются.
# =============================================================================

set -euo pipefail

if [[ "${EUID}" -ne 0 ]]; then
    echo "Запустите с правами root: sudo bash uninstall.sh" >&2
    exit 1
fi

echo "════════════════════════════════════════════"
echo "  УДАЛЕНИЕ TGGATE"
echo "════════════════════════════════════════════"
read -rp "Вы уверены? Все данные будут удалены! [y/N]: " ans
[[ "${ans,,}" == "y" ]] || { echo "Отменено."; exit 0; }

read -rp "Создать финальный бэкап перед удалением? [Y/n]: " backup_ans
if [[ "${backup_ans,,}" != "n" ]]; then
    mkdir -p /var/backups/tggate
    tar -czf "/var/backups/tggate/final-backup-$(date +%Y%m%d-%H%M%S).tar.gz" \
        -C / etc/tggate var/lib/tggate 2>/dev/null || true
    echo "Финальный бэкап сохранён в /var/backups/tggate/"
fi

echo "[1/7] Остановка и отключение сервисов..."
systemctl stop tggate-panel telemt 2>/dev/null || true
systemctl disable tggate-panel telemt 2>/dev/null || true
rm -f /etc/systemd/system/tggate-panel.service /etc/systemd/system/telemt.service
systemctl daemon-reload

echo "[2/7] Удаление Telemt..."
rm -f /usr/local/bin/telemt /usr/local/bin/telemt.bak
userdel telemt 2>/dev/null || true
rm -rf /var/lib/telemt

echo "[3/7] Удаление конфигураций Nginx/Caddy..."
rm -f /etc/nginx/sites-enabled/tggate.conf /etc/nginx/sites-available/tggate.conf
rm -f /etc/nginx/conf.d/tggate-map.conf
rm -f /etc/caddy/Caddyfile
systemctl reload nginx caddy 2>/dev/null || true

echo "[4/7] Удаление cron-задач..."
rm -f /etc/cron.d/tggate-updates
rm -f /etc/nginx/tggate-telemt-proxy.inc
systemctl stop tggate-helper 2>/dev/null || true
systemctl disable tggate-helper 2>/dev/null || true
rm -f /etc/systemd/system/tggate-helper.service
systemctl daemon-reload
echo "[5/7] Удаление команды управления..."
rm -f /usr/local/bin/TGGATE

echo "[6/7] Удаление файлов панели..."
rm -rf /opt/tggate /etc/tggate /var/lib/tggate /var/log/tggate
userdel tggate 2>/dev/null || true

echo "[7/7] Удаление правил файрвола..."
ufw delete allow 8443/tcp 2>/dev/null || true

echo
echo "════════════════════════════════════════════"
echo "  TGGATE полностью удалён."
echo "  Бэкапы сохранены в /var/backups/tggate/"
echo "  Nginx, Caddy и Node.js не удалялись."
echo "════════════════════════════════════════════"
