// Вкладка «Обход DPI»: опциональный модуль zapret2 (nfqws2) для MTProto
import React, { useCallback, useEffect, useState } from 'react';
import { Shield, RefreshCw, Power, Trash2, Download } from 'lucide-react';
import { get, post } from '../api';
import { toast } from '../store';
import { useT } from '../i18n';
import { Card, Skeleton, PageHeader } from '../components/ui';

export default function Zapret2() {
    const [status, setStatus] = useState(null);
    const [busy, setBusy] = useState('');
    const t = useT();

    const load = useCallback(() => {
        get('/zapret2').then(setStatus).catch((e) => toast.error(e.message));
    }, []);
    useEffect(() => {
        load();
        const timer = setInterval(load, 5000);
        return () => clearInterval(timer);
    }, [load]);

    const run = async (action, confirmText) => {
        if (confirmText && !confirm(confirmText)) return;
        setBusy(action);
        try {
            await post(`/zapret2/${action}`);
            toast.success(t('zapret2.started', { action }));
            setTimeout(load, 3000);
        } catch (e) {
            toast.error(e.message);
        } finally {
            setBusy('');
        }
    };

    if (!status) return <div className="space-y-4">{[...Array(2)].map((_, i) => <Skeleton key={i} className="h-40" />)}</div>;

    return (
        <div className="space-y-4">
            <PageHeader icon={<Shield size={20} />} title={t('zapret2.title')}
                        subtitle={t('zapret2.subtitle')}
                        actions={
                            <button className="btn-secondary" onClick={load}>
                                <RefreshCw size={16} /> {t('common.refresh')}
                            </button>
                        } />

            {/* Статус */}
            <Card title={t('zapret2.statusTitle')}>
                <div className="flex flex-wrap items-center gap-4">
                    <span className={`badge ${status.running ? 'badge-green' : status.installed ? 'badge-yellow' : 'badge-slate'}`}>
                        {status.running ? '🟢 ' + t('zapret2.running')
                            : status.installed ? '🟡 ' + t('zapret2.stopped')
                            : '⚪ ' + t('zapret2.notInstalled')}
                    </span>
                    <span className="text-sm text-slate-500">{t('zapret2.portInfo', { port: status.port })}</span>
                    <span className="text-sm text-slate-500">{t('zapret2.queueInfo', { q: status.queue })}</span>
                </div>
                <div className="flex flex-wrap gap-2 mt-4">
                    {!status.installed ? (
                        <button className="btn-primary" disabled={busy === 'install'} onClick={() => run('install', t('zapret2.confirmInstall'))}>
                            <Download size={16} /> {busy === 'install' ? t('zapret2.working') : t('zapret2.installBtn')}
                        </button>
                    ) : (
                        <>
                            {status.running ? (
                                <button className="btn-secondary" disabled={!!busy} onClick={() => run('stop')}>
                                    <Power size={16} /> {t('zapret2.stopBtn')}
                                </button>
                            ) : (
                                <button className="btn-primary" disabled={!!busy} onClick={() => run('start')}>
                                    <Power size={16} /> {t('zapret2.startBtn')}
                                </button>
                            )}
                            <button className="btn-secondary" disabled={!!busy} onClick={() => run('restart')}>
                                <RefreshCw size={16} /> {t('zapret2.restartBtn')}
                            </button>
                            <button className="btn-danger" disabled={!!busy}
                                    onClick={() => run('remove', t('zapret2.confirmRemove'))}>
                                <Trash2 size={16} /> {t('zapret2.removeBtn')}
                            </button>
                        </>
                    )}
                </div>
            </Card>

            {/* Что делает */}
            <Card title={t('zapret2.howTitle')}>
                <ol className="list-decimal pl-5 space-y-1 text-sm text-slate-600 dark:text-slate-300">
                    <li>{t('zapret2.how1')}</li>
                    <li>{t('zapret2.how2')}</li>
                    <li>{t('zapret2.how3')}</li>
                </ol>
            </Card>

            {/* Безопасность */}
            <Card title={t('zapret2.safetyTitle')}>
                <p className="text-sm text-slate-600 dark:text-slate-300">{t('zapret2.safety1')}</p>
                <p className="text-sm text-slate-600 dark:text-slate-300 mt-2">{t('zapret2.safety2')}</p>
                <p className="text-sm text-slate-600 dark:text-slate-300 mt-2">{t('zapret2.safety3', { port: status.port })}</p>
            </Card>
        </div>
    );
}
