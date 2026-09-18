# ⚙️ Telemt и протоколы

TGGATE использует [Telemt](https://github.com/telemt/telemt) — быстрый
MTProto/Web прокси на Rust — как **единственный** прокси-сервер.

## Протоколы

### 🔌 MTProto (порт 8443)

Fake-TLS (ee) и Secure (dd) режимы. Ссылка:

```
tg://proxy?server=домен&port=8443&secret=ee<32hex><домен_маскировки_hex>
```

### 🌐 Web Proxy (порт 443 через домен)

WEB-режим Telemt: MTProxy-потоки внутри HTTPS/WebSocket-carriers.
Telemt **не** терминирует TLS — это делает Caddy. Ссылка:

```
tg://webproxy?server=домен&secret=dd<32hex>
```

## Схема трафика

```
Клиент Telegram
  ├─ MTProto :8443 ──────────────→ Telemt (listener 0.0.0.0:8443)
  └─ Web Proxy :443 → Caddy (TLS) → Nginx :8080 → Telemt WEB (127.0.0.1:18080)
                                                      ├─ carrier → Telegram
                                                      └─ обычные запросы → сайт-заглушка
```

## Control API

Telemt слушает `127.0.0.1:9091` с Bearer-токеном (генерируется при установке).
Панель управляет пользователями, квотами, конфигурацией и смотрит статистику
через этот API. Пользователи панели = пользователи Telemt.

Основные эндпоинты Telemt API: `/v1/users` (CRUD), `/v1/config`,
`/v1/system/reload`, `/v1/stats/summary`, `/v1/runtime/web/*`.

## Конфигурация

Файл: `/etc/tggate/telemt.toml` (шаблон: `templates/telemt.toml.tmpl`).
Правится из панели: **Настройки → Telemt** (с автоматическим reload
и откатом при ошибке) или вручную + `systemctl restart telemt`.

## Pulse-диагностика

**Настройки → Telemt → WEB-сессии** показывает активные сессии WEB-прокси
(через `GET /v1/runtime/web/sessions`) с возможностью закрытия.

## Обновление Telemt

- Из панели: **Обновления → Обновить Telemt** (с бэкапом и откатом)
- Из консоли: `sudo TGGATE` → пункт 9
