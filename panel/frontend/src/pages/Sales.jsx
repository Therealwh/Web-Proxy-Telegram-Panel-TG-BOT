// Страница аналитики: продажи, выручка, конверсия теста, новые клиенты
import React, { useEffect, useState } from 'react';
import { AreaChart, Area, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { BarChart3 } from 'lucide-react';
import { get } from '../api';
import { useT } from '../i18n';
import { Card, Skeleton, PageHeader, chartTheme } from '../components/ui';

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
    const t = useT();

    const load = () => {
        get(`/sales/summary?days=${days}`).then(setData).catch(() => {});
    };
    useEffect(() => { load(); }, [[days]]);

    if (!data) return <div className="space-y-4">{[...Array(3)].map((_, i) => <Skeleton key={i} className="h-40" />)}</div>;

    const tot = data.totals;

    return (
        <div className="space-y-4">
            <PageHeader icon={<BarChart3 size={20} />} title={t('sales.title')}
                        subtitle={t('sales.subtitle')}
                        actions={
                            <select className="input !w-40" value={days} onChange={(e) => setDays(Number(e.target.value))}>
                                <option value={7}>{t('sales.days', { n: 7 })}</option>
                                <option value={30}>{t('sales.days', { n: 30 })}</option>
                                <option value={90}>{t('sales.days', { n: 90 })}</option>
                                <option value={365}>{t('sales.year')}</option>
                            </select>
                        } />

            {/* Метрики */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <Metric value={`${tot.revenue} ₽`} label={t('sales.revenueFor', { n: days })} accent="text-emerald-500" />
                <Metric value={tot.sales} label={t('sales.salesCount')} />
                <Metric value={tot.active_clients} label={t('sales.activeProxies')} />
                <Metric value={`${tot.trial_conversion_pct}%`}
                        label={t('sales.convTest', { done: tot.trial_converted, total: tot.trials })} />
            </div>

            {/* Выручка по дням */}
            <Card title={t('sales.revByDay')}>
                {data.revenue_by_day.length === 0 ? (
                    <p className="text-sm text-slate-500 py-8 text-center">{t('sales.noSales')}</p>
                ) : (
                    <ResponsiveContainer width="100%" height={240}>
                        <AreaChart data={data.revenue_by_day}>
                            <defs>
                                <linearGradient id="rev" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="0%" stopColor="#10b981" stopOpacity={0.4} />
                                    <stop offset="100%" stopColor="#10b981" stopOpacity={0} />
                                </linearGradient>
                            </defs>
                            <CartesianGrid strokeDasharray="3 3" stroke={chartTheme.gridColor} opacity={chartTheme.gridOpacity} />
                            <XAxis dataKey="day" tick={chartTheme.tick} tickFormatter={(d) => d.slice(5)} />
                            <YAxis tick={chartTheme.tick} />
                            <Tooltip formatter={(v) => [`${v} ₽`, t('sales.revSeries')]} labelStyle={{ color: '#e2e8f0' }}
                                     contentStyle={chartTheme.tooltip} />
                            <Area type="monotone" dataKey="total" stroke="#10b981" strokeWidth={2} fill="url(#rev)" />
                        </AreaChart>
                    </ResponsiveContainer>
                )}
            </Card>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {/* Топ тарифов */}
                <Card title={t('sales.topTariffs')}>
                    {data.top_tariffs.length === 0 ? (
                        <p className="text-sm text-slate-500 py-6 text-center">{t('sales.noData')}</p>
                    ) : (
                        <ResponsiveContainer width="100%" height={60 + data.top_tariffs.length * 40}>
                            <BarChart data={data.top_tariffs} layout="vertical">
                                <XAxis type="number" hide />
                                <YAxis type="category" dataKey="name" width={140} tick={chartTheme.tick} />
                                <Tooltip formatter={(v, name) => [v, name === 'revenue' ? t('sales.revRub') : t('sales.salesCount')]}
                                         contentStyle={chartTheme.tooltip} />
                                <Bar dataKey="revenue" fill="#3b82f6" radius={[0, 6, 6, 0]} barSize={20} />
                            </BarChart>
                        </ResponsiveContainer>
                    )}
                </Card>

                {/* Новые клиенты */}
                <Card title={t('sales.newClients')}>
                    {data.new_clients_by_day.length === 0 ? (
                        <p className="text-sm text-slate-500 py-6 text-center">{t('sales.noData')}</p>
                    ) : (
                        <ResponsiveContainer width="100%" height={220}>
                            <BarChart data={data.new_clients_by_day}>
                                <CartesianGrid strokeDasharray="3 3" stroke="#334155" opacity={0.3} />
                                <XAxis dataKey="day" tick={chartTheme.tick} tickFormatter={(d) => d.slice(5)} />
                                <YAxis allowDecimals={false} tick={chartTheme.tick} />
                                <Tooltip formatter={(v) => [v, t('sales.newClientsSeries')]}
                                         contentStyle={chartTheme.tooltip} />
                                <Bar dataKey="count" fill="#8b5cf6" radius={[6, 6, 0, 0]} />
                            </BarChart>
                        </ResponsiveContainer>
                    )}
                </Card>
            </div>

            {/* Воронка теста */}
            <Card title={t('sales.funnel')}>
                <div className="grid grid-cols-3 text-center gap-4">
                    <div>
                        <div className="text-2xl font-bold">{tot.trials}</div>
                        <div className="text-sm text-slate-500">{t('sales.tookTrial')}</div>
                    </div>
                    <div>
                        <div className="text-2xl font-bold text-emerald-500">{tot.trial_converted}</div>
                        <div className="text-sm text-slate-500">{t('sales.boughtProxy')}</div>
                    </div>
                    <div>
                        <div className="text-2xl font-bold text-primary">{tot.trial_conversion_pct}%</div>
                        <div className="text-sm text-slate-500">{t('sales.conversion')}</div>
                    </div>
                </div>
            </Card>
        </div>
    );
}
