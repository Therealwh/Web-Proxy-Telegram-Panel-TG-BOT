#!/usr/bin/env bash
# Чтение конфига Telemt для TOML-редактора панели (root читает файл с секретами).
echo "=== Активные лимиты из /etc/tggate/telemt.toml ==="
cat /etc/tggate/telemt.toml
