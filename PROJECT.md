# 📘 TGGATE — Описание проекта

> Сводный документ по проекту: что это, как устроен, из чего состоит и как разворачивается.
> Актуально для версии **1.3.5** (2026-09-21). Основной источник — код репозитория, README.md, docs/ и CHANGELOG.md.

---

## 1. Суть проекта

**TGGATE** — современная панель управления Telegram-прокси, объединяющая **Web Proxy** и **MTProto** через единый прокси-сервер [Telemt](https://github.com/telemt/telemt) (Rust). Проект решает задачу «прокси как бизнес»: админ ставит панель на VPS, а клиенты покупают доступ через встроенного Telegram-бота.

| | |
|---|---|
| 🌐 Протоколы | Web Proxy (через домен, порт 443) + MTProto Fake-TLS (порт 8443) |
| 🤖 Бот продаж | тарифы, промокоды, рефералка, тестовый доступ на 3 часа, обязательная подписка на канал |
| 📱 QR-коды | генерация PNG/SVG, публичная страница `/qr/{id}`, статистика сканирований |
| 🎨 Сайт-заглушка | встроенный файловый менеджер + редактор кода, 3 шаблона, SEO-поля |
| 🔌 Публичный API | API-ключи `tgk_*` с правами read/write/full, Swagger UI, вебхуки с HMAC-подписью |
| 🔄 Обновления | автоматические (stable/beta/latest) с бэкапом и автооткатом при неудаче |
| 📄 Лицензия | MIT © 2026 TGGATE |
| 🏠 Репозиторий | https://github.com/Therealwh/Web-Proxy-Telegram-Panel-TG-BOT |

**Масштаб кодовой базы:** ~9 700 строк JS/JSX (панель) + ~1 400 строк shell-скриптов.

---

## 2. Ключевые возможности

- **Дашборд** — CPU/RAM/сеть в реальном времени (WebSocket), счётчики клиентов и подключений, трафик за день/неделю/месяц, живой график трафика (1ч/6ч/24ч, отправка/получение, текущая скорость), статусы и аптайм сервисов, срок SSL.
- **Клиенты** — квоты трафика с прогресс-баром, дата истечения, лимит одновременных IP, ограничение скорости, Ad Tag, выбор протоколов, CSV импорт/экспорт, массовое создание, перевыпуск ссылок.
- **Живые логи** — подключения в реальном времени, фильтры по клиенту/IP/протоколу, цветовая разметка (✅/❌/⚠️), экспорт за период.
- **QR-коды** — для Web Proxy и MTProto, PNG/SVG, кастомизация цветов и размера, отправка в Telegram.
- **Сайт-заглушка** — домен выглядит как обычный сайт: файловый менеджер, редактор кода, шаблоны (🔧 ремонт, 🚗 автомобили, 💄 женский портал), SEO, предпросмотр.
- **Telegram-бот продаж** — тарифы с ценами и лимитами (IP, трафик), выдача ссылок после оплаты, промокоды, пополнение баланса, рефералка, уведомления админу, админка `/admin` (дашборд, подтверждение платежей, рассылки), личный кабинет (мои прокси, продление, баланс, рефералка), обязательная подписка на канал, тестовый доступ 3 часа (один раз, автоудаление через 24 ч), кастомные кнопки (до 8).
- **Публичный API v1** — создание клиентов со всеми лимитами, ссылки, QR (base64), продление, статистика, тарифы, вебхуки.
- **Обновления и обслуживание** — проверка обновлений из панели, каналы stable/beta/latest, TGGATE Helper (root-сервис-помощник), бэкап/восстановление через панель (JSON), CLI-меню `sudo TGGATE`.

---

## 3. Технологический стек

### Backend (panel/backend)

- **Node.js ≥ 20** (в проде — Node 22), Express 4, CommonJS
- **better-sqlite3** — БД SQLite в WAL-режиме, миграции `panel/backend/migrations/` (6 штук)
- **grammY** — Telegram-бот работает **внутри процесса панели**, отдельный сервис не нужен
- **ws** — WebSocket-хаб для реального времени (метрики, логи)
- **jsonwebtoken + bcryptjs** — аутентификация панели (access 12 ч + refresh 30 дней)
- **helmet, cors, compression, express-rate-limit, cookie-parser, multer** — HTTP-обвязка
- **zod** — валидация входных данных
- **qrcode** — генерация QR, **systeminformation** — метрики хоста
- **swagger-ui-dist** — интерактивная документация публичного API на `/api/docs`
- Тесты: встроенный раннер `node --test` (`panel/backend/tests/`: links, validation)

### Frontend (panel/frontend)

- **React 18 + Vite 6** (`base: './'` — панель работает под секретным префиксом `/cp-xxxxxx/` за Nginx)
- **Tailwind CSS 3 + PostCSS + autoprefixer**
- **Zustand** — состояние, **react-router-dom 6** — маршрутизация
- **Recharts** — графики, **lucide-react** — иконки
- Страницы (11): Login, Dashboard, Clients, Logs, QRGenerator, Website, Bot, ApiKeys, Developers, Settings, Updates
- Компоненты: `Layout.jsx`, `ui.jsx`; инфраструктура: `api.js`, `store.js`, `ws.js`

### Инфраструктура

- **Caddy** — TLS-терминатор с авто-SSL Let's Encrypt, единственная внешняя точка входа (80/443)
- **Nginx** — маршрутизация (loopback :8080): панель ↔ Telemt WEB ↔ сайт-заглушка
- **UFW** — файрвол (80, 443, 8443 + SSH)
- **systemd** — 3 юнита: `tggate-panel.service`, `telemt.service`, `tggate-helper.service`
- **Docker Compose** — опциональный способ запуска для отладки (не настраивает Caddy/Nginx/UFW)
- **GitHub Actions CI** — backend-тесты, сборка фронта, shellcheck всех shell-скриптов

---

## 4. Архитектура и схема трафика

```
Клиент Telegram
  ├─ MTProto :8443 ──────────────→ Telemt (listener 0.0.0.0:8443)
  └─ Web Proxy :443 → Caddy (TLS) → Nginx :8080 → Telemt WEB (127.0.0.1:18080)
                                                      ├─ carrier → Telegram
                                                      └─ обычные запросы → сайт-заглушка
Администратор → https://домен/cp-xxxxxx/ → Caddy → Nginx → Панель (127.0.0.1:3000)
                                                          └─ Control API → Telemt (127.0.0.1:9091)
```

**Порты:**

| Порт | Кто слушает | Назначение |
|---|---|---|
| 80/443 | Caddy | TLS, единственная внешняя точка входа |
| 8080 | Nginx (loopback) | Маршрутизация: панель ↔ Telemt WEB |
| 3000 | Панель (loopback) | Backend API + собранный фронтенд |
| 18080 | Telemt WEB (loopback) | Web Proxy + сайт-заглушка |
| 9091 | Telemt API (loopback) | Control API (Bearer-токен, генерируется при установке) |
| 8443 | Telemt | Публичный MTProto |
| 9443 | TGGATE Helper (loopback) | root-помощник панели для обновлений |

**Ключевые интеграционные точки:**

- **Telemt Control API** (`/v1/users` CRUD, `/v1/config`, `/v1/system/reload`, `/v1/stats/summary`, `/v1/runtime/web/*`) — панель управляет пользователями Telemt; пользователь панели = пользователь Telemt. Конфиг Telemt: `/etc/tggate/telemt.toml` (шаблон `templates/telemt.toml.tmpl`), правится из панели с автоматическим reload и откатом при ошибке.
- **TGGATE Helper** (появился в 1.3.2) — root-сервис на `127.0.0.1:9443` с доступом по секрету; панель командует ему вместо хрупкого sudo. Заменил sudoers-схему; для старых установок ставится `bash /opt/tggate/scripts/install-helper.sh`.
- **Ссылки подключения:**

| Протокол | Порт | Формат ссылки |
|---|---|---|
| Web Proxy | 443 (через домен) | `tg://webproxy?server=...&secret=dd...` |
| MTProto (Fake TLS) | 8443 | `tg://proxy?server=...&port=8443&secret=ee...` |

---

## 5. Структура репозитория

```
├── install.sh / update.sh / uninstall.sh   # установка, обновление, удаление (root-скрипты)
├── tggate.sh                               # CLI-меню «sudo TGGATE» (статус, логи, смена домена, бэкап…)
├── install.sh, scripts/
│   ├── install_telemt.sh / install_caddy.sh / install_nginx.sh / setup_firewall.sh
│   ├── install-helper.sh / helper.js       # TGGATE Helper (root-помощник)
│   └── update-panel.sh / update-telemt.sh / check-updates.sh
├── panel/
│   ├── backend/
│   │   ├── server.js                       # Express-сервер: API, статика, WebSocket
│   │   ├── config.js / db.js / utils/logger.js
│   │   ├── routes/                         # 16 роутов (см. §6)
│   │   ├── services/                       # 16 сервисов (см. §6)
│   │   ├── middleware/                     # auth (JWT/CSRF/аудит), apiKey, errorHandler
│   │   ├── migrations/                     # 001–006 SQL-миграции
│   │   ├── public-api/docs/openapi.js      # OpenAPI-спека публичного API
│   │   └── tests/                          # links.test.js, validation.test.js
│   └── frontend/
│       ├── vite.config.js / tailwind.config.js / index.html
│       └── src/                            # pages/ (11), components/, api.js, store.js, ws.js
├── systemd/                                # tggate-panel, telemt, tggate-helper
├── templates/
│   ├── caddyfile.tmpl / nginx.conf.tmpl / telemt.toml.tmpl / cron-updates.tmpl
│   └── websites/                           # 3 шаблона сайта-заглушки: cars, repair, women
├── docs/                                   # 8 документов (см. §11)
├── .github/workflows/ci.yml                # CI: тесты, сборка, shellcheck
├── docker-compose.yml / Dockerfile.panel   # опциональный Docker-режим для отладки
└── VERSION / CHANGELOG.md / PLAN*.md / TODO.md / AUDIT-ERRORS.md
```

---

## 6. Backend подробно

### Роуты (panel/backend/routes/) — 16 модулей

| Роут | Назначение | Защита |
|---|---|---|
| `auth.js` | вход, refresh-токены (12 ч access / 30 дней refresh) | CSRF |
| `clients.js` | CRUD клиентов, лимиты, CSV, массовое создание | JWT + CSRF + аудит |
| `stats.js` | метрики дашборда, трафик | JWT |
| `telemt.js` | конфиг Telemt, WEB-сессии, reload | JWT + CSRF + аудит |
| `logs.js` | живые логи, экспорт | JWT |
| `settings.js` | настройки панели, бота, платёжек, реквизиты | JWT + CSRF + аудит |
| `qr.js` | генерация QR, токены | JWT (header или `?token=`) |
| `website.js` | сайт-заглушка: файловый менеджер, редактор, SEO | JWT + CSRF + аудит |
| `bot.js` | управление ботом, тарифы, админка, рассылки | JWT + CSRF + аудит |
| `apiKeys.js` | управление API-ключами | JWT + CSRF + аудит |
| `apiV1.js` | **публичный API v1** (`/api/v1/*`) | API-ключ `tgk_*` |
| `payments.js` | платежи, промокоды, **публичные вебхуки** ЮKassa/CryptoBot | вебхуки публичны, остальное JWT |
| `updates.js` | проверка/запуск обновлений, история | JWT + CSRF + аудит |
| `backup.js` | бэкап/восстановление (JSON) | JWT (restore — лимит 60 МБ) |
| `internal.js` | внутренние эндпоинты для helper/скриптов | только loopback |
| `publicPages.js` | публичные страницы: `/qr/{id}`, сайт | без авторизации |

### Сервисы (panel/backend/services/) — 16 модулей

| Сервис | Назначение |
|---|---|
| `bot.js` | grammY-бот продаж: тарифы, покупка, кабинет, админка, рефералка, тест 3 ч |
| `payments.js` | CryptoBot, ЮKassa, ручная оплата (карта/СБП/банк из панели), промокоды |
| `telemtApi.js` | клиент Control API Telemt |
| `links.js` | генерация ссылок Web Proxy / MTProto (dd/ee секреты) |
| `webProfiles.js` | WEB-профили клиентов в Telemt |
| `trafficCollector.js` | дельта `total_octets` по клиентам раз в минуту → квоты и графики |
| `trafficLive.js` | живой трафик для дашборда |
| `logCollector.js` | сбор подключений в реальном времени |
| `stats.js` | агрегация статистики |
| `wsHub.js` | WebSocket-хаб: рассылка метрик/логов фронтенду |
| `scheduler.js` | фоновые задачи (истечения, напоминания, автоудаление тестов) |
| `notifier.js` | уведомления админу (Telegram) |
| `webhooks.js` | отправка вебхуков публичного API (HMAC-подпись) |
| `qrTokens.js` | одноразовые токены QR-страниц |
| `geo.js` | geo-IP с кэшем |
| `versionInfo.js` | версия панели из файла VERSION |

### Модель данных (SQLite, 6 миграций)

Ядро: пользователи панели, клиенты (квоты, даты, лимиты IP/скорости, Ad Tag, баланс), тарифы (цена, дни, протоколы, лимит IP, квота ГБ), платежи и заказы, промокоды, QR-токены, API-ключи, telegram_id клиентов, реферальные связи (с отложенным проставлением), настройки.

---

## 7. Бот продаж (services/bot.js)

- Работает на **grammY** внутри процесса панели; включается в панели: **Telegram бот** → токен → вкл → сохранить.
- **Покупка:** тариф → создание заказа при выборе способа → CryptoBot / ЮKassa / карта админа (инвойс по клику, фолбэк на карту при сбое) → после `payment.success` бот создаёт клиента `tg<telegram_id>` (или продлевает) и отправляет ссылки по протоколам тарифа + уведомление админу.
- **Продление** — тот же выбор способа оплаты, название тарифа включает юзернейм прокси.
- **Пополнение баланса**, **промокоды** (% или фикс., лимит использований, только первый платёж, срок действия).
- **Личный кабинет:** мои прокси (несколько прокси у одного клиента — каждая покупка отдельный прокси), продление, баланс, рефералка (переход по ссылке сохраняется в БД, засчитывается даже с бесплатного теста).
- **Админка `/admin`:** дашборд, подтверждение платежей и чеков (скриншот/PDF пересылается админу), рассылки, выдача/списание баланса, сообщение пользователю через бота.
- **Прочее:** обязательная подписка на канал (вкл/выкл), тестовый прокси 3 часа (один раз на аккаунт, автоудаление через 24 ч), кастомные кнопки (до 8, из панели), приветствие с переменными `{имя}`, `{ссылка}`, `{дата}`, все времена — МСК.

**Вебхуки платёжек (публичные):** `POST /api/payments/webhook/yookassa` (верификация платежа через API ЮKassa, id в `metadata.tggate_payment_id`), `POST /api/payments/webhook/cryptobot` (HMAC-подпись `crypto-pay-api-signature`), ручное подтверждение `POST /api/payments/{id}/confirm` (админ).

---

## 8. Публичный API v1

- Базовый URL: `https://домен/api/v1`, ключ `Authorization: Bearer tgk_...`, Swagger UI: `/api/docs`.
- Ключи создаются в панели (**API-ключи**), показываются один раз; опционально срок действия и whitelist IP. Права: `read` (чтение), `write` (+создание/удаление клиентов, продление), `full` (+вебхуки). Лимит — 60 запросов/мин на ключ.
- Эндпоинты: клиенты (список/создание с `days`/`quota_gb`/лимитами/ссылки/QR/удаление), продление `POST /extend/{id}`, статистика `/stats`, `/stats/traffic`, тарифы `/tariffs`.
- Вебхуки: подписка на события (`client.created` и др.), POST JSON с подписью `X-TGGATE-Signature` (HMAC-SHA256 от тела, ключ — секрет вебхука).
- В docs/DEVELOPERS.md — готовые шаблоны ботов продаж на Python (aiogram 3) и Node.js.

---

## 9. Развёртывание и жизненный цикл

### Установка (Ubuntu 22.04/24.04, root, домен → IP)

```bash
apt-get -o DPkg::Lock::Timeout=600 update && \
apt-get -o DPkg::Lock::Timeout=600 install -y curl ca-certificates git && \
bash -c "$(curl -fsSL --proto '=https' --tlsv1.2 \
  https://raw.githubusercontent.com/Therealwh/Web-Proxy-Telegram-Panel-TG-BOT/main/install.sh)"
```

Установщик: проверяет root/ОС/порты → спрашивает домен, email, логин/пароль админа, IP → проверяет DNS → ставит Node 22, Caddy, Nginx, UFW → настраивает файрвол → ставит Telemt (проверка SHA-256, отдельный пользователь) → Caddy (авто-SSL) → Nginx → панель → собирает фронтенд → systemd-сервисы → создаёт админа и команду `sudo TGGATE`.

Результат: панель на `https://домен/cp-xxxxxx/` (секретный путь).

### Управление

- `sudo TGGATE` — меню: статус, старт/стоп/рестарт, логи, смена логина/пароля/домена, обновления, бэкап/восстановление, удаление.
- Обновления: автоматически (панель проверяет по расписанию, каналы stable/beta/latest) или вручную (панель → Обновления / `sudo TGGATE` пункты 8–10).
- Откат: при неудачном обновлении автоматический откат на бэкап из `/var/backups/tggate/` (включая файл VERSION).
- Docker: `docker-compose.yml` поднимает panel + telemt для отладки (без Caddy/Nginx/UFW; требует `JWT_SECRET` и `TELEMT_API_TOKEN` в `.env`).

---

## 10. Безопасность

- **Аутентификация панели:** JWT (access 12 ч + refresh 30 дней) + CSRF-защита + **аудит-лог** мутаций; bcrypt для паролей.
- **Секретный путь** панели `/cp-xxxxxx/`; панель и API на одном домене (CORS выключен); `trust proxy: loopback`.
- **Заголовки и лимиты:** helmet с CSP, глобальный rate limit 300 req/мин на `/api/*`, публичный API — 60 req/мин на ключ.
- **Сетевая изоляция:** все служебные порты (3000, 8080, 9091, 9443, 18080) — на loopback; наружу только 80/443/8443.
- **API-ключи:** хеширование, права read/write/full, срок действия, whitelist IP.
- **Платежи:** вебхук ЮKassa верифицирует платёж через API ЮKassa (закрыто в 1.3.4 — раньше кто угодно мог подтвердить платёж); CryptoBot — HMAC; реквизиты карты админа хранятся только в панели (номер карты удалён из кода и истории репозитория в 1.3.0).
- **TGGATE Helper:** root-доступ только с loopback по секрету — заменил sudoers-схему.

---

## 11. Тесты и CI

- **Backend:** `npm test` = `node --test`, тесты `panel/backend/tests/links.test.js` (генерация ссылок) и `validation.test.js` (валидация).
- **Frontend:** проверяется сборкой `npm run build`.
- **Shell:** shellcheck `-S error` для install.sh, update.sh, uninstall.sh, tggate.sh и scripts/*.sh.
- **CI (GitHub Actions):** три джобы — backend-тесты (Node 22), сборка фронта, shellcheck; запускается на push в main и PR.

---

## 12. Текущее состояние и известные проблемы

### Версия 1.3.5 (2026-09-21) — последние изменения

- Продление прокси в боте: выбор способа оплаты (CryptoBot / ЮKassa / карта админа) как при покупке.
- Название тарифа для продления включает юзернейм прокси.

История версий с 1.0.5 (первый публичный релиз, 2026-09-18) — в [CHANGELOG.md](CHANGELOG.md).

### Находки аудита (AUDIT-ERRORS.md, 2026-09-21, НЕ пушится)

**🔴 CRITICAL:**
- JWT-токен в URL: экспорт CSV (`Clients.jsx`), QR-картинки (`<img src>`), экспорт логов, WebSocket `/ws?token=` — токен утекает в логи прокси, историю браузера, referrer. Корень — `middleware/auth.js` принимает `req.query.token` для GET/HEAD.
- Бэкап БД через `wal_checkpoint` + `copyFileSync` — возможен неконсистентный бэкап; нужен `db.backup()` better-sqlite3.
- Разбивка SQL-миграций по `;` ломается на триггерах — нужен `db.exec()` целиком.

**🟠 MAJOR (примеры):** 4 независимых `setInterval` на дашборде + WS (шторм запросов), отсутствие мемоизации тяжёлых графиков. Полный список — в AUDIT-ERRORS.md.

### Ограничения

- Поддерживается только Ubuntu 22.04/24.04, чистый VPS; Docker-вариант — только отладка.
- Тестовое покрытие минимальное (2 тест-файла); CI не включает e2e.
- Telemt — внешний проект (отдельный репозиторий), версия не контролируется панелью кода.

---

## 13. Индекс документации

| Документ | Содержание |
|---|---|
| [README.md](README.md) | обзор, быстрая установка, возможности |
| [docs/INSTALL.md](docs/INSTALL.md) | установка, архитектура портов |
| [docs/API.md](docs/API.md) | API панели |
| [docs/API_PUBLIC.md](docs/API_PUBLIC.md) | публичный API: ключи, эндпоинты, вебхуки |
| [docs/BOT.md](docs/BOT.md) | настройка бота, логика покупки, платёжки |
| [docs/TELEMT.md](docs/TELEMT.md) | протоколы, схема трафика, Control API |
| [docs/QR_CODES.md](docs/QR_CODES.md) | QR-коды |
| [docs/WEBSITE.md](docs/WEBSITE.md) | сайт-заглушка |
| [docs/DEVELOPERS.md](docs/DEVELOPERS.md) | гайд для разработчиков, шаблоны ботов |
| [CHANGELOG.md](CHANGELOG.md) | история версий |
| PLAN.md, PLAN-1.3.1.md, PAY-PLAN.md, FIX-PLAN.md, TODO.md, Дополнение.md | внутренние плановые материалы |
| AUDIT-ERRORS.md | аудит ошибок (не пушится в репозиторий) |
