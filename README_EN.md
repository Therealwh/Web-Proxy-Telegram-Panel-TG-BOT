<p align="center">
  <b>English</b> · <a href="README.md">Русский</a>
</p>

<p align="center">
  <img src="assets/logo.svg" width="110" alt="TGGATE logo">
  <h1 align="center">TGGATE — Telegram Gate</h1>
  <p align="center">
    Telegram proxy control panel: <b>Web Proxy</b> and <b>MTProto</b> on a single <b>Telemt</b> server —
    with a sales bot, analytics, auto-renewal and auto-updates.
  </p>
  <p align="center">
    <a href="https://github.com/Therealwh/Web-Proxy-Telegram-Panel-TG-BOT/releases/latest"><img src="https://img.shields.io/github/v/release/Therealwh/Web-Proxy-Telegram-Panel-TG-BOT?style=flat-square&label=version" alt="Release"></a>
    <a href="LICENSE"><img src="https://img.shields.io/github/license/Therealwh/Web-Proxy-Telegram-Panel-TG-BOT?style=flat-square" alt="License"></a>
    <a href="https://github.com/Therealwh/Web-Proxy-Telegram-Panel-TG-BOT/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/Therealwh/Web-Proxy-Telegram-Panel-TG-BOT/ci.yml?style=flat-square&label=CI" alt="CI"></a>
    <img src="https://img.shields.io/badge/Ubuntu-22.04%20%7C%2024.04-orange?style=flat-square" alt="Platform">
    <img src="https://img.shields.io/badge/license-MIT-green?style=flat-square" alt="MIT">
  </p>
</p>

<p align="center">
  <img src="docs/screenshots/01-dashboard.png" width="100%" alt="TGGATE dashboard">
</p>

<p align="center"><sub>
  <a href="docs/SCREENSHOTS.md">📸 All 20 screenshots</a>
</sub></p>

---

## 📑 Contents

- [✨ Features](#-features)
- [📸 Screenshots](#-screenshots)
- [⚡ Quick install](#-quick-install)
- [🤖 Telegram sales bot](#-telegram-sales-bot)
- [🛠 Management](#-management)
- [🔄 Updates](#-updates)
- [🌐 Protocols](#-protocols)
- [🔧 Troubleshooting](#-troubleshooting)
- [❤️ Support the project](#-support-the-project)
- [📚 Documentation](#-documentation)

## ✨ Features

### Sales

| | |
|---|---|
| 🤖 **Sales bot** | Tariffs, 5 payment methods (balance, CryptoBot, YooKassa, ⭐ Telegram Stars, manual card), connection buttons in the user cabinet, auto-renewal, referrals, free 3-hour trial |
| 📊 **Analytics** | Revenue by day, top tariffs, trial-to-paid conversion, new customers, funnel |
| 🪪 **Bot users** | Everyone who wrote to the bot (not just buyers): issue proxies, top up balance, send broadcasts — straight from the panel |

### Proxy management

| | |
|---|---|
| 👥 **Clients** | Quotas, expiry date, IP and speed limits, Ad Tag, protocol selection, bulk actions, **pagination** that keeps your selection across pages |
| 📜 **Audit log** | Who changed what and when — recorded automatically, with filters, search and CSV export |
| 🌍 **Geography** | World map, flags, country ranking by connections |
| 📡 **Engine** | Telemt telemetry: ME pool, NAT/STUN, gates, upstreams, TLS fingerprints |
| 📈 **Live logs** | Connections in real time, filters, device detection, export |
| 🔑 **QR codes** | Web and MTProto, PNG/SVG, customisation, public pages, scan statistics |

### Operations

| | |
|---|---|
| 🧭 **Setup wizard** | A dashboard card listing unfinished steps — disappears on its own once everything is set |
| 🩺 **System check** | One-click diagnostics: versions, services, resources, database integrity, backups, security |
| 🔄 **Updates** | Auto-updates with live progress and rollback, domain change from the panel |
| 💾 **Backups** | Automatic with retention, file export and restore, delivery to Telegram |
| 🔔 **Notifications** | Telegram alerts: service down, DC degradation, low disk, new client |
| 🎨 **Interface** | Dark and light themes, accent colours, RU/EN, live map |

### Integrations

| | |
|---|---|
| 🔌 **Public API** | API keys with permission levels, Swagger UI, 13 endpoints |
| 🪝 **Webhooks** | 8 events signed with HMAC-SHA256, managed from the panel, test button, delivery status |
| 📄 **Decoy website** | File manager, templates, SEO — the domain looks like a normal website |
| 📱 **Client web cabinet** | Renewal and payment straight in the browser, even if the client deleted the bot |

- **TGGATE panel**: https://github.com/Therealwh/Web-Proxy-Telegram-Panel-TG-BOT
- **Telemt** (proxy server): https://github.com/telemt/telemt

## 📸 Screenshots

<details open>
<summary><b>Main sections</b></summary>

| Dashboard | Clients |
|---|---|
| ![Dashboard](docs/screenshots/01-dashboard.png) | ![Clients](docs/screenshots/02-clients.png) |

| Sales | Live logs |
|---|---|
| ![Sales](docs/screenshots/03-sales.png) | ![Logs](docs/screenshots/04-logs.png) |

| Geography | Telegram bot |
|---|---|
| ![Geography](docs/screenshots/13-geo.png) | ![Bot](docs/screenshots/07-bot.png) |

</details>

<details>
<summary><b>Operations and settings</b></summary>

| System check | Audit log |
|---|---|
| ![Diagnostics](docs/screenshots/17-diagnostics.png) | ![Audit](docs/screenshots/16-audit.png) |

| Settings | Webhooks |
|---|---|
| ![Settings](docs/screenshots/11-settings.png) | ![Webhooks](docs/screenshots/15-webhooks.png) |

| Updates | Telemt engine |
|---|---|
| ![Updates](docs/screenshots/10-updates.png) | ![Engine](docs/screenshots/14-engine.png) |

</details>

<details>
<summary><b>Other sections</b></summary>

| QR codes | Decoy website |
|---|---|
| ![QR](docs/screenshots/05-qr.png) | ![Website](docs/screenshots/06-website.png) |

| API keys | For developers |
|---|---|
| ![API keys](docs/screenshots/08-api-keys.png) | ![Developers](docs/screenshots/09-developers.png) |

| DPI bypass | Public status |
|---|---|
| ![DPI bypass](docs/screenshots/18-zapret2.png) | ![Status](docs/screenshots/12-status-public.png) |

</details>

Full gallery: [docs/SCREENSHOTS.md](docs/SCREENSHOTS.md).

## ⚡ Quick install

Requirements: clean VPS with **Ubuntu 22.04 / 24.04**, root access, domain with A-record pointing to the server IP.

```bash
apt-get -o DPkg::Lock::Timeout=600 update && \
apt-get -o DPkg::Lock::Timeout=600 install -y curl ca-certificates git && \
bash -c "$(curl -fsSL --proto '=https' --tlsv1.2 \
  https://raw.githubusercontent.com/Therealwh/Web-Proxy-Telegram-Panel-TG-BOT/main/install.sh)"
```

The installer will interactively ask for:

| Parameter | Description |
|---|---|
| 🌐 Domain | e.g. `proxy.example.com` (A-record must point to the server) |
| 📧 Email | Used for the Let's Encrypt certificate |
| 👤 Login | Administrator login (Latin letters) |
| 🔑 Password | Minimum 8 characters, letters + digits |
| 🌍 IP | Public IP (detected automatically) |

After installation you get a panel URL with a secret path:
`https://your-domain/cp-xxxxxx/`

Then follow the steps in the **Initial setup** card on the dashboard — it tells
you what is still left to configure.

## 🤖 Telegram sales bot

Tariffs with prices and limits (IP, traffic), links issued after payment,
admin notifications, sales statistics. Admin cabinet inside the bot: `/admin`
— dashboard, payment confirmation, broadcasts.

**Payment methods:** balance, CryptoBot, YooKassa, ⭐ Telegram Stars
(price auto-converted at the current rate), admin card with cheque handling.

**User cabinet:** every proxy of the client gets buttons
"🌐 Connect WEB proxy" / "🔌 Connect MTProto proxy" (for purchased protocols)
and "♻️ Renew". Renewing a proxy with two protocols (a trial one, for example)
offers a choice: Web only / MTProto only / both. **Auto-renewal from balance**
is enabled by the client with a single tap. Plus balance top-up, referrals and
step-by-step "📱 How to connect" instructions.

**Web cabinet:** the `/p/{token}` link arrives with every purchase — the client
sees their proxies and renews with payment right in the browser, even if they
deleted the bot.

Required channel subscription (toggleable), 3-hour trial access.

**Reliability:** automatic DB backups to Telegram, MTProto/Web/Telemt
monitoring with bot alerts, public status page, iOS hints on connect.

<details>
<summary><b>📊 Panel features in detail</b></summary>

### Dashboard
CPU/RAM/network load in real time (WebSocket), client and connection
counters, traffic per day/week/month, service statuses, SSL expiry, live
traffic chart, event timeline and service restart buttons.

### Clients
Traffic quotas with progress bars, expiry date, IP limit, speed limit,
Ad Tag, protocol selection (Web Proxy / MTProto), CSV import/export, bulk
creation and bulk actions, link rotation.

### Live logs
Connections in real time, filters by client/IP/protocol, client devices
(Windows/macOS/iOS/Android), colour markup (✅/❌/⚠️), export for a period.

Location is written when logs are collected rather than computed on view:
country, city, autonomous system and its operator. This makes logs filterable
and groupable by country and usable for analytics; all of it is included in the
CSV export.

### Telegram bot
Personal cabinet showing traffic usage and the remaining allowance, a clear
hint when a proxy is blocked or expired, a button that sends all connection
links as plain text (so they can be copied and pasted by hand), and quick
top-up straight from the proxy card.

## 🛡 Protection and resilience

All settings live in one place (**Settings → Protection and resilience**).
Most of them restart the engine when applied — this is stated on the card.

### Fake TLS (MTProto)
The panel generates Fake TLS links (`ee`) **in addition to** the regular ones
(`dd`), not instead of them. Links already handed to clients keep working —
clients simply get a second link and pick whichever works on their carrier.

An `ee` link appears only after the mask domain is verified: it must support
**TLS 1.3** and resolve to **this server's IP**. If verification fails, no
`ee` link is shown at all — clients see a working `dd` instead. Verification
runs every 6 hours and again whenever the mask domain changes.

> Fake TLS applies to MTProto only. Web Proxy already runs over real HTTPS and
> does not need it.

### Fallback Web Proxy transports
The panel can enable transport negotiation: the client tries them in order
until one works (`https-lanes`, `websocket`, `websocket-lanes`). The fallback
always stays `https` because **Telegram iOS supports only that**, and changing
it would break every iOS client.

Negotiation is disabled by default. Note that the setting does not support
hot-reload, so the panel restarts the engine after applying it.

### SNI policy
Controls what the engine replies to a client that arrives with an unknown SNI:

| Behaviour | Description |
|-----------|-------------|
| `drop` | Close the connection silently (default) |
| `mask` | Forward to the mask — maximum camouflage |
| `accept` | Treat as valid (weaker protection against probing) |
| `reject_handshake` | Reject the handshake, like nginx without that host |

### Real site behind the proxy domain (selfmask)
Instead of the panel placeholder you can serve an actual website: ordinary
requests to the proxy domain are forwarded to a local backend. A **private
address** is required (e.g. `127.0.0.1:8099`) — the engine accepts only
`http://` with a literal private or loopback IP.

### Backup domains
Extra domains serve the same IP with the same client secret. If the primary
domain is blocked, clients switch to a backup.

Engine limits worth knowing in advance:
- at most **8 domains**;
- every domain needs its own set of client profiles, and only **32** profiles
  are allowed in total — each new domain multiplies that number. The panel
  warns you before applying;
- a domain must **already point at the server IP**, otherwise Let's Encrypt
  will not issue a certificate and connections will fail.

### IP and subnet blocking
A list of addresses and subnets in CIDR form. Rules are applied by two
mechanisms: `deny` in Nginx for the Web Proxy and nftables sets for the
MTProto port, so packets are dropped before reaching the engine.

**The panel and SSH are not affected:** the panel has its own location and
MTProto its own port. Otherwise blocking an address would also cut off access
to the admin panel.

Overly wide subnets (IPv4 wider than `/8`, IPv6 wider than `/16`) are
rejected — otherwise a single mistyped address would cut off a large part of
your clients.

### Fallback route to Telegram (WARP)

If access from the server IP to Telegram data-centre addresses is blocked,
clients connect to the proxy but **nothing loads**: the link is broken
between the server and Telegram. Restarting the engine does not help — it is
the same route, and the DC monitor can see the condition but cannot route
around it.

The fallback tunnels **only the traffic addressed to Telegram data centres**
through Cloudflare. Everything else (panel, websites, updates) stays direct
and does not depend on Cloudflare.

Disabled by default, enabled with a single click
(**Settings → Protection → Fallback route**).

How to use:
1. Install the Cloudflare WARP client on the server and register an account.
2. Enable the fallback in the panel — routing rules for Telegram subnets get added.
3. Turn it on when clients report "connects but nothing loads".
4. Leave it off while there is no problem: WARP adds latency.

If the rules are in place but the tunnel is disconnected, the panel shows a
separate warning — such a route is worse than no route, because traffic to
Telegram goes nowhere.

Manually:
```bash
sudo bash /opt/tggate/scripts/warp.sh status|enable|disable
```

### Memory and CPU limits
The engine is constrained through a systemd drop-in that survives engine
updates. Limits are computed from the server's actual memory rather than
entered by hand in megabytes.

`MemoryMax` restricts **only the Telemt processes**: when reached, the engine
restarts while the panel, Nginx and Caddy stay available. Without a ceiling,
the OOM killer picks a victim at random and may kill the panel.

Apply it via **Settings → Protection → Memory and CPU limits**, or manually:
```bash
sudo bash /opt/tggate/scripts/telemt-limits.sh
```

### QR codes
QR for Web Proxy and MTProto, PNG/SVG, custom colours and sizes, public page
`/qr/{id}`, scan statistics, sending to Telegram.

### Decoy website
Built-in file manager and code editor, 4 ready templates, SEO fields,
preview. The domain looks like a normal website.

One of the templates is **"Tanks"**, a browser arcade game in the spirit
of the Dendy-era Tanks: 55 levels, destructible walls, cover, power-ups,
fullscreen mode and a leaderboard. Nothing is loaded from third parties,
so the page works even without an internet connection.

Levels are built with three types of symmetry — plain, wide and diagonal —
so the field looks different even at the same amount of description, and
no two levels are identical.

The template is fully covered for SEO: `title` and `description` target
real search queries, there is Open Graph for a proper link preview in
messengers, a cover image, `robots.txt` and Schema.org markup
(`VideoGame`, `FAQPage`, `PlayAction`) so search engines understand the
page is a game and may surface it in results.

Scores are stored by the panel: the `/panel-api/game/scores` endpoint is
public and unauthenticated (otherwise a visitor of the decoy site could
not record anything), but it is rate limited, validates the nickname and
score, and trims the table to 200 rows. Visitor IPs are never stored —
they are only used for the rate counter.

### Public API
API keys with permission levels, Swagger UI, webhooks with HMAC signatures,
Python and Node.js examples. Create clients with full limits (IP, speed,
traffic), links, QR codes and renewal.

</details>


## 🛠 Management

```bash
sudo TGGATE
```

Menu: service status, start/stop/restart, logs, change login/password,
change domain, updates, backup/restore, uninstall.

## 🔄 Updates

### Automatic
The panel checks for updates at a chosen frequency
(Settings → Updates). Channels: stable / beta / latest.

### Manual
- From the panel: **Updates → Update panel / Update Telemt**
- From the console: `sudo TGGATE` → items 8/9/10

```bash
# or directly, with an explicit version
sudo bash /opt/tggate/scripts/update-panel.sh v1.17.0
```

### Rollback
If an update fails, the panel rolls back to the backup automatically.
Backups live in `/var/backups/tggate/`, rotation keeps the last three.

## 🌐 Protocols

| Protocol | Port | Link |
|---|---|---|
| Web Proxy | 443 (via domain) | `tg://webproxy?server=...&secret=dd...` |
| MTProto (Fake TLS) | 8443 | `tg://proxy?server=...&port=8443&secret=ee...` |

## 🔧 Troubleshooting

| Problem | Solution |
|---|---|
| Panel does not open | Check the secret path and run `sudo TGGATE` → status |
| SSL will not issue | Make sure the domain A-record points to the server IP |
| MTProto will not connect | `sudo ufw status` — port 8443 must be open |
| Telemt crashed | `journalctl -u telemt -n 100` |
| Not sure what broke | **System check** in the panel gathers everything in one place |

## ❤️ Support the project

TGGATE is developed by one person in their free time. If the panel brings you
income or you simply like it — support development with any amount 🙏
Every donation goes towards servers, domains and new features.

**USDT — TRC-20**
```
TGWtYdfLEVEVXScaE4Ut7ornk1A3CXCCfe
```

**TRX — TRON**
```
TGWtYdfLEVEVXScaE4Ut7ornk1A3CXCCfe
```

**USDT — TON**
```
UQCGYVM9hg2JcqnEQpTPibPxHUuSOB03zhaSE8Yn-C2aHlH-
```

**GRAM — TON**
```
UQCGYVM9hg2JcqnEQpTPibPxHUuSOB03zhaSE8Yn-C2aHlH-
```

**BNB — Smart Chain (BEP-20)**
```
0xde5a28A77359cdCf32666Db8Aae5f5Bb13c5f886
```

> Thank you! 💙

## 📚 Documentation

- [Panel screenshots](docs/SCREENSHOTS.md)
- [Installation](docs/INSTALL.md)
- [Panel API](docs/API.md)
- [Public API](docs/API_PUBLIC.md)
- [Telegram bot](docs/BOT.md)
- [Telemt and protocols](docs/TELEMT.md)
- [QR codes](docs/QR_CODES.md)
- [Decoy website](docs/WEBSITE.md)
- [For developers](docs/DEVELOPERS.md)

## 📄 License

MIT © 2026 TGGATE