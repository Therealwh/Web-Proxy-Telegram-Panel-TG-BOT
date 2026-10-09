#!/usr/bin/env bash
# TGGATE — рестарт панели по команде из UI (только через root-хелпер)
set -euo pipefail
systemctl restart tggate-panel
systemctl is-active --quiet tggate-panel
