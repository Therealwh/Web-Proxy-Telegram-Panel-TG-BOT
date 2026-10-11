// «Проверить систему»: сводка состояния панели и сервера.
// Секреты не выводятся — только факт наличия и оценка стойкости.
import React, { useEffect, useState } from 'react';
import {
    Stethoscope, RefreshCw, CheckCircle2, AlertTriangle, XCircle, Loader2,
} from 'lucide-react';
import { get } from '../api';
import { toast, useLangStore } from '../store';
import { useT } from '../i18n';
import { Card, Skeleton, PageHeader, formatDate } from '../components/ui';

const STATUS_ICON = {
    ok: { Icon: CheckCircle2, cls: 'text-emerald-500' },
    warn: { Icon: AlertTriangle, cls: 'text-amber-500' },
    fail: { Icon: XCircle, cls: 'text-red-500' },
};

export default function Diagnostics() {
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);
    const lang = useLangStore((s) => s.lang);
    const t = useT();

    const load = () => {
        setLoading(true);
        get('/diagnostics')
            .then(setData)
            .catch((e) => toast.error(e.message))
            .finally(() => setLoading(false));
    };

    useEffect(() => { load(); }, []);

    return (
        <div className="space-y-4">
            <PageHeader icon={<Stethoscope size={20} />} title={t('diag.title')}
                        subtitle={t('diag.subtitle')}
                        actions={
                            <button className="btn-secondary" onClick={load} disabled={loading}>
                                {loading ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
                                {t('diag.refresh')}
                            </button>
                        } />

            {data && (
                <div className="flex flex-wrap gap-2 text-sm">
                    <span className="text-emerald-600 dark:text-emerald-400">{t('diag.ok', { n: data.summary.ok })}</span>
                    {data.summary.warn > 0 && (
                        <span className="text-amber-600 dark:text-amber-400">{t('diag.warn', { n: data.summary.warn })}</span>
                    )}
                    {data.summary.fail > 0 && (
                        <span className="text-red-600 dark:text-red-400">{t('diag.fail', { n: data.summary.fail })}</span>
                    )}
                    <span className="text-slate-400 ml-auto">{formatDate(data.checkedAt, lang)}</span>
                </div>
            )}

            {!data && loading && (
                <div className="space-y-3">{[...Array(4)].map((_, i) => <Skeleton key={i} className="h-32" />)}</div>
            )}

            {data && (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                    {data.groups.map((g) => {
                        const { Icon, cls } = STATUS_ICON[g.status] || STATUS_ICON.ok;
                        return (
                            <Card key={g.id}>
                                <div className="flex items-center gap-2 mb-3">
                                    <Icon size={18} className={cls} />
                                    <h3 className="font-semibold">{t(`diag.group_${g.id}`)}</h3>
                                    <span className={`ml-auto text-xs ${cls}`}>
                                        {t(`diag.status_${g.status}`)}
                                    </span>
                                </div>
                                <dl className="space-y-1.5">
                                    {g.items.map((it, i) => (
                                        <div key={i} className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
                                            <dt className="text-slate-500 dark:text-slate-400">{it.label}</dt>
                                            <dd className="font-medium text-right break-all">{it.value}</dd>
                                        </div>
                                    ))}
                                </dl>
                            </Card>
                        );
                    })}
                </div>
            )}

            <p className="text-xs text-slate-400">{t('diag.noSecrets')}</p>
        </div>
    );
}