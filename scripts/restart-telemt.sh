#!/usr/bin/env bash
#
# =============================================================================
# TGGATE — перезапуск Telemt по команде DC-монитора (только через root-хелпер:
# scripts/helper.js, ключ restart-telemt). Руками не запускать.
# =============================================================================

set -euo pipefail

systemctl restart telemt
systemctl is-active --quiet telemt
