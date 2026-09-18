// Документация для разработчиков: примеры использования публичного API
import React from 'react';
import { Card } from '../components/ui';

const PY_EXAMPLE = `# Пример бота на Python (aiogram 3.x)
from aiogram import Bot, Dispatcher
import aiohttp

API_URL = "https://ваш-домен/api/v1"
API_KEY = "tgk_ваш_ключ"

async def create_client(username: str) -> dict:
    async with aiohttp.ClientSession() as s:
        async with s.post(
            f"{API_URL}/clients",
            headers={"Authorization": f"Bearer {API_KEY}"},
            json={"username": username, "days": 30},
        ) as r:
            return await r.json()
`;

const JS_EXAMPLE = `// Пример на Node.js
const API_URL = 'https://ваш-домен/api/v1';
const API_KEY = 'tgk_ваш_ключ';

async function createClient(username) {
    const res = await fetch(\`\${API_URL}/clients\`, {
        method: 'POST',
        headers: {
            Authorization: \`Bearer \${API_KEY}\`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ username, days: 30 }),
    });
    return res.json();
}
`;

const CURL_EXAMPLE = `# Список клиентов
curl -H "Authorization: Bearer tgk_ваш_ключ" \\
  https://ваш-домен/api/v1/clients

# Создать клиента
curl -X POST -H "Authorization: Bearer tgk_ваш_ключ" \\
  -H "Content-Type: application/json" \\
  -d '{"username":"ivan","days":30}' \\
  https://ваш-домен/api/v1/clients
`;

function CodeBlock({ title, code }) {
    return (
        <div>
            <h4 className="text-sm font-medium mb-2">{title}</h4>
            <pre className="rounded-lg bg-slate-100 dark:bg-slate-800 p-4 text-xs font-mono overflow-x-auto">{code}</pre>
        </div>
    );
}

export default function Developers() {
    return (
        <div className="space-y-4">
            <h1 className="text-2xl font-bold">Для разработчиков</h1>

            <Card title="🔌 Публичный API">
                <p className="text-sm text-slate-500 dark:text-slate-400 mb-4">
                    Все запросы к <code className="font-mono text-xs">/api/v1/*</code> требуют заголовок{' '}
                    <code className="font-mono text-xs">Authorization: Bearer &lt;ключ&gt;</code>.
                    Ключи создаются в разделе «API-ключи». Полная интерактивная документация:{' '}
                    <a href="/api/docs" target="_blank" rel="noreferrer" className="text-primary underline">/api/docs</a> (Swagger UI).
                </p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
                    {[
                        ['GET', '/api/v1/clients', 'Список клиентов'],
                        ['POST', '/api/v1/clients', 'Создать клиента'],
                        ['PUT', '/api/v1/clients/{id}', 'Обновить клиента'],
                        ['DELETE', '/api/v1/clients/{id}', 'Удалить клиента'],
                        ['GET', '/api/v1/clients/{id}/links', 'Ссылки подключения'],
                        ['GET', '/api/v1/clients/{id}/qr', 'QR-код (base64)'],
                        ['GET', '/api/v1/stats', 'Статистика сервера'],
                        ['GET', '/api/v1/tariffs', 'Список тарифов'],
                        ['POST', '/api/v1/extend/{id}', 'Продлить доступ'],
                    ].map(([m, p, d]) => (
                        <div key={p + m} className="flex items-center gap-2">
                            <span className={`badge ${m === 'GET' ? 'badge-blue' : m === 'POST' ? 'badge-green' : m === 'DELETE' ? 'badge-red' : 'badge-yellow'}`}>{m}</span>
                            <code className="font-mono text-xs">{p}</code>
                            <span className="text-xs text-slate-500">{d}</span>
                        </div>
                    ))}
                </div>
            </Card>

            <Card title="🪝 Вебхуки">
                <p className="text-sm text-slate-500 dark:text-slate-400">
                    События: <code className="font-mono text-xs">client.created</code>,{' '}
                    <code className="font-mono text-xs">client.expired</code>,{' '}
                    <code className="font-mono text-xs">client.blocked</code>,{' '}
                    <code className="font-mono text-xs">payment.success</code>,{' '}
                    <code className="font-mono text-xs">quota.exceeded</code>.
                    Каждый запрос подписан HMAC-SHA256 в заголовке <code className="font-mono text-xs">X-TGGATE-Signature</code>.
                </p>
            </Card>

            <Card title="📖 Примеры кода">
                <div className="space-y-6">
                    <CodeBlock title="cURL" code={CURL_EXAMPLE} />
                    <CodeBlock title="🐍 Python (aiogram)" code={PY_EXAMPLE} />
                    <CodeBlock title="🟨 Node.js" code={JS_EXAMPLE} />
                </div>
            </Card>
        </div>
    );
}
