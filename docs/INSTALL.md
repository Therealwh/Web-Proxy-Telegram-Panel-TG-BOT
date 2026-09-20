# 📦 Установка TGGATE

## Требования

- Чистый VPS с **Ubuntu 22.04+ / 24.04+**
- root-доступ
- Домен с A-записью, указывающей на IP сервера
- Открытые порты 80, 443 (для SSL) — установщик настроит UFW сам

## Установка одной командой

```bash
apt-get -o DPkg::Lock::Timeout=600 update && \
apt-get -o DPkg::Lock::Timeout=600 install -y curl ca-certificates git && \
bash -c "$(curl -fsSL --proto '=https' --tlsv1.2 \
  https://raw.githubusercontent.com/Therealwh/Web-Proxy-Telegram-Panel-TG-BOT/main/install.sh)"
```

## Что делает установщик

1. Проверяет root, версию ОС, свободность портов 80/443
2. Спрашивает домен, email, логин/пароль администратора, внешний IP
3. Проверяет DNS: домен должен указывать на сервер
4. Устанавливает зависимости: Node.js 22, Caddy, Nginx, UFW
5. Настраивает файрвол: 80, 443, 8443 (+ SSH)
6. Устанавливает Telemt (проверка SHA-256, отдельный пользователь)
7. Настраивает Caddy (авто-SSL) → Nginx → панель/Telemt
8. Собирает фронтенд, запускает сервисы через systemd
9. Создаёт администратора и команду `sudo TGGATE`

## После установки

- Панель: `https://ваш-домен/cp-xxxxxx/` (секретный путь из вывода установщика)
- Управление: `sudo TGGATE`

## Архитектура портов

| Порт | Кто слушает | Назначение |
|---|---|---|
| 80/443 | Caddy | TLS, единственная внешняя точка входа |
| 8080 | Nginx (loopback) | Маршрутизация: панель ↔ Telemt WEB |
| 3000 | Панель (loopback) | Backend API + фронтенд |
| 18080 | Telemt WEB (loopback) | Web Proxy + сайт-заглушка |
| 9091 | Telemt API (loopback) | Control API для панели |
| 8443 | Telemt | Публичный MTProto |

## Удаление

```bash
sudo TGGATE  # пункт 13
# или
sudo bash /opt/tggate/uninstall.sh
```
