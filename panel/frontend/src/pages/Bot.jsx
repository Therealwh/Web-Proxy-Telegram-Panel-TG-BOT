// Настройка Telegram-бота продаж: токен, приветствие, тарифы
import React, { useEffect, useState } from 'react';
import { Plus, Save, Trash2, Power } from 'lucide-react';
import { get, post, put, del } from '../api';
import { toast } from '../store';
import { Card, Field, Toggle, Skeleton } from '../components/ui';

export default function Bot() {
    const [settings, setSettings] = useState(null);
    const [tariffs, setTariffs] = useState(null);
    const [botStatus, setBotStatus] = useState(null);
    const [stats, setStats] = useState(null);

    const load = () => {
        get('/bot/status').then(setBotStatus).catch(() => setBotStatus({ running: false }));
        get('/bot/settings').then((d) => setSettings(d)).catch((e) => toast.error(e.message));
        get('/bot/tariffs').then((d) => setTariffs(d.tariffs)).catch(() => {});
        get('/bot/stats').then(setStats).catch(() => {});
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
        try {
            if (t.id) {
                await put(`/bot/tariffs/${t.id}`, t);
            } else {
                await post('/bot/tariffs', t);
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
                    <Field label="Приветственное сообщение" hint="Переменные: {имя}, {ссылка}, {дата}">
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

            {/* Тарифы */}
            <Card title="💰 Тарифы" actions={
                <button className="btn-secondary !min-h-0 !px-3 !py-1.5 text-sm"
                        onClick={() => setTariffs([...tariffs, { name: '', days: 30, price: 100, protocols: 'both', enabled: 1 }])}>
                    <Plus size={14} /> Добавить
                </button>
            }>
                <div className="space-y-3">
                    {tariffs.map((t, i) => (
                        <div key={t.id ?? i} className="grid grid-cols-2 md:grid-cols-6 gap-2 items-end p-3 rounded-lg bg-slate-50 dark:bg-slate-800/50">
                            <Field label="Название">
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
