// События: понятная лента покупок/продлений/пополнений/ошибок за сутки
import React, { useEffect, useRef, useState } from 'react';
import { ScrollText, RefreshCcw, AlertCircle } from 'lucide-react';
import { get } from '../api';
import { useLangStore } from '../store';
import { useT } from '../i18n';
import { Card, PageHeader, Skeleton } from '../components/ui';

const ICONS = { purchase: '🛒', renewal: '🔄', deposit: '💰', error: '⚠️', cleanup: '🧹', issue: '📦', cancelled: '🚫' };

export default function Events() {
    const [events, setEvents] = useState(null);
    const [updatedAt, setUpdatedAt] = useState(null);
    const lang = useLangStore((s) => s.lang);
    const t = useT();
    const timer = useRef(null);

    const load = () => {
        get('/events?limit=300').then((d) => {
            setEvents(d.events);
            setUpdatedAt(new Date());
        }).catch(() => {});
    };
    useEffect(() => {
        load();
        timer.current = setInterval(load, 30000);
        return () => clearInterval(timer.current);
    }, []);

    const fmtTime = (iso) => {
        try {
            const d = iso && iso.length === 19 ? new Date(iso.replace(' ', 'T') + 'Z') : new Date(iso);
            return d.toLocaleString('ru-RU', { timeZone: 'Europe/Moscow', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
        } catch { return iso; }
    };

    return (
        <div className="space-y-4">
            <PageHeader icon={<ScrollText size={20} />} title={t('events.title')}
                        subtitle={t('events.subtitle')}
                        actions={
                            <div className="flex items-center gap-2">
                                <span className="text-xs text-slate-400 tabular-nums">
                                    {updatedAt ? t('events.updatedAt', { t: updatedAt.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) }) : ''}
                                </span>
                                <button className="btn-secondary !min-h-0 !px-3 !py-1.5 text-sm" onClick={load} aria-label={t('events.refresh')}>
                                    <RefreshCcw size={14} />
                                </button>
                            </div>
                        } />

            {!events ? (
                <div className="space-y-2">{[...Array(6)].map((_, i) => <Skeleton key={i} className="h-16" />)}</div>
            ) : events.length === 0 ? (
                <Card>
                    <p className="text-sm text-slate-500 py-10 text-center">
                        <span className="block text-3xl mb-3">🕊</span>
                        {t('events.empty')}
                    </p>
                </Card>
            ) : (
                <Card className="!p-0">
                    <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                        {events.map((e) => (
                            <li key={e.id} className={`flex items-start gap-3 px-4 py-3 ${e.level === 'error' ? 'bg-red-50/60 dark:bg-red-950/20' : ''}`}>
                                <span className="text-xl leading-none mt-0.5" aria-hidden="true">{ICONS[e.event] || '•'}</span>
                                <div className="flex-1 min-w-0">
                                    <div className={`text-sm font-medium ${e.level === 'error' ? 'text-red-600 dark:text-red-400' : ''}`}>
                                        {e.title}
                                    </div>
                                    {e.details && <div className="text-xs text-slate-500 dark:text-slate-400 break-words mt-0.5">{e.details}</div>}
                                </div>
                                <div className="text-xs text-slate-400 tabular-nums whitespace-nowrap" title="МСК">
                                    {fmtTime(e.created_at)}
                                </div>
                            </li>
                        ))}
                    </ul>
                </Card>
            )}

            <p className="text-xs text-slate-400 text-center flex items-center justify-center gap-1.5">
                <AlertCircle size={12} aria-hidden="true" />
                {t('events.ttlNote')}
            </p>
        </div>
    );
}
