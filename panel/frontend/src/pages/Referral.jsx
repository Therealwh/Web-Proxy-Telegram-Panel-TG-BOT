// Партнёрская программа: итоги, топ рефереров, последние начисления
import React, { useEffect, useState } from 'react';
import { Gift, Users, Wallet, TrendingUp } from 'lucide-react';
import { get } from '../api';
import { useT } from '../i18n';
import { Card, Skeleton, PageHeader, StatusBadge } from '../components/ui';

function Metric({ icon, value, label, accent }) {
    return (
        <Card>
            <div className="flex items-center gap-3">
                <div className={`rounded-xl p-2.5 bg-slate-100 dark:bg-slate-800 ${accent || 'text-slate-500'}`}>{icon}</div>
                <div>
                    <div className="text-xl font-bold">{value}</div>
                    <div className="text-xs text-slate-500">{label}</div>
                </div>
            </div>
        </Card>
    );
}

const KIND_LABEL = {
    purchase: 'Покупка',
    renewal: 'Продление',
    deposit: 'Пополнение',
};

export default function Referral() {
    const [data, setData] = useState(null);
    const t = useT();

    useEffect(() => {
        get('/referral/stats').then(setData).catch(() => {});
    }, []);

    if (!data) return <div className="space-y-4">{[...Array(3)].map((_, i) => <Skeleton key={i} className="h-40" />)}</div>;

    const { totals, top, recent, settings } = data;
    const modeLabel = settings.mode === 'percent' ? t('referral.modePercent', { n: settings.percent })
        : settings.mode === 'days' ? t('referral.modeDays') : t('referral.modeOff');

    return (
        <div className="space-y-4">
            <PageHeader icon={<Gift size={20} />} title={t('referral.title')}
                        subtitle={t('referral.subtitle')}
                        actions={<span className="text-xs px-3 py-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-500">{modeLabel}</span>} />

            {/* Метрики */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <Metric icon={<Users size={20} />} value={totals.invited} label={t('referral.invitedTotal')} />
                <Metric icon={<TrendingUp size={20} />} value={totals.referrers} label={t('referral.referrersTotal')} />
                <Metric icon={<Wallet size={20} />} value={totals.paid_out} label={t('referral.paidOut')} accent="text-emerald-500" />
                <Metric icon={<Gift size={20} />} value={totals.earnings_count} label={t('referral.earningsCount')} />
            </div>

            {settings.mode === 'off' && (
                <Card>
                    <p className="text-sm text-slate-500">{t('referral.offHint')}</p>
                </Card>
            )}

            <div className="grid lg:grid-cols-2 gap-4">
                {/* Топ рефереров */}
                <Card title={t('referral.topTitle')}>
                    {top.length === 0 ? (
                        <p className="text-sm text-slate-500 py-6 text-center">{t('referral.empty')}</p>
                    ) : (
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                                <thead>
                                    <tr className="text-left text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-slate-700">
                                        <th className="px-3 py-2 font-medium">#</th>
                                        <th className="px-3 py-2 font-medium">{t('referral.referrer')}</th>
                                        <th className="px-3 py-2 font-medium">{t('referral.invitedCol')}</th>
                                        <th className="px-3 py-2 font-medium">{t('referral.earnedCol')}</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {top.map((r, i) => (
                                        <tr key={r.id} className="border-b border-slate-100 dark:border-slate-800">
                                            <td className="px-3 py-2 text-slate-400">{i + 1}</td>
                                            <td className="px-3 py-2 font-medium">
                                                {r.username}
                                                {r.telegram_id && <span className="text-xs text-slate-400 ml-1.5">tg{r.telegram_id}</span>}
                                            </td>
                                            <td className="px-3 py-2">{r.invited}</td>
                                            <td className="px-3 py-2 font-semibold text-emerald-500">{r.earned}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </Card>

                {/* Последние начисления */}
                <Card title={t('referral.recentTitle')}>
                    {recent.length === 0 ? (
                        <p className="text-sm text-slate-500 py-6 text-center">{t('referral.empty')}</p>
                    ) : (
                        <div className="overflow-x-auto max-h-[420px]">
                            <table className="w-full text-sm">
                                <thead className="sticky top-0 bg-white dark:bg-slate-900">
                                    <tr className="text-left text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-slate-700">
                                        <th className="px-3 py-2 font-medium">{t('referral.when')}</th>
                                        <th className="px-3 py-2 font-medium">{t('referral.referrer')}</th>
                                        <th className="px-3 py-2 font-medium">{t('referral.kind')}</th>
                                        <th className="px-3 py-2 font-medium text-right">{t('referral.amount')}</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {recent.map((e) => (
                                        <tr key={e.id} className="border-b border-slate-100 dark:border-slate-800">
                                            <td className="px-3 py-2 text-slate-400 text-xs whitespace-nowrap">
                                                {new Date(e.created_at + 'Z').toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                                            </td>
                                            <td className="px-3 py-2 font-medium">{e.referrer_username}</td>
                                            <td className="px-3 py-2 text-slate-500">{KIND_LABEL[e.kind] || e.kind}</td>
                                            <td className="px-3 py-2 text-right font-semibold text-emerald-500">+{e.amount}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </Card>
            </div>
        </div>
    );
}
