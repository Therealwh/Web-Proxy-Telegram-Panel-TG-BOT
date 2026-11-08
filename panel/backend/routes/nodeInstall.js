/**
 * @fileoverview Публичный установщик узла (/node-install.sh?token=...).
 * Запускается админом на новом сервере: ставит Telemt + Caddy, генерирует
 * токен Control API, регистрирует узел обратно в панели.
 * @module routes/nodeInstall
 */

const express = require('express');
const rateLimit = require('express-rate-limit');

const router = express.Router();

const limiter = rateLimit({ windowMs: 60 * 1000, max: 10, standardHeaders: true, legacyHeaders: false });

router.get('/node-install.sh', limiter, (req, res) => {
    const token = String(req.query.token || '');
    // Токен: только hex 64 — защита от инъекций в тело скрипта
    if (!/^[0-9a-f]{64}$/.test(token)) {
        res.status(400).type('text').send('# Некорректный токен установки\n');
        return;
    }

    const script = `#!/usr/bin/env bash
# =============================================================================
# TGGATE — автоустановка узла (Telemt + Caddy). Сгенерировано панелью.
# Токен одноразовый: скрипт скачивает параметры установки у панели и
# регистрирует узел обратно. Запускать от root.
# =============================================================================
set -euo pipefail

TOKEN="${token}"
PANEL="\${PANEL:-}"          # можно переопределить: PANEL=https://домен bash node-install.sh
ARCH="$(uname -m)"
[[ "$ARCH" == "x86_64" || "$ARCH" == "aarch64" ]] || { echo "Неподдерживаемая архитектура: $ARCH"; exit 1; }

command -v curl >/dev/null || apt-get update -qq && apt-get install -y -qq curl jq ufw >/dev/null

# --- Параметры установки у панели ---
PARAMS="$(curl -fsSL -m 20 "\${PANEL}/api/nodes/install-params?token=$TOKEN")" || {
  echo "Не удалось получить параметры у панели — проверьте токен"; exit 1;
}
NODE_DOMAIN="$(echo "$PARAMS" | jq -r .domain)"
MASK_DOMAIN="$(echo "$PARAMS" | jq -r .mask_domain)"
MTPROTO_PORT="$(echo "$PARAMS" | jq -r .mtproto_port)"
WEB_PORT=8085
API_PORT=9091
API_TOKEN="$(openssl rand -hex 24)"
PANEL_DOMAIN="$(echo "$PARAMS" | jq -r .panel_domain)"

echo ">>> Узел: $NODE_DOMAIN | MTProto: $MTPROTO_PORT"

# --- Firewall: 9091 — только для IP панели ---
PANEL_IP="$(getent ahostsv4 "$PANEL_DOMAIN" | awk '{print $1; exit}')"
if command -v ufw >/dev/null; then
  ufw allow 22/tcp >/dev/null 2>&1 || true
  ufw allow 80/tcp >/dev/null 2>&1 || true
  ufw allow 443/tcp >/dev/null 2>&1 || true
  ufw allow "$MTPROTO_PORT"/tcp >/dev/null 2>&1 || true
  if [ -n "$PANEL_IP" ]; then ufw allow from "$PANEL_IP" to any port "$API_PORT" proto tcp >/dev/null 2>&1 || true; fi
fi

# --- Telemt: бинарник ---
TELEMT_VERSION="3.5.7"
ASSET="telemt-$([ "$ARCH" = "x86_64" ] && echo x86_64 || echo aarch64)-linux-gnu.tar.gz"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
curl -fsSL --retry 3 -o "$TMP/t.tar.gz" "https://github.com/telemt/telemt/releases/download/$TELEMT_VERSION/$ASSET"
curl -fsSL -m 20 -o "$TMP/t.sha256" "https://github.com/telemt/telemt/releases/download/$TELEMT_VERSION/$ASSET.sha256" || true
if [ -s "$TMP/t.sha256" ]; then
  E="$(awk '{print $1}' "$TMP/t.sha256")"; A="$(sha256sum "$TMP/t.tar.gz" | awk '{print $1}')"
  [ "$E" = "$A" ] || { echo "Контрольная сумма не совпала"; exit 1; }
fi
tar -xzf "$TMP/t.tar.gz" -C "$TMP"
BIN="$(find "$TMP" -type f -name telemt | head -n1)"
install -m 0755 "$BIN" /usr/local/bin/telemt
id -u telemt >/dev/null 2>&1 || useradd --system --home /var/lib/telemt --shell /usr/sbin/nologin telemt
mkdir -p /etc/tggate /var/lib/telemt/tlsfront
chown -R telemt:telemt /var/lib/telemt

# --- Конфиг узла ---
WELCOME_SECRET="$(openssl rand -hex 16)"
cat > /etc/tggate/telemt.toml <<TOML
[general]
use_middle_proxy = true
log_level = "normal"
[general.modes]
classic = false
secure = true
tls = true
[general.links]
show = "*"
public_host = "$NODE_DOMAIN"
public_port = $MTPROTO_PORT
[server]
port = $MTPROTO_PORT
[server.api]
enabled = true
listen = "0.0.0.0:$API_PORT"
auth_header = "Bearer $API_TOKEN"
read_only = false
minimal_runtime_enabled = true
runtime_edge_enabled = true
[[server.listeners]]
ip = "0.0.0.0"
port = $MTPROTO_PORT
[[server.listeners]]
ip = "127.0.0.1"
port = $WEB_PORT
transport = "web"
proxy_protocol = false
reuse_allow = false
web_client_ip_source = "x_forwarded_for"
web_trusted_proxy_cidrs = ["127.0.0.1/32"]
[censorship]
tls_domain = "$MASK_DOMAIN"
mask = true
tls_emulation = true
tls_front_dir = "/var/lib/telemt/tlsfront"
[[web.vhosts]]
host = "$NODE_DOMAIN"
cdn_enabled = false
[[web.vhosts.profiles]]
user = "welcome"
secret_mode = "dd"
secret = "$WELCOME_SECRET"
max_sessions = 8
max_streams = 512
max_streams_per_session = 64
TOML
chmod 640 /etc/tggate/telemt.toml && chown root:telemt /etc/tggate/telemt.toml

# --- systemd ---
cat > /etc/systemd/system/telemt.service <<UNIT
[Unit]
Description=Telemt proxy engine (TGGATE node)
After=network-online.target
[Service]
User=telemt
ExecStart=/usr/local/bin/telemt -c /etc/tggate/telemt.toml
Restart=always
RestartSec=3
LimitNOFILE=1048576
[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload && systemctl enable --now telemt

# --- Caddy: TLS 443 → WEB-listener ---
apt-get install -y -qq debian-keyring debian-archive-keyring apt-transport-https curl >/dev/null
curl -1 -fsSL 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg 2>/dev/null || true
echo 'deb [signed-by=/usr/share/keyrings/caddy-stable-archive-keyring.gpg] https://dl.cloudsmith.io/public/caddy/stable/deb/debian any-version main' > /etc/apt/sources.list.d/caddy-stable.list
apt-get update -qq && apt-get install -y -qq caddy >/dev/null
if command -v caddy >/dev/null; then
  cat > /etc/caddy/Caddyfile <<CADDY
$NODE_DOMAIN {
    reverse_proxy 127.0.0.1:$WEB_PORT
}
CADDY
  systemctl restart caddy
fi

# --- Регистрация в панели ---
echo ">>> Регистрирую узел в панели…"
REG="$(curl -fsSL -m 20 -X POST -H 'Content-Type: application/json' \\
  -d "{\\"install_token\\":\\"$TOKEN\\",\\"api_token\\":\\"$API_TOKEN\\"}" \\
  "\${PANEL}/api/nodes/register")" || {
  echo "Не удалось зарегистрировать узел в панели. Проверьте доступность панели и повторите."; exit 1;
}
echo "$REG" | grep -q '"ok":true' && echo "✅ Узел установлен и зарегистрирован! Проверьте его на странице «Узлы» в панели." \\
  || { echo "Ответ панели: $REG"; exit 1; }
`;

    res.setHeader('Content-Type', 'text/x-shellscript; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.send(script);
});

module.exports = router;
