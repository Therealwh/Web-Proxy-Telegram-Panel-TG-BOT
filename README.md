# 🚀 TGGATE — Telegram Gate

[![Release](https://img.shields.io/github/v/release/Therealwh/Web-Proxy-Telegram-Panel-TG-BOT?style=flat-square&label=%D0%B2%D0%B5%D1%80%D1%81%D0%B8%D1%8F)](https://github.com/Therealwh/Web-Proxy-Telegram-Panel-TG-BOT/releases/latest)
[![License](https://img.shields.io/github/license/Therealwh/Web-Proxy-Telegram-Panel-TG-BOT?style=flat-square)](LICENSE)
[![CI](https://github.com/Therealwh/Web-Proxy-Telegram-Panel-TG-BOT/actions/workflows/ci.yml/badge.svg?style=flat-square)](https://github.com/Therealwh/Web-Proxy-Telegram-Panel-TG-BOT/actions/workflows/ci.yml)
[![Platform](https://img.shields.io/badge/Ubuntu-22.04%20%7C%2024.04-orange?style=flat-square)](https://github.com/Therealwh/Web-Proxy-Telegram-Panel-TG-BOT)

**TGGATE** — современная панель управления для Telegram-прокси, объединяющая
**Web Proxy** и **MTProto** через единый сервер **Telemt**.

- 🌐 Web Proxy для Telegram
- 🔌 MTProto на порту 8443
- 🤖 Встроенный Telegram-бот для продаж (админка, платежи, рефералка, тест 3 часа)
- 📱 QR-коды для быстрого подключения
- 🎨 Полноценный сайт-заглушка с SEO
- 🔌 Публичный API для разработчиков
- 🔄 Автоматические обновления

## 📦 Репозитории

- **Панель TGGATE**: https://github.com/Therealwh/Web-Proxy-Telegram-Panel-TG-BOT
- **Telemt** (прокси-сервер): https://github.com/telemt/telemt

## ⚡ Быстрая установка

Требования: чистый VPS с **Ubuntu 22.04 / 24.04**, root-доступ, домен с A-записью на IP сервера.

```bash
apt-get -o DPkg::Lock::Timeout=600 update && \
apt-get -o DPkg::Lock::Timeout=600 install -y curl ca-certificates git && \
bash -c "$(curl -fsSL --proto '=https' --tlsv1.2 \
  https://raw.githubusercontent.com/Therealwh/Web-Proxy-Telegram-Panel-TG-BOT/main/install.sh)"
```

Установщик интерактивно спросит:

| Параметр | Описание |
|---|---|
| 🌐 Домен | Например, `proxy.example.com` (A-запись должна указывать на сервер) |
| 📧 Email | Для SSL-сертификата Let's Encrypt |
| 👤 Логин | Логин администратора (латиница) |
| 🔑 Пароль | Минимум 8 символов, буквы + цифры |
| 🌍 IP | Внешний IP (определяется автоматически) |

После установки вы получите адрес панели с секретным путём:
`https://ваш-домен/cp-xxxxxx/`

## 📊 Возможности

### Дашборд
Нагрузка CPU/RAM/сеть в реальном времени (WebSocket), счётчики клиентов
и подключений, трафик за день/неделю/месяц, статусы сервисов, срок SSL.

### Клиенты
Квоты трафика с прогресс-баром, дата истечения, лимит IP, ограничение
скорости, Ad Tag, выбор протоколов (Web Proxy / MTProto), CSV импорт/экспорт,
массовое создание, перевыпуск ссылок.

### Живые логи
Подключения в реальном времени, фильтры по клиенту/IP/протоколу,
цветовая разметка (✅/❌/⚠️), экспорт за период.

### QR-коды
QR для Web Proxy и MTProto, PNG/SVG, кастомизация цветов и размера,
публичная страница `/qr/{id}`, статистика сканирований, отправка в Telegram.

### Сайт-заглушка
Встроенный файловый менеджер и редактор кода, 3 готовых шаблона
(🔧 ремонт с анимацией, 🚗 автомобили, 💄 женский портал), SEO-поля,
предпросмотр. Домен выглядит как обычный сайт.

### Telegram-бот продаж
Тарифы с ценами и лимитами (IP, трафик), выдача ссылок после оплаты,
промокоды, уведомления админу, статистика продаж.
Админка в самом боте: `/admin` — дашборд, подтверждение платежей,
рассылки. Личный кабинет: мои прокси, продление, баланс, рефералка.
Обязательная подписка на канал (вкл/выкл), тестовый доступ на 3 часа.

### Публичный API
API-ключи с разделением прав, Swagger UI на `/panel-api/docs`, вебхуки
с HMAC-подписью, примеры для Python и Node.js. Создание клиентов
со всеми лимитами (IP, скорости, трафик), ссылки, QR, продление.

## 🛠 Управление

```bash
sudo TGGATE
```

Меню: статус сервисов, старт/стоп/рестарт, логи, смена логина/пароля,
смена домена, обновления, бэкап/восстановление, удаление.

## 🔄 Обновления

### Автоматические
Панель проверяет обновления с заданной частотой
(Настройки → Обновления). Каналы: stable / beta / latest.

### Ручные
- Через панель: **Обновления → Обновить панель / Обновить Telemt**
- Через консоль: `sudo TGGATE` → пункты 8/9/10

### Откат
При неудачном обновлении панель автоматически откатывается на бэкап.
Бэкапы хранятся в `/var/backups/tggate/`.

## 🌐 Протоколы

| Протокол | Порт | Ссылка |
|---|---|---|
| Web Proxy | 443 (через домен) | `tg://webproxy?server=...&secret=dd...` |
| MTProto (Fake TLS) | 8443 | `tg://proxy?server=...&port=8443&secret=ee...` |

## 🔧 Troubleshooting

| Проблема | Решение |
|---|---|
| Панель не открывается | Проверьте секретный путь и `sudo TGGATE` → статус |
| SSL не выпускается | Убедитесь, что A-запись домена указывает на IP сервера |
| MTProto не подключается | `sudo ufw status` — порт 8443 должен быть открыт |
| Telemt упал | `journalctl -u telemt -n 100` |

## 📚 Документация

- [Установка](docs/INSTALL.md)
- [API панели](docs/API.md)
- [Публичный API](docs/API_PUBLIC.md)
- [Telegram-бот](docs/BOT.md)
- [Telemt и протоколы](docs/TELEMT.md)
- [QR-коды](docs/QR_CODES.md)
- [Сайт-заглушка](docs/WEBSITE.md)
- [Для разработчиков](docs/DEVELOPERS.md)

## 📄 Лицензия

MIT © 2026 TGGATE
