/**
 * @fileoverview OpenAPI-спецификация публичного API TGGATE v1.
 * Отдаётся по /api/docs.json и визуализируется Swagger UI на /api/docs.
 * @module public-api/docs/openapi
 */

module.exports = {
    openapi: '3.0.3',
    info: {
        title: 'TGGATE Public API',
        version: '1.0.0',
        description: 'Публичный API панели TGGATE для разработчиков. Аутентификация: `Authorization: Bearer tgk_...`',
    },
    servers: [{ url: '/api/v1' }],
    components: {
        securitySchemes: {
            ApiKey: { type: 'http', scheme: 'bearer', description: 'API-ключ формата tgk_...' },
        },
        schemas: {
            Client: {
                type: 'object',
                properties: {
                    id: { type: 'integer' },
                    username: { type: 'string' },
                    status: { type: 'string', enum: ['active', 'blocked', 'expired'] },
                    quota_bytes: { type: 'integer', nullable: true },
                    traffic_used: { type: 'integer' },
                    expires_at: { type: 'string', format: 'date-time', nullable: true },
                },
            },
            Error: {
                type: 'object',
                properties: { error: { type: 'string' } },
            },
        },
    },
    security: [{ ApiKey: [] }],
    paths: {
        '/clients': {
            get: {
                summary: 'Список клиентов',
                responses: { 200: { description: 'OK' }, 401: { description: 'Нет ключа' } },
            },
            post: {
                summary: 'Создать клиента',
                requestBody: {
                    required: true,
                    content: {
                        'application/json': {
                            schema: {
                                type: 'object',
                                required: ['username'],
                                properties: {
                                    username: { type: 'string', example: 'ivan' },
                                    days: { type: 'integer', example: 30 },
                                    quota_gb: { type: 'number', example: 50 },
                                },
                            },
                        },
                    },
                },
                responses: { 201: { description: 'Создан' }, 409: { description: 'Уже существует' } },
            },
        },
        '/clients/{id}': {
            get: { summary: 'Получить клиента', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }], responses: { 200: { description: 'OK' }, 404: { description: 'Не найден' } } },
            delete: { summary: 'Удалить клиента', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }], responses: { 200: { description: 'Удалён' } } },
        },
        '/clients/{id}/links': {
            get: { summary: 'Ссылки подключения клиента', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }], responses: { 200: { description: 'OK' } } },
        },
        '/clients/{id}/qr': {
            get: { summary: 'QR-коды клиента (base64)', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }], responses: { 200: { description: 'OK' } } },
        },
        '/extend/{id}': {
            post: {
                summary: 'Продлить доступ клиенту',
                parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
                requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { days: { type: 'integer' } }, required: ['days'] } } } },
                responses: { 200: { description: 'Продлён' } },
            },
        },
        '/stats': { get: { summary: 'Статистика сервера', responses: { 200: { description: 'OK' } } } },
        '/stats/traffic': { get: { summary: 'Трафик за 30 дней', responses: { 200: { description: 'OK' } } } },
        '/tariffs': { get: { summary: 'Список тарифов', responses: { 200: { description: 'OK' } } } },
        '/webhooks': {
            post: {
                summary: 'Зарегистрировать вебхук',
                requestBody: {
                    content: {
                        'application/json': {
                            schema: {
                                type: 'object',
                                required: ['event', 'url'],
                                properties: {
                                    event: { type: 'string', enum: ['client.created', 'client.expired', 'client.blocked', 'payment.success', 'quota.exceeded'] },
                                    url: { type: 'string', format: 'uri' },
                                },
                            },
                        },
                    },
                },
                responses: { 201: { description: 'Создан' } },
            },
        },
    },
};
