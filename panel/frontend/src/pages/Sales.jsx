// Продажи и аналитика: платежи к подтверждению, выручка, конверсия теста, топ тарифов
import React, { useEffect, useState } from 'react';
import { AreaChart, Area, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { BarChart3, Wallet } from 'lucide-react';
import { get, post } from '../api';
import { toast, useAuthStore } from '../store';
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

/** Парсинг штампа SQLite («YYYY-MM-DD HH:MM:SS» — UTC) в мс */
const parseTs = (s) => {
    if (!s) return null;
    const str = String(s);
    const d = new Date(str.includes('T') ? str : str.replace(' ', 'T') + 'Z');
    return isNaN(d.getTime()) ? null : d.getTime();
};

export default function Sales() {
    const [days, setDays] = useState(30);
    const [data, setData] = useState(null);
    const [pay, setPay] = useState(null);          // /payments — блок «к подтверждению»
    const accessToken = useAuthStore((st) => st.accessToken);
    const t = useT();

    const load = () => {
        get(`/sales/summary?days=${days}`).then(setData).catch(() => {});
    };
    useEffect(() => { load(); }, [days]);

    // Платежи к подтверждению: опрос каждые 15 с, чтобы решения были под рукой
    const loadPayments = () => get('/payments').then(setPay).catch(() => {});
    useEffect(() => {
        loadPayments();
        const iv = setInterval(loadPayments, 15000);
        return () => clearInterval(iv);
    }, []);

    // --- Платежи к подтверждению: с чеком — сверху с превью, без чека — приглушённо ---
    const STALE_HOURS = 24;
    const nowMs = Date.now();
    const ageText = (h) => {
        if (h == null) return '';
        if (h < 1) return t('dashboard.ageMin', { n: Math.max(1, Math.round(h * 60)) });
        if (h < 24) return t('dashboard.ageHours', { n: Math.round(h) });
        return t('dashboard.ageDays', { n: Math.floor(h / 24) });
    };
    const pending = (pay?.payments || [])
        .filter((p) => p.status === 'pending')
        .map((p) => {
            const ts = parseTs(p.created_at);
            const ageH = ts != null ? (nowMs - ts) / 3.6e6 : null;
            const isManual = p.provider === 'manual';
            const markedMs = parseTs(p.paid_marked_at);
            // Таймер автоотмены: только у ручных платежей без чека после «Я оплатил»
            const leftH = (isManual && !p.receipt_file_id && markedMs != null)
                ? STALE_HOURS - (nowMs - markedMs) / 3.6e6
                : null;
            return {
                ...p,
                stale: ageH != null && ageH >= STALE_HOURS,
                ageH,
                isManual,
                hasReceipt: !!p.receipt_file_id,
                receiptIsPhoto: p.receipt_media_type !== 'document',
                leftH,
            };
        })
        .sort((a, b) => {
            if (a.hasReceipt !== b.hasReceipt) return a.hasReceipt ? -1 : 1; // с чеком — сверху
            if (a.leftH != null && b.leftH != null) return a.leftH - b.leftH; // вот-вот отменится — первым
            if (a.ageH == null || b.ageH == null) return (a.ageH == null ? 1 : 0) - (b.ageH == null ? 1 : 0);
            return a.stale ? b.ageH - a.ageH : a.ageH - b.ageH;
        });

    const approvePayment = async (p) => {
        // Ручной платёж без чека подтверждаем осознанно — клиент мог ещё не прислать оплату
        if (p.isManual && !p.hasReceipt && !window.confirm(t('dashboard.confirmNoReceipt'))) return;
        try {
            await post(`/payments/${p.id}/confirm`);
            toast.success(t('dashboard.approved', { id: p.id }));
            loadPayments();
            window.dispatchEvent(new CustomEvent('tggate:payments-updated')); // бейдж в меню
        } catch (e) {
            toast.error(e.message);
        }
    };

    const cancelPayment = async (id) => {
        if (!window.confirm(t('dashboard.confirmCancel', { id }))) return;
        try {
            await post(`/payments/${id}/cancel`);
            toast.success(t('dashboard.cancelled', { id }));
            loadPayments();
            window.dispatchEvent(new CustomEvent('tggate:payments-updated')); // бейдж в меню
        } catch (e) {
            toast.error(e.message);
        }
    };

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

            {/* Платежи к подтверждению: с чеком — сверху с превью, без чека — приглушённо */}
            <Card title={t('dashboard.pendingTitle')} subtitle={t('dashboard.pendingSubtitle')}>
                {!pay ? (
                    <Skeleton className="h-16" />
                ) : pending.length === 0 ? (
                    <p className="text-sm text-slate-500 py-2 text-center">{t('dashboard.pendingEmpty')}</p>
                ) : (
                    <div className="space-y-2.5">
                        {pending.map((p) => (
                            <div key={p.id}
                                 className={`flex items-center gap-3 text-sm rounded-xl px-3 py-2 border
                                             ${p.hasReceipt
                                                 ? 'border-emerald-200 bg-emerald-50/60 dark:border-emerald-500/20 dark:bg-emerald-500/5'
                                                 : 'border-slate-100 opacity-70 dark:border-slate-800'}`}>
                                {/* Превью чека: фото картинкой, PDF кнопкой */}
                                {p.hasReceipt ? (
                                    p.receiptIsPhoto ? (
                                        <a href={`/api/payments/${p.id}/receipt?token=${accessToken}`} target="_blank" rel="noreferrer"
                                           className="shrink-0" title={t('dashboard.openReceipt')} aria-label={t('dashboard.openReceipt')}>
                                            <img src={`/api/payments/${p.id}/receipt?token=${accessToken}`}
                                                 alt="" loading="lazy"
                                                 className="h-11 w-11 rounded-lg object-cover border border-slate-200 dark:border-slate-700" />
                                        </a>
                                    ) : (
                                        <a href={`/api/payments/${p.id}/receipt?token=${accessToken}`} target="_blank" rel="noreferrer"
                                           className="shrink-0 h-11 w-11 rounded-lg bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-xl"
                                           title={t('dashboard.receiptPdf')} aria-label={t('dashboard.openReceipt')}>📄</a>
                                    )
                                ) : (
                                    <div className="shrink-0 h-11 w-11 rounded-lg bg-slate-100 dark:bg-slate-800 flex items-center justify-center">
                                        <Wallet size={16} className={p.isManual ? 'text-slate-400' : 'text-amber-500'} />
                                    </div>
                                )}
                                <div className="min-w-0 flex-1">
                                    <div className="font-medium truncate flex items-center gap-1.5">
                                        <span className="truncate">{p.username || t('dashboard.topupFallback')}</span>
                                        {p.hasReceipt
                                            ? <span className="shrink-0 text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400">{t('dashboard.pendingFresh')}</span>
                                            : (p.isManual && <span className="shrink-0 text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400">{t('dashboard.noReceipt')}</span>)}
                                        {p.stale && <span className="shrink-0 text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-500 dark:bg-slate-700/60 dark:text-slate-400">{t('dashboard.pendingStale')}</span>}
                                    </div>
                                    <div className="text-xs text-slate-400 truncate">
                                        {p.tariff_name || t('dashboard.topupFallback')}
                                        {' · '}#{p.id}{p.ageH != null && <> · {ageText(p.ageH)}</>}
                                        {!p.hasReceipt && p.leftH != null && p.leftH > 0 && <> · {t('dashboard.hoursLeft', { n: Math.max(1, Math.ceil(p.leftH)) })}</>}
                                    </div>
                                </div>
                                <div className="shrink-0 text-right">
                                    <div className="font-bold">{p.amount}</div>
                                    <div className="flex gap-1 mt-0.5">
                                        <button className="btn-ghost !min-h-0 !px-2 !py-1 text-xs text-emerald-600" onClick={() => approvePayment(p)}>
                                            {t('dashboard.approve')}
                                        </button>
                                        <button className="btn-ghost !min-h-0 !px-2 !py-1 text-xs text-red-500" onClick={() => cancelPayment(p.id)}>
                                            {t('dashboard.cancel')}
                                        </button>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </Card>

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
