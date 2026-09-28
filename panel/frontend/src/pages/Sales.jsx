// Страница аналитики: продажи, выручка, конверсия теста, новые клиенты
import React, { useEffect, useState } from 'react';
import { AreaChart, Area, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { get } from '../api';
import { Card, Skeleton } from '../components/ui';

/** Компактная карточка-метрика */
function Metric({ value, label, accent }) {
    return (
        <Card>
            <div className={`text-2xl font-bold ${accent || ''}`}>{value}</div>
            <div className="text-sm text-slate-500">{label}</div>
        </Card>
    );
}

export default function Sales() {
    const [days, setDays] = useState(30);
    const [data, setData] = useState(null);

    const load = () => {
        get(`/sales/summary?days=${days}`).then(setData).catch(() => {});
    };
    useEffect(load, [days]);

    if (!data) return <div className="space-y-4">{[...Array(3)].map((_, i) => <Skeleton key={i} className="h-40" />)}</div>;

    const t = data.totals;

    return (
        <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <h1 className="text-2xl font-bold">Продажи и аналитика</h1>
                <select className="input !w-40" value={days} onChange={(e) => setDays(Number(e.target.value))}>
                    <option value={7}>7 дней</option>
                    <option value={30}>30 дней</option>
                    <option value={90}>90 дней</option>
                    <option value={365}>Год</option>
                </select>
            </div>

            {/* Метрики */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <Metric value={`${t.revenue} ₽`} label={`Выручка за ${days} дн.`} accent="text-emerald-500" />
                <Metric value={t.sales} label="Продаж" />
                <Metric value={t.active_clients} label="Активных прокси" />
                <Metric value={`${t.trial_conversion_pct}%`}
                        label={`Конверсия теста (${t.trial_converted} из ${t.trials})`} />
            </div>

            {/* Выручка по дням */}
            <Card title="💵 Выручка по дням">
                {data.revenue_by_day.length === 0 ? (
                    <p className="text-sm text-slate-500 py-8 text-center">Продаж за период не было</p>
                ) : (
                    <ResponsiveContainer width="100%" height={240}>
                        <AreaChart data={data.revenue_by_day}>
                            <defs>
                                <linearGradient id="rev" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="0%" stopColor="#10b981" stopOpacity={0.4} />
                                    <stop offset="100%" stopColor="#10b981" stopOpacity={0} />
                                </linearGradient>
                            </defs>
                            <CartesianGrid strokeDasharray="3 3" stroke="#334155" opacity={0.3} />
                            <XAxis dataKey="day" tick={{ fontSize: 11, fill: '#94a3b8' }} tickFormatter={(d) => d.slice(5)} />
                            <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} />
                            <Tooltip formatter={(v) => [`${v} ₽`, 'Выручка']} labelStyle={{ color: '#e2e8f0' }}
                                     contentStyle={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 8 }} />
                            <Area type="monotone" dataKey="total" stroke="#10b981" strokeWidth={2} fill="url(#rev)" />
                        </AreaChart>
                    </ResponsiveContainer>
                )}
            </Card>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {/* Топ тарифов */}
                <Card title="🏆 Топ тарифов (по выручке)">
                    {data.top_tariffs.length === 0 ? (
                        <p className="text-sm text-slate-500 py-6 text-center">Нет данных</p>
                    ) : (
                        <ResponsiveContainer width="100%" height={60 + data.top_tariffs.length * 40}>
                            <BarChart data={data.top_tariffs} layout="vertical">
                                <XAxis type="number" hide />
                                <YAxis type="category" dataKey="name" width={140} tick={{ fontSize: 12, fill: '#94a3b8' }} />
                                <Tooltip formatter={(v, name) => [v, name === 'revenue' ? 'Выручка ₽' : 'Продаж']}
                                         contentStyle={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 8 }} />
                                <Bar dataKey="revenue" fill="#3b82f6" radius={[0, 6, 6, 0]} barSize={20} />
                            </BarChart>
                        </ResponsiveContainer>
                    )}
                </Card>

                {/* Новые клиенты */}
                <Card title="👥 Новые клиенты по дням">
                    {data.new_clients_by_day.length === 0 ? (
                        <p className="text-sm text-slate-500 py-6 text-center">Нет данных</p>
                    ) : (
                        <ResponsiveContainer width="100%" height={220}>
                            <BarChart data={data.new_clients_by_day}>
                                <CartesianGrid strokeDasharray="3 3" stroke="#334155" opacity={0.3} />
                                <XAxis dataKey="day" tick={{ fontSize: 11, fill: '#94a3b8' }} tickFormatter={(d) => d.slice(5)} />
                                <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#94a3b8' }} />
                                <Tooltip formatter={(v) => [v, 'Новых клиентов']}
                                         contentStyle={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 8 }} />
                                <Bar dataKey="count" fill="#8b5cf6" radius={[6, 6, 0, 0]} />
                            </BarChart>
                        </ResponsiveContainer>
                    )}
                </Card>
            </div>

            {/* Воронка теста */}
            <Card title="🧪 Бесплатный тест → покупка">
                <div className="grid grid-cols-3 text-center gap-4">
                    <div>
                        <div className="text-2xl font-bold">{t.trials}</div>
                        <div className="text-sm text-slate-500">Взяли тест</div>
                    </div>
                    <div>
                        <div className="text-2xl font-bold text-emerald-500">{t.trial_converted}</div>
                        <div className="text-sm text-slate-500">Купили прокси</div>
                    </div>
                    <div>
                        <div className="text-2xl font-bold text-primary">{t.trial_conversion_pct}%</div>
                        <div className="text-sm text-slate-500">Конверсия</div>
                    </div>
                </div>
            </Card>
        </div>
    );
}
