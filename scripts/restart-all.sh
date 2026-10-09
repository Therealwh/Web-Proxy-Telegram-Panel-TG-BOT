#!/usr/bin/env bash
# TGGATE — полный рестарт стека: Telemt → панель → nginx → Caddy (через root-хелпер)
set -euo pipefail
systemctl restart telemt
systemctl restart nginx
systemctl restart caddy
systemctl restart tggate-panel
systemctl is-active --quiet tggate-panel
