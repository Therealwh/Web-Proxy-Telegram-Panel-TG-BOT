# 👨‍💻 Гайд для разработчиков

Создавайте своих ботов и интеграции поверх TGGATE через публичный API.

## Быстрый старт

1. Панель → **API-ключи** → создайте ключ с правами `write`
2. Читайте спеку: `https://ваш-домен/api/docs`
3. Пишите бота — примеры ниже

## Шаблон бота продаж на Python (aiogram 3.x)

```python
import asyncio
from aiogram import Bot, Dispatcher, types
from aiogram.filters import Command
import aiohttp

API_URL = "https://ваш-домен/api/v1"
API_KEY = "tgk_ваш_ключ"
TG_TOKEN = "токен_вашего_бота"

bot = Bot(TG_TOKEN)
dp = Dispatcher()

async def api(method, path, data=None):
    async with aiohttp.ClientSession() as s:
        async with s.request(
            method, f"{API_URL}{path}",
            headers={"Authorization": f"Bearer {API_KEY}"},
            json=data,
        ) as r:
            return await r.json()

@dp.message(Command("start"))
async def start(msg: types.Message):
    tariffs = (await api("GET", "/tariffs"))["tariffs"]
    kb = [[types.KeyboardButton(text=f"{t['name']} — {t['price']}₽")] for t in tariffs]
    await msg.answer("Выберите тариф:",
        reply_markup=types.ReplyKeyboardMarkup(keyboard=kb))

@dp.message(Command("buy"))
async def buy(msg: types.Message):
    username = f"tg{msg.from_user.id}"
    result = await api("POST", "/clients", {"username": username, "days": 30})
    links = result["links"]
    await msg.answer(f"Ваш доступ:\n🌐 {links['web_https']}\n🔌 {links['mtproto_https']}")

asyncio.run(dp.start_polling(bot))
```

## Шаблон на Node.js

```js
const API_URL = 'https://ваш-домен/api/v1';
const API_KEY = 'tgk_ваш_ключ';

async function api(method, path, body) {
    const res = await fetch(`${API_URL}${path}`, {
        method,
        headers: { Authorization: `Bearer ${API_KEY}`, 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) throw new Error((await res.json()).error);
    return res.json();
}

// Создать клиента и получить ссылки
const { client, links } = await api('POST', '/clients', { username: 'ivan', days: 30 });
console.log(links.web_https, links.mtproto_https);
```

## Вебхуки

Подпишитесь на события и принимайте POST с JSON:

```json
{ "event": "client.created", "data": { "username": "ivan" }, "ts": "..." }
```

Проверяйте подпись `X-TGGATE-Signature` (HMAC-SHA256 от тела, ключ — секрет вебхука).

## Правила

- Не храните ключи в коде — используйте переменные окружения
- Лимит: 60 запросов/мин на ключ
- При 401/403 проверьте ключ и права
