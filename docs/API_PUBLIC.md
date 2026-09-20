# 🔌 Публичный API TGGATE

Базовый URL: `https://ваш-домен/api/v1`
Аутентификация: `Authorization: Bearer tgk_ваш_ключ`
Интерактивная документация: `https://ваш-домен/api/docs` (Swagger UI)

## API-ключи

Создаются в панели: **API-ключи → Создать ключ**.

| Право | Что можно |
|---|---|
| read | Только чтение (списки, статистика, ссылки) |
| write | Чтение + создание/удаление клиентов, продление |
| full | Всё + регистрация вебхуков |

Ключ показывается **один раз** при создании. Опционально: срок действия и whitelist IP.

## Эндпоинты

### Клиенты

```bash
# Список клиентов
curl -H "Authorization: Bearer tgk_..." https://домен/api/v1/clients

# Создать клиента на 30 дней с квотой 50 ГБ
curl -X POST -H "Authorization: Bearer tgk_..." \
  -H "Content-Type: application/json" \
  -d '{"username":"ivan","days":30,"quota_gb":50}' \
  https://домен/api/v1/clients

# Ссылки подключения
curl -H "Authorization: Bearer tgk_..." https://домен/api/v1/clients/1/links

# QR-коды (base64 data URL)
curl -H "Authorization: Bearer tgk_..." https://домен/api/v1/clients/1/qr

# Продлить на 30 дней
curl -X POST -H "Authorization: Bearer tgk_..." \
  -H "Content-Type: application/json" -d '{"days":30}' \
  https://домен/api/v1/extend/1

# Удалить
curl -X DELETE -H "Authorization: Bearer tgk_..." https://домен/api/v1/clients/1
```

### Статистика

```bash
curl -H "Authorization: Bearer tgk_..." https://домен/api/v1/stats
curl -H "Authorization: Bearer tgk_..." https://домен/api/v1/stats/traffic
curl -H "Authorization: Bearer tgk_..." https://домен/api/v1/tariffs
```

## Вебхуки

```bash
curl -X POST -H "Authorization: Bearer tgk_..." \
  -H "Content-Type: application/json" \
  -d '{"event":"client.created","url":"https://ваш-сервер/hook"}' \
  https://домен/api/v1/webhooks
```

События: `client.created`, `client.expired`, `client.blocked`,
`payment.success`, `quota.exceeded`.

Каждый запрос вебхука содержит заголовок `X-TGGATE-Signature: sha256=<hmac>`.
Проверка на Node.js:

```js
const crypto = require('crypto');
const expected = 'sha256=' + crypto
    .createHmac('sha256', WEBHOOK_SECRET)
    .update(rawBody)
    .digest('hex');
if (req.headers['x-tggate-signature'] !== expected) {
    throw new Error('Неверная подпись');
}
```

## Лимиты

60 запросов в минуту на ключ. При превышении — HTTP 429.

## Ошибки

Формат: `{ "error": "Описание на русском" }`
Коды: 400 (валидация), 401 (ключ), 403 (права), 404 (не найдено), 429 (лимит), 500.
