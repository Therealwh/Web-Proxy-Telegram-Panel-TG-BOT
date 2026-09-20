/**
 * @fileoverview OpenAPI-спецификация публичного API TGGATE v1.
 * Отдаётся по /api/docs.json и визуализируется Swagger UI на /api/docs.
 * Ориентирована на создание ботов продаж: клиенты, ссылки, QR, тарифы,
 * продление, подключения, вебхуки.
 * @module public-api/docs/openapi
 */

// Краткая схема клиента
const clientSchema = {
    type: 'object',
    properties: {
        id: { type: 'integer', example: 1 },
        username: { type: 'string', example: 'ivan' },
        status: { type: 'string', enum: ['active', 'blocked', 'expired'] },
        quota_bytes: { type: 'integer', nullable: true, description: 'Квота трафика в байтах; null = безлимит' },
        traffic_used: { type: 'integer', description: 'Израсходовано байт' },
        expires_at: { type: 'string', format: 'date-time', nullable: true },
        max_ips: { type: 'integer', nullable: true, description: 'Максимум одновременных IP' },
        rate_down_bps: { type: 'integer', nullable: true, description: 'Лимит скачивания, бит/с' },
        rate_up_bps: { type: 'integer', nullable: true, description: 'Лимит загрузки, бит/с' },
        web_enabled: { type: 'integer', description: '1 — Web Proxy разрешён' },
        mtproto_enabled: { type: 'integer', description: '1 — MTProto разрешён' },
    },
};

// Схема ссылок подключения
const linksSchema = {
    type: 'object',
    properties: {
        web: { type: 'string', nullable: true, example: 'tg://webproxy?server=proxy.example.com&secret=dd...', description: 'Ссылка Web Proxy (если включён)' },
        mtproto: { type: 'string', nullable: true, example: 'tg://proxy?server=proxy.example.com&port=8443&secret=dd...', description: 'Ссылка MTProto (если включён)' },
        web_https: { type: 'string', nullable: true, description: 'https://t.me/... вариант ссылки Web Proxy' },
        mtproto_https: { type: 'string', nullable: true, description: 'https://t.me/... вариант ссылки MTProto' },
    },
};

// Стандартные ответы об ошибках
const errResponse = (description) => ({
    description,
    content: { 'application/json': { schema: { type: 'object', properties: { error: { type: 'string' } } } } },
});

const idParam = { name: 'id', in: 'path', required: true, schema: { type: 'integer' }, description: 'ID клиента' };

module.exports = {
    openapi: '3.0.3',
    info: {
        title: 'TGGATE Public API',
        version: '1.0.0',
        description:
            'Публичный API панели TGGATE для разработки ботов продаж и интеграций.\n\n' +
            '## Быстрый старт бота\n' +
            '1. Создайте API-ключ в панели (раздел «API-ключи»), права `write`\n' +
            '2. `POST /clients` — создать клиент: срок (`days`), квота (`quota_gb`), лимит IP (`max_ips`), скорости, протоколы (`protocols`)\n' +
            '3. В ответе придут готовые ссылки `links.web_https` / `links.mtproto_https` — отправьте их клиенту\n' +
            '4. `GET /clients/{id}/connections` — активные подключения клиента (IP, страна)\n' +
            '5. `POST /extend/{id}` — продлить доступ\n\n' +
            'Лимит: 60 запросов/мин на ключ. Все ошибки — `{ "error": "текст" }`.',
    },
    servers: [{ url: '/panel-api/v1' }],
    tags: [
        { name: 'Клиенты', description: 'Создание и управление клиентами' },
        { name: 'Подключения', description: 'Кто сейчас подключён, IP и страны' },
        { name: 'Статистика', description: 'Сервер и трафик' },
        { name: 'Тарифы', description: 'Тарифы для ботов продаж' },
        { name: 'Вебхуки', description: 'События для внешних сервисов' },
    ],
    components: {
        securitySchemes: {
            ApiKey: { type: 'http', scheme: 'bearer', description: 'API-ключ формата tgk_... (раздел «API-ключи» в панели)' },
        },
        schemas: {
            Client: clientSchema,
            Links: linksSchema,
        },
    },
    security: [{ ApiKey: [] }],
    paths: {
        '/clients': {
            get: {
                tags: ['Клиенты'],
                summary: 'Список клиентов',
                responses: {
                    200: {
                        description: 'OK',
                        content: { 'application/json': { schema: { type: 'object', properties: { clients: { type: 'array', items: clientSchema } } } } },
                    },
                    401: errResponse('Нет/неверен API-ключ'),
                },
            },
            post: {
                tags: ['Клиенты'],
                summary: 'Создать клиента (все параметры для ботов)',
                description: 'Создаёт пользователя прокси и возвращает готовые ссылки подключения. ' +
                    'Протоколы: `web` — только Web Proxy, `mtproto` — только MTProto, `both` — оба (по умолчанию). ' +
                    '`max_ips` ограничивает число одновременных активных IP у клиента.',
                requestBody: {
                    required: true,
                    content: {
                        'application/json': {
                            schema: {
                                type: 'object',
                                required: ['username'],
                                properties: {
                                    username: { type: 'string', example: 'ivan', description: 'Логин: латиница, цифры, _ . -' },
                                    days: { type: 'integer', example: 30, description: 'Срок доступа в днях (пусто = бессрочно)' },
                                    quota_gb: { type: 'number', example: 50, description: 'Квота трафика в ГБ (пусто = безлимит)' },
                                    max_ips: { type: 'integer', example: 3, description: 'Максимум одновременных IP (пусто = без лимита)' },
                                    rate_down_mbps: { type: 'number', example: 100, description: 'Скорость скачивания, Мбит/с' },
                                    rate_up_mbps: { type: 'number', example: 50, description: 'Скорость загрузки, Мбит/с' },
                                    protocols: { type: 'string', enum: ['web', 'mtproto', 'both'], example: 'both', description: 'Протоколы доступа (по умолчанию both)' },
                                    ad_tag: { type: 'string', example: '0123abc...', description: 'Ad Tag спонсора (32 hex) — спонсорский канал в списке чатов клиента' },
                                    telegram_id: { type: 'integer', example: 123456789, description: 'Telegram ID клиента — для будущих рассылок' },
                                },
                            },
                        },
                    },
                },
                responses: {
                    201: {
                        description: 'Клиент создан. В links — готовые ссылки для отправки клиенту.',
                        content: {
                            'application/json': {
                                schema: { type: 'object', properties: { client: clientSchema, links: linksSchema } },
                            },
                        },
                    },
                    409: errResponse('Клиент с таким именем уже существует'),
                },
            },
        },
        '/clients/{id}': {
            get: {
                tags: ['Клиенты'],
                summary: 'Получить клиента',
                parameters: [idParam],
                responses: { 200: { description: 'OK' }, 404: errResponse('Не найден') },
            },
            patch: {
                tags: ['Клиенты'],
                summary: 'Обновить клиента (продление, лимиты, статус)',
                description: 'PATCH-семантика: меняйте только нужные поля. `days` ДОБАВЛЯЕТ дней к текущему сроку. ' +
                    '`enabled: false` блокирует клиента (сессии рвутся немедленно), `true` — включает.',
                parameters: [idParam],
                requestBody: {
                    content: {
                        'application/json': {
                            schema: {
                                type: 'object',
                                properties: {
                                    days: { type: 'integer', example: 30, description: 'Добавить дней к сроку' },
                                    quota_gb: { type: 'number', nullable: true, example: 100 },
                                    max_ips: { type: 'integer', nullable: true, example: 5 },
                                    rate_down_mbps: { type: 'number', nullable: true },
                                    rate_up_mbps: { type: 'number', nullable: true },
                                    protocols: { type: 'string', enum: ['web', 'mtproto', 'both'] },
                                    enabled: { type: 'boolean', example: false, description: 'Блокировка/разблокировка' },
                                },
                            },
                        },
                    },
                },
                responses: { 200: { description: 'OK' }, 404: errResponse('Не найден') },
            },
            delete: {
                tags: ['Клиенты'],
                summary: 'Удалить клиента',
                parameters: [idParam],
                responses: { 200: { description: 'Удалён' }, 404: errResponse('Не найден') },
            },
        },
        '/clients/{id}/links': {
            get: {
                tags: ['Клиенты'],
                summary: 'Ссылки подключения клиента',
                description: 'Возвращает tg:// и https://t.me ссылки для каждого включённого протокола. Отправляйте клиенту `*_https` варианты.',
                parameters: [idParam],
                responses: { 200: { description: 'OK', content: { 'application/json': { schema: { type: 'object', properties: { links: linksSchema } } } } } },
            },
        },
        '/clients/{id}/qr': {
            get: {
                tags: ['Клиенты'],
                summary: 'QR-коды клиента (base64 data URL)',
                parameters: [idParam],
                responses: { 200: { description: 'OK — { qr: { web: "data:image/png;base64,...", mtproto: "..." } }' } },
            },
        },
        '/clients/{id}/connections': {
            get: {
                tags: ['Подключения'],
                summary: 'Активные подключения клиента',
                description: 'Кто подключён прямо сейчас: IP, страна, протокол. Пусто — клиент оффлайн.',
                parameters: [idParam],
                responses: {
                    200: {
                        description: 'OK',
                        content: {
                            'application/json': {
                                schema: {
                                    type: 'object',
                                    properties: {
                                        active: { type: 'integer', example: 2 },
                                        connections: {
                                            type: 'array',
                                            items: {
                                                type: 'object',
                                                properties: {
                                                    ip: { type: 'string', example: '1.2.3.4' },
                                                    country: { type: 'string', example: 'Германия' },
                                                    protocol: { type: 'string', enum: ['web', 'mtproto'] },
                                                    carrier: { type: 'string', nullable: true },
                                                },
                                            },
                                        },
                                    },
                                },
                            },
                        },
                    },
                },
            },
        },
        '/extend/{id}': {
            post: {
                tags: ['Клиенты'],
                summary: 'Продлить доступ клиенту',
                parameters: [idParam],
                requestBody: {
                    required: true,
                    content: { 'application/json': { schema: { type: 'object', required: ['days'], properties: { days: { type: 'integer', example: 30 } } } } },
                },
                responses: { 200: { description: 'Продлён' }, 404: errResponse('Не найден') },
            },
        },
        '/stats': {
            get: {
                tags: ['Статистика'],
                summary: 'Статистика сервера',
                responses: { 200: { description: 'OK — клиенты панели + счётчики Telemt' } },
            },
        },
        '/stats/traffic': {
            get: {
                tags: ['Статистика'],
                summary: 'Трафик по дням за 30 дней',
                responses: { 200: { description: 'OK' } },
            },
        },
        '/tariffs': {
            get: {
                tags: ['Тарифы'],
                summary: 'Список активных тарифов',
                description: 'Используйте для отображения тарифов в боте продаж.',
                responses: {
                    200: {
                        description: 'OK',
                        content: {
                            'application/json': {
                                schema: {
                                    type: 'object',
                                    properties: {
                                        tariffs: {
                                            type: 'array',
                                            items: {
                                                type: 'object',
                                                properties: {
                                                    id: { type: 'integer' },
                                                    name: { type: 'string', example: '🔥 Web прокси 30 дней' },
                                                    days: { type: 'integer', example: 30 },
                                                    price: { type: 'number', example: 199 },
                                                    currency: { type: 'string', example: 'RUB' },
                                                    protocols: { type: 'string', enum: ['web', 'mtproto', 'both'] },
                                                    max_ips: { type: 'integer', nullable: true, example: 3, description: 'Лимит одновременных IP (null = без ограничений)' },
                                                    quota_gb: { type: 'number', nullable: true, example: 50, description: 'Квота трафика в ГБ (null = безлимит)' },
                                                },
                                            },
                                        },
                                    },
                                },
                            },
                        },
                    },
                },
            },
        },
        '/webhooks': {
            post: {
                tags: ['Вебхуки'],
                summary: 'Зарегистрировать вебхук',
                description: 'На каждое событие TGGATE будет POST-ить JSON на ваш URL ' +
                    'с подписью `X-TGGATE-Signature: sha256=<hmac от тела ключом secret>`.',
                requestBody: {
                    required: true,
                    content: {
                        'application/json': {
                            schema: {
                                type: 'object',
                                required: ['event', 'url'],
                                properties: {
                                    event: { type: 'string', enum: ['client.created', 'client.expired', 'client.blocked', 'payment.success', 'quota.exceeded'] },
                                    url: { type: 'string', format: 'uri', example: 'https://мой-бот.рф/hook' },
                                },
                            },
                        },
                    },
                },
                responses: {
                    201: {
                        description: 'Создан — сохраните secret для проверки подписи',
                        content: { 'application/json': { schema: { type: 'object', properties: { id: { type: 'integer' }, secret: { type: 'string' } } } } },
                    },
                },
            },
        },
    },
};
