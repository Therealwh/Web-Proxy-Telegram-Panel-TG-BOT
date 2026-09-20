// Настройка Telegram-бота продаж: админка (пользователи, баланс), тарифы, платежки
import React, { useEffect, useState } from 'react';
import { Plus, Save, Trash2, Power, Wallet, MessageSquare, ChevronDown } from 'lucide-react';
import { get, post, put, del } from '../api';
import { toast } from '../store';
import { Card, Field, Toggle, Skeleton, Modal, StatusBadge, formatDate, formatBytes } from '../components/ui';

export default function Bot() {
    const [settings, setSettings] = useState(null);
    const [tariffs, setTariffs] = useState(null);
    const [botStatus, setBotStatus] = useState(null);
    const [stats, setStats] = useState(null);
    const [users, setUsers] = useState(null);
    const [balanceModal, setBalanceModal] = useState(null); // {tgId, name}
    const [balanceAmount, setBalanceAmount] = useState('');
    const [msgModal, setMsgModal] = useState(null); // {tgId, name}
    const [msgText, setMsgText] = useState('');
    const [expanded, setExpanded] = useState(null); // раскрытый tgId

    const load = () => {
        get('/bot/status').then(setBotStatus).catch(() => setBotStatus({ running: false }));
        get('/bot/settings').then((d) => setSettings(d)).catch((e) => toast.error(e.message));
        get('/bot/tariffs').then((d) => setTariffs(d.tariffs)).catch(() => {});
        get('/bot/stats').then(setStats).catch(() => {});
        get('/bot/users').then((d) => setUsers(d.users)).catch(() => {});
    };
    useEffect(load, []);

    const saveSettings = async () => {
        try {
            await put('/bot/settings', settings);
            toast.success('Настройки бота сохранены');
            load();
        } catch (e) {
            toast.error(e.message);
        }
    };

    const saveTariff = async (t) => {
        // Нормализация: пустые строки → null (без лимита)
        const payload = {
            ...t,
            max_ips: t.max_ips === '' || t.max_ips == null ? null : Number(t.max_ips),
            quota_gb: t.quota_gb === '' || t.quota_gb == null ? null : Number(t.quota_gb),
        };
        try {
            if (payload.id) {
                await put(`/bot/tariffs/${payload.id}`, payload);
            } else {
                await post('/bot/tariffs', payload);
            }
            toast.success('Тариф сохранён');
            load();
        } catch (e) {
            toast.error(e.message);
        }
    };

    const deleteTariff = async (id) => {
        if (!confirm('Удалить тариф?')) return;
        try {
            await del(`/bot/tariffs/${id}`);
            load();
        } catch (e) {
            toast.error(e.message);
        }
    };

    if (!settings || !tariffs) return <div className="space-y-4">{[...Array(3)].map((_, i) => <Skeleton key={i} className="h-48" />)}</div>;

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <h1 className="text-2xl font-bold">Telegram бот продаж</h1>
                <span className={botStatus?.running ? 'badge-green' : 'badge-red'}>
                    {botStatus?.running ? '✅ Бот запущен' : '❌ Бот остановлен'}
                </span>
            </div>

            {/* Статистика продаж */}
            {stats && (
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                    <Card><div className="text-2xl font-bold">{stats.sales_total}</div><div className="text-sm text-slate-500">Продаж всего</div></Card>
                    <Card><div className="text-2xl font-bold">{stats.sales_month}</div><div className="text-sm text-slate-500">За месяц</div></Card>
                    <Card><div className="text-2xl font-bold">{stats.revenue_month} ₽</div><div className="text-sm text-slate-500">Доход за месяц</div></Card>
                    <Card><div className="text-2xl font-bold">{stats.revenue_total} ₽</div><div className="text-sm text-slate-500">Доход всего</div></Card>
                </div>
            )}

            {/* ═══ Админка бота: пользователи Telegram ═══ */}
            <Card title="👥 Пользователи бота"
                  subtitle="Все, кто получил прокси через бота (сгруппированы по Telegram)"
                  actions={
                      <button className="btn-secondary !min-h-0 !px-3 !py-1.5 text-sm" onClick={load}>
                          Обновить
                      </button>
                  }>
                {!users ? <Skeleton className="h-24" /> : users.length === 0 ? (
                    <p className="text-sm text-slate-500 py-4 text-center">Пользователей бота пока нет</p>
                ) : (
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="text-left text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-slate-700">
                                <th className="py-2 pr-4 font-medium">Telegram ID</th>
                                <th className="py-2 pr-4 font-medium">Прокси</th>
                                <th className="py-2 pr-4 font-medium">Баланс</th>
                                <th className="py-2 pr-4 font-medium text-right">Действия</th>
                            </tr>
                        </thead>
                        <tbody>
                            {users.map((u) => (
                                <React.Fragment key={u.telegram_id}>
                                    <tr className="border-b border-slate-100 dark:border-slate-800">
                                        <td className="py-2 pr-4">
                                            <button className="flex items-center gap-1 font-mono text-xs hover:text-primary transition-colors"
                                                    onClick={() => setExpanded(expanded === u.telegram_id ? null : u.telegram_id)}>
                                                <ChevronDown size={14} className={`transition-transform ${expanded === u.telegram_id ? 'rotate-180' : ''}`} />
                                                {u.telegram_id}
                                            </button>
                                        </td>
                                        <td className="py-2 pr-4">
                                            <span className="badge-green">🟢 {u.active} актив.</span>{' '}
                                            <span className="text-xs text-slate-400">всего {u.proxies.length}</span>
                                        </td>
                                        <td className="py-2 pr-4 font-medium">{u.balance.toFixed(2)}</td>
                                        <td className="py-2 pr-4">
                                            <div className="flex justify-end gap-1">
                                                <button className="btn-secondary !min-h-0 !px-2 !py-1.5 text-xs"
                                                        title="Выдать баланс"
                                                        onClick={() => { setBalanceModal(u); setBalanceAmount(''); }}>
                                                    <Wallet size={14} /> Баланс
                                                </button>
                                                <button className="btn-secondary !min-h-0 !px-2 !py-1.5 text-xs"
                                                        title="Написать через бота"
                                                        onClick={() => { setMsgModal(u); setMsgText(''); }}>
                                                    <MessageSquare size={14} /> Написать
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                    {/* Раскрытый список прокси пользователя */}
                                    {expanded === u.telegram_id && (
                                        <tr className="border-b border-slate-100 dark:border-slate-800">
                                            <td colSpan={4} className="py-3 px-4 bg-slate-50 dark:bg-slate-800/50 rounded-lg">
                                                <table className="w-full text-xs">
                                                    <thead>
                                                        <tr className="text-left text-slate-400">
                                                            <th className="py-1 pr-4">Прокси</th>
                                                            <th className="py-1 pr-4">Статус</th>
                                                            <th className="py-1 pr-4">Действует до</th>
                                                            <th className="py-1">Баланс</th>
                                                        </tr>
                                                    </thead>
                                                    <tbody>
                                                        {u.proxies.map((p) => (
                                                            <tr key={p.id}>
                                                                <td className="py-1 pr-4 font-mono">{p.username}</td>
                                                                <td className="py-1 pr-4"><StatusBadge status={p.status} /></td>
                                                                <td className="py-1 pr-4">{p.expires_at ? formatDate(p.expires_at).split(',')[0] : '∞'}</td>
                                                                <td className="py-1">{(p.balance || 0).toFixed(2)}</td>
                                                            </tr>
                                                        ))}
                                                    </tbody>
                                                </table>
                                            </td>
                                        </tr>
                                    )}
                                </React.Fragment>
                            ))}
                        </tbody>
                    </table>
                )}
            </Card>

            {/* Модал: выдать/списать баланс */}
            <Modal open={!!balanceModal} onClose={() => setBalanceModal(null)}
                   title={`Баланс: ${balanceModal?.telegram_id}`}>
                <Field label="Сумма" hint="Положительная — начислить, отрицательная — списать">
                    <input className="input" type="number" value={balanceAmount}
                           onChange={(e) => setBalanceAmount(e.target.value)} autoFocus />
                </Field>
                <div className="flex justify-end gap-2 mt-4">
                    <button className="btn-secondary" onClick={() => setBalanceModal(null)}>Отмена</button>
                    <button className="btn-primary" disabled={!balanceAmount}
                            onClick={async () => {
                                try {
                                    await post(`/bot/users/${balanceModal.telegram_id}/balance`, { amount: Number(balanceAmount) });
                                    toast.success('Баланс изменён');
                                    setBalanceModal(null);
                                    load();
                                } catch (e) { toast.error(e.message); }
                            }}>
                        Применить
                    </button>
                </div>
            </Modal>

            {/* Модал: написать пользователю через бота */}
            <Modal open={!!msgModal} onClose={() => setMsgModal(null)}
                   title={`Сообщение: ${msgModal?.telegram_id}`}>
                <Field label="Текст (HTML разрешён)">
                    <textarea className="input min-h-[100px]" value={msgText}
                              onChange={(e) => setMsgText(e.target.value)} autoFocus />
                </Field>
                <div className="flex justify-end gap-2 mt-4">
                    <button className="btn-secondary" onClick={() => setMsgModal(null)}>Отмена</button>
                    <button className="btn-primary" disabled={!msgText.trim()}
                            onClick={async () => {
                                try {
                                    await post(`/bot/users/${msgModal.telegram_id}/message`, { text: msgText });
                                    toast.success('Отправлено через бота');
                                    setMsgModal(null);
                                } catch (e) { toast.error(e.message); }
                            }}>
                        Отправить
                    </button>
                </div>
            </Modal>

            {/* Кастомные кнопки в боте */}
            <Card title="🔗 Кастомные кнопки в боте"
                  subtitle="Появятся в меню тарифов — ссылки на каналы, ботов, сайты">
                {!settings ? <Skeleton className="h-20" /> : (
                    <div className="space-y-2">
                        {(settings.custom_buttons || []).map((b, i) => (
                            <div key={i} className="flex flex-wrap items-center gap-2 p-2 rounded-lg bg-slate-50 dark:bg-slate-800/50">
                                <input className="input !w-44" placeholder="НАЗВАНИЕ КНОПКИ"
                                       value={b.name}
                                       onChange={(e) => setSettings((s) => ({
                                           ...s,
                                           custom_buttons: s.custom_buttons.map((x, j) => j === i ? { ...x, name: e.target.value } : x),
                                       }))} />
                                <input className="input flex-1 min-w-[200px] font-mono text-xs" placeholder="https://t.me/channel"
                                       value={b.url}
                                       onChange={(e) => setSettings((s) => ({
                                           ...s,
                                           custom_buttons: s.custom_buttons.map((x, j) => j === i ? { ...x, url: e.target.value } : x),
                                       }))} />
                                <Toggle label="Вкл" checked={b.enabled !== false}
                                        onChange={(v) => setSettings((s) => ({
                                            ...s,
                                            custom_buttons: s.custom_buttons.map((x, j) => j === i ? { ...x, enabled: v } : x),
                                        }))} />
                                <button className="btn-ghost !min-h-0 !p-2 text-red-500"
                                        onClick={() => setSettings((s) => ({
                                            ...s,
                                            custom_buttons: s.custom_buttons.filter((_, j) => j !== i),
                                        }))}>
                                    <Trash2 size={14} />
                                </button>
                            </div>
                        ))}
                        {!(settings.custom_buttons && settings.custom_buttons.length >= 8) && (
                            <button className="btn-secondary text-sm"
                                    onClick={() => setSettings((s) => ({
                                        ...s,
                                        custom_buttons: [...(s.custom_buttons || []), { name: '', url: 'https://', enabled: true }],
                                    }))}>
                                <Plus size={14} /> Добавить кнопку
                            </button>
                        )}
                        </div>
                    )}
                </Card>

            {/* Основные настройки */}
            <Card title="🤖 Основные настройки" actions={<button className="btn-primary !min-h-0 !px-3 !py-1.5 text-sm" onClick={saveSettings}><Save size={14} /> Сохранить</button>}>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <Field label="Bot Token" hint="Получите у @BotFather в Telegram">
                        <input className="input font-mono" value={settings.bot_token ?? ''}
                               onChange={(e) => setSettings({ ...settings, bot_token: e.target.value })} />
                    </Field>
                    <Field label="Валюта цен">
                        <select className="input" value={settings.currency ?? 'RUB'}
                                onChange={(e) => setSettings({ ...settings, currency: e.target.value })}>
                            <option value="RUB">₽ Рубли</option>
                            <option value="USD">$ Доллары</option>
                            <option value="USDT">₮ USDT</option>
                        </select>
                    </Field>
                    <Field label="Приветственное сообщение" hint="Переменные: {имя}, {ссылка}, {дата}. Пусто — встроенное красивое приветствие">
                        <textarea className="input min-h-[100px]" value={settings.welcome_text ?? ''}
                                  onChange={(e) => setSettings({ ...settings, welcome_text: e.target.value })} />
                    </Field>
                    <div className="space-y-3">
                        <Toggle label="Бот включён" checked={!!settings.enabled}
                                onChange={(v) => setSettings({ ...settings, enabled: v })} />
                        <Toggle label="Уведомлять админа о покупках" checked={!!settings.notify_admin}
                                onChange={(v) => setSettings({ ...settings, notify_admin: v })} />
                    </div>
                </div>
            </Card>

            {/* Обязательная подписка на канал */}
            <Card title="📢 Обязательная подписка на канал"
                  subtitle="Бот не будет работать, пока пользователь не подпишется на канал">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <Field label="Юзернейм канала" hint="Например: @my_proxy_channel (бот должен быть админом канала)">
                        <input className="input font-mono" placeholder="@my_proxy_channel"
                               value={settings.channel_username ?? ''}
                               onChange={(e) => setSettings({ ...settings, channel_username: e.target.value })} />
                    </Field>
                    <div className="flex items-end pb-2">
                        <Toggle label="Требовать подписку для пользования ботом"
                                checked={!!settings.channel_required}
                                onChange={(v) => setSettings({ ...settings, channel_required: v })} />
                    </div>
                </div>
                <p className="text-xs text-slate-400 mt-3">
                    ⚠️ Добавьте бота администратором в канал, иначе проверка подписи работать не будет
                    (при недоступности канала проверка автоматически отключается).
                </p>
            </Card>

            {/* Платёжные системы */}
            <Card title="💳 Платёжные системы"
                  subtitle="Настройте одну из них — счёт будет создаваться автоматически, доступ выдаётся после оплаты"
                  actions={<button className="btn-primary !min-h-0 !px-3 !py-1.5 text-sm" onClick={saveSettings}><Save size={14} /> Сохранить</button>}>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <Field label="🪙 CryptoBot (CryptoCloud) — токен" hint="Из @CryptoBot → Crypto Pay → Create App">
                        <input className="input font-mono" value={settings.cryptobot_token ?? ''}
                               onChange={(e) => setSettings({ ...settings, cryptobot_token: e.target.value })} />
                    </Field>
                    <div />
                    <Field label="🏦 ЮKassa — shopId">
                        <input className="input font-mono" value={settings.yookassa_shop_id ?? ''}
                               onChange={(e) => setSettings({ ...settings, yookassa_shop_id: e.target.value })} />
                    </Field>
                    <Field label="🏦 ЮKassa — секретный ключ">
                        <input className="input font-mono" type="password" value={settings.yookassa_secret_key ?? ''}
                               onChange={(e) => setSettings({ ...settings, yookassa_secret_key: e.target.value })} />
                    </Field>
                    <Field label="📝 Инструкция для ручной оплаты" hint="Показывается в боте, если ни одна платёжка не подключена" className="md:col-span-2">
                        <textarea className="input min-h-[70px]" value={settings.payment_instructions ?? ''}
                                  onChange={(e) => setSettings({ ...settings, payment_instructions: e.target.value })} />
                    </Field>
                </div>
                <p className="text-xs text-slate-400 mt-3">
                    Вебхуки: ЮKassa → <code className="font-mono">/api/payments/webhook/yookassa</code>,
                    CryptoBot → <code className="font-mono">/api/payments/webhook/cryptobot</code>.
                    Вебхук CryptoBot нужно включить в @CryptoBot (Webhooks).
                </p>
            </Card>

            {/* Тарифы */}
            <Card title="💰 Тарифы" actions={
                <button className="btn-secondary !min-h-0 !px-3 !py-1.5 text-sm"
                        onClick={() => setTariffs([...tariffs, { name: '', days: 30, price: 100, protocols: 'both', max_ips: null, quota_gb: null, enabled: 1 }])}>
                    <Plus size={14} /> Добавить
                </button>
            }>
                <div className="space-y-3">
                    {tariffs.map((t, i) => (
                        <div key={t.id ?? i} className="grid grid-cols-2 md:grid-cols-8 gap-2 items-end p-3 rounded-lg bg-slate-50 dark:bg-slate-800/50">
                            <Field label="Название" hint="Можно со смайлами 🚀💎🔥">
                                <input className="input" value={t.name}
                                       onChange={(e) => setTariffs(tariffs.map((x, j) => j === i ? { ...x, name: e.target.value } : x))} />
                            </Field>
                            <Field label="Дней">
                                <input className="input" type="number" min="1" value={t.days}
                                       onChange={(e) => setTariffs(tariffs.map((x, j) => j === i ? { ...x, days: Number(e.target.value) } : x))} />
                            </Field>
                            <Field label="Цена">
                                <input className="input" type="number" min="0" value={t.price}
                                       onChange={(e) => setTariffs(tariffs.map((x, j) => j === i ? { ...x, price: Number(e.target.value) } : x))} />
                            </Field>
                            <Field label="Макс. IP" hint="Пусто = ∞">
                                <input className="input" type="number" min="1" value={t.max_ips ?? ''}
                                       onChange={(e) => setTariffs(tariffs.map((x, j) => j === i ? { ...x, max_ips: e.target.value === '' ? null : Number(e.target.value) } : x))} />
                            </Field>
                            <Field label="Трафик, ГБ" hint="Пусто = ∞">
                                <input className="input" type="number" min="0" value={t.quota_gb ?? ''}
                                       onChange={(e) => setTariffs(tariffs.map((x, j) => j === i ? { ...x, quota_gb: e.target.value === '' ? null : Number(e.target.value) } : x))} />
                            </Field>
                            <Field label="Протоколы">
                                <select className="input" value={t.protocols}
                                        onChange={(e) => setTariffs(tariffs.map((x, j) => j === i ? { ...x, protocols: e.target.value } : x))}>
                                    <option value="both">Оба</option>
                                    <option value="web">Web Proxy</option>
                                    <option value="mtproto">MTProto</option>
                                </select>
                            </Field>
                            <Toggle label="Включён" checked={!!t.enabled}
                                    onChange={(v) => setTariffs(tariffs.map((x, j) => j === i ? { ...x, enabled: v ? 1 : 0 } : x))} />
                            <div className="flex gap-1">
                                <button className="btn-primary !min-h-0 !px-3 !py-2 text-sm" onClick={() => saveTariff(t)}><Save size={14} /></button>
                                {t.id && <button className="btn-danger !min-h-0 !px-3 !py-2 text-sm" onClick={() => deleteTariff(t.id)}><Trash2 size={14} /></button>}
                            </div>
                        </div>
                    ))}
                    {tariffs.length === 0 && <p className="text-sm text-slate-500 text-center py-4">Тарифов нет — добавьте первый</p>}
                </div>
            </Card>
        </div>
    );
}
