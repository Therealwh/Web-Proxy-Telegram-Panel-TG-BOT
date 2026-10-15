// Диск: сколько занято и чем, кнопка «Очистить место».
// Вынесено на отдельную страницу: чистка долгая (VACUUM до минуты),
// и её не стоит прятать в диагностику, где пользователь ждёт мгновенный ответ.
import React, { useEffect, useState, useCallback } from 'react';
import { HardDrive, RefreshCw, Loader2, Trash2, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { get, post } from '../api';
import { toast } from '../store';
import { useT } from '../i18n';
import { Card, PageHeader, ProgressBar } from '../components/ui';

/** Короткая подпись: что именно чистится. */
const CLEANUP_ITEMS = [
    'journal systemd — до 200 МБ',
    'логи подключений старше 14 дней',
    'проверки доступности старше 30 дней',
    'бэкапы — остаются 5 последних',
    'кеш пакетов',
];

export default function Disk() {
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [cleaning, setCleaning] = useState(false);
    const [confirming, setConfirming] = useState(false);
    const t = useT();

    const load = useCallback(() => {
        setLoading(true);
        get('/disk/stats')
            .then(setData)
            .catch((e) => toast.error(e.message))
            .finally(() => setLoading(false));
    }, []);

    useEffect(() => { load(); }, [load]);

    const cleanup = () => {
        setCleaning(true);
        setConfirming(false);
        post('/disk/cleanup', {})
            .then((r) => {
                toast.success(r.message || 'Готово');
                setTimeout(load, 1000); // цифры после VACUUM появляются с задержкой
            })
            .catch((e) => toast.error(e.message))
            .finally(() => setCleaning(false));
    };

    const pct = data?.system ? Math.min(100, data.system.used_percent) : null;
    const danger = pct !== null && pct >= 90;
    const warn = pct !== null && pct >= 80 && pct < 90;

    return (
        <div className="space-y-4">
            <PageHeader icon={<HardDrive size={20} />} title={t('disk.title')}
                        subtitle={t('disk.subtitle')}
                        actions={
                            <button className="btn-secondary" onClick={load} disabled={loading}>
                                {loading ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
                                {t('disk.refresh')}
                            </button>
                        } />

            {danger && (
                <div className="flex items-center gap-2 rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-600 dark:text-red-400">
                    <AlertTriangle size={18} />
                    {t('disk.danger')}
                </div>
            )}

            {data?.system && (
                <Card>
                    <div className="flex items-baseline justify-between mb-2">
                        <h3 className="font-semibold">{t('disk.usage')}</h3>
                        <span className={`text-lg font-semibold ${danger ? 'text-red-500' : warn ? 'text-amber-500' : 'text-emerald-500'}`}>
                            {data.system.used_percent}%
                        </span>
                    </div>
                    {pct !== null && <ProgressBar value={pct} className={danger ? 'bg-red-500' : warn ? 'bg-amber-500' : 'bg-emerald-500'} />}
                    <dl className="mt-4 grid grid-cols-3 gap-3 text-sm text-center">
                        <div className="rounded-lg bg-slate-500/5 p-2">
                            <dt className="text-slate-500 dark:text-slate-400">{t('disk.total')}</dt>
                            <dd className="font-semibold mt-1">{fmt(data.system.total_bytes)}</dd>
                        </div>
                        <div className="rounded-lg bg-slate-500/5 p-2">
                            <dt className="text-slate-500 dark:text-slate-400">{t('disk.used')}</dt>
                            <dd className="font-semibold mt-1">{fmt(data.system.used_bytes)}</dd>
                        </div>
                        <div className="rounded-lg bg-slate-500/5 p-2">
                            <dt className="text-slate-500 dark:text-slate-400">{t('disk.free')}</dt>
                            <dd className="font-semibold mt-1">{fmt(data.system.free_bytes)}</dd>
                        </div>
                    </dl>
                </Card>
            )}

            {data && (
                <Card>
                    <h3 className="font-semibold mb-3">{t('disk.breakdown')}</h3>
                    <dl className="space-y-2 text-sm">
                        <Row label={t('disk.db')} item={data.db} />
                        <Row label={t('disk.backups')} item={data.backups} extra={data.backups?.count ? `${data.backups.count} шт.` : null} />
                        <Row label={t('disk.website')} item={data.website} />
                        <Row label={t('disk.journal')} item={data.logs?.journal_bytes ? { human: fmt(data.logs.journal_bytes) } : null} />
                        <Row label={t('disk.varlog')} item={data.logs?.varlog_bytes ? { human: fmt(data.logs.varlog_bytes) } : null} />
                    </dl>
                </Card>
            )}

            <Card>
                <h3 className="font-semibold mb-2">{t('disk.cleanupTitle')}</h3>
                <p className="text-sm text-slate-500 dark:text-slate-400 mb-3">{t('disk.cleanupHint')}</p>
                <ul className="text-sm space-y-1 mb-4">
                    {CLEANUP_ITEMS.map((it) => (
                        <li key={it} className="flex items-center gap-2">
                            <CheckCircle2 size={14} className="text-slate-400" />
                            {it}
                        </li>
                    ))}
                </ul>
                {!confirming ? (
                    <button className="btn-primary" onClick={() => setConfirming(true)} disabled={cleaning}>
                        <Trash2 size={16} />
                        {t('disk.cleanupRun')}
                    </button>
                ) : (
                    <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm text-amber-600 dark:text-amber-400">{t('disk.cleanupConfirm')}</span>
                        <button className="btn-primary" onClick={cleanup} disabled={cleaning}>
                            {cleaning ? <Loader2 size={16} className="animate-spin" /> : <Trash2 size={16} />}
                            {t('disk.cleanupYes')}
                        </button>
                        <button className="btn-secondary" onClick={() => setConfirming(false)} disabled={cleaning}>
                            {t('disk.cleanupNo')}
                        </button>
                    </div>
                )}
                {cleaning && <p className="text-xs text-slate-400 mt-2">{t('disk.cleanupLong')}</p>}
            </Card>

            {!data && loading && (
                <div className="space-y-3">{[...Array(3)].map((_, i) => (
                    <div key={i} className="h-32 rounded-xl bg-slate-500/10 animate-pulse" />
                ))}</div>
            )}
        </div>
    );
}

function Row({ label, item, extra }) {
    if (!item || !item.human) return null;
    return (
        <div className="flex items-baseline justify-between gap-2">
            <dt className="text-slate-500 dark:text-slate-400">{label}</dt>
            <dd className="font-medium">{item.human}{extra ? <span className="text-slate-400 ml-1">({extra})</span> : null}</dd>
        </div>
    );
}

function fmt(bytes) {
    if (!bytes && bytes !== 0) return '—';
    const units = ['Б', 'КБ', 'МБ', 'ГБ', 'ТБ'];
    let v = bytes, u = 0;
    while (v >= 1024 && u < units.length - 1) { v /= 1024; u += 1; }
    return `${v.toFixed(v >= 100 || u === 0 ? 0 : 1)} ${units[u]}`;
}