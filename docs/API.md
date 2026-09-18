# 📘 API панели (административное)

Базовый URL: `https://ваш-домен/api`
Аутентификация: JWT. Вход: `POST /api/auth/login` → `{ accessToken }`.
Access-токен живёт 15 минут; refresh — httpOnly-cookie на 7 дней.
Для изменяющих запросов обязателен заголовок `X-Requested-With: XMLHttpRequest` (CSRF).

Полная интерактивная документация публичного API v1 — на `/api/docs`.
Ниже — краткая карта админских эндпоинтов.

## Аутентификация

| Метод | Путь | Описание |
|---|---|---|
| POST | /api/auth/login | Вход (лимит 10 попыток/15 мин) |
| POST | /api/auth/refresh | Обновление access-токена |
| POST | /api/auth/logout | Выход |
| GET | /api/auth/me | Текущий пользователь |

## Клиенты

| Метод | Путь | Описание |
|---|---|---|
| GET | /api/clients | Список (поиск, фильтры, пагинация) |
| POST | /api/clients | Создать |
| POST | /api/clients/bulk | Массовое создание |
| GET | /api/clients/{id} | Карточка клиента |
| PATCH | /api/clients/{id} | Обновить |
| DELETE | /api/clients/{id} | Удалить |
| POST | /api/clients/{id}/toggle | Вкл/выкл |
| POST | /api/clients/{id}/extend | Продлить `{days}` |
| POST | /api/clients/{id}/rotate | Перевыпуск секрета |
| POST | /api/clients/{id}/reset-quota | Сброс трафика |
| GET | /api/clients/{id}/history | История подключений |
| GET | /api/clients/export/csv | Экспорт CSV |

## Статистика и логи

| Метод | Путь | Описание |
|---|---|---|
| GET | /api/stats/dashboard | Полная сводка дашборда |
| GET | /api/stats/traffic | Трафик по дням |
| GET | /api/stats/uptime | Аптайм за 30 дней |
| GET | /api/logs | Логи (фильтры, пагинация) |
| GET | /api/logs/export | Экспорт логов CSV |
| WS | /ws?token=JWT | Живые события (`stats`, `log`) |

## Telemt

| Метод | Путь | Описание |
|---|---|---|
| GET | /api/telemt/status | Статус, версия, WEB-рантайм |
| GET | /api/telemt/config | Прочитать config.toml |
| PUT | /api/telemt/config | Сохранить + reload |
| PATCH | /api/telemt/config | Sparse-патч через Config API |
| POST | /api/telemt/restart | Перезапуск сервиса |
| GET | /api/telemt/web/sessions | Активные WEB-сессии (Pulse) |
| POST | /api/telemt/web/sessions/close | Закрыть WEB-сессии |

## Прочее

| Метод | Путь | Описание |
|---|---|---|
| GET/PUT | /api/settings | Настройки панели |
| GET | /api/qr/client/{id}/{type}.{png\|svg} | QR-код |
| GET | /api/website/files | Файлы сайта-заглушки |
| POST | /api/website/apply-template | Применить шаблон |
| GET/PUT | /api/bot/settings | Настройки TG-бота |
| CRUD | /api/bot/tariffs | Тарифы |
| CRUD | /api/api-keys | API-ключи |
| GET | /api/updates/status | Статус обновлений |
| POST | /api/updates/{panel\|telemt\|check} | Запуск обновления |
