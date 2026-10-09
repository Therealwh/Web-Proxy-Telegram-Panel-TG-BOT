// Живые логи подключений: WebSocket-обновления, фильтры, экспорт
import React, { useEffect, useRef, useState } from 'react';
import { Download, Pause, Play, ScrollText } from 'lucide-react';
import { get } from '../api';
import { useAuthStore, useLangStore, toast } from '../store';
import { useT } from '../i18n';
import { connectLive } from '../ws';
import { Card, formatDate, deviceInfo, PageHeader, Avatar, ProtoBadge } from '../components/ui';

export default function Logs() {
    const [logs, setLogs] = useState([]);
    const [filters, setFilters] = useState({ username: '', ip: '', protocol: '', status: '' });
    const [paused, setPaused] = useState(false);
    const accessToken = useAuthStore((s) => s.accessToken);
    const lang = useLangStore((s) => s.lang);
    const t = useT();

    const statusBadge = (s) => ({
        ok: ['badge-green', t('logs.stOk')],
        blocked: ['badge-red', t('logs.stBlocked')],
        suspicious: ['badge-yellow', t('logs.stSusp')],
    }[s] || ['badge-blue', s]);

    // Загрузка с фильтрами
    const load = () => {
        const params = new URLSearchParams();
        Object.entries(filters).forEach(([k, v]) => v && params.set(k, v));
        params.set('limit', '200');
        get(`/logs?${params}`).then((d) => setLogs(d.logs)).catch((e) => toast.error(e.message));
    };
    useEffect(() => { load(); }, [[filters]]);

    // Живой поток через WebSocket (с автопереподключением)
    useEffect(() => {
        if (!accessToken || paused) return;
        return connectLive((msg) => {
            if (msg.type === 'log') {
                setLogs((prev) => [msg.data, ...prev].slice(0, 200));
            }
        });
    }, [accessToken, paused]);

    const exportUrl = () => {
        const params = new URLSearchParams();
        params.set('token', sessionStorage.getItem('tggate_token') || '');
        if (filters.from) params.set('from', filters.from);
        if (filters.to) params.set('to', filters.to);
        return `/api/logs/export?${params}`;
    };

    return (
        <div className="space-y-4">
            <PageHeader icon={<ScrollText size={20} />} title={t('logs.title')}
                        subtitle={t('logs.subtitle')}
                        actions={<>
                            <button className="btn-secondary" onClick={() => setPaused(!paused)}>
                                {paused ? <><Play size={16} /> {t('logs.resume')}</> : <><Pause size={16} /> {t('logs.pause')}</>}
                            </button>
                            <a href={exportUrl()} className="btn-secondary" download>
                                <Download size={16} /> {t('logs.export')}
                            </a>
                        </>} />

            {/* Фильтры */}
            <Card>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    <input className="input" placeholder={t('logs.fClient')} value={filters.username}
                           onChange={(e) => setFilters({ ...filters, username: e.target.value })} />
                    <input className="input" placeholder={t('logs.fIp')} value={filters.ip}
                           onChange={(e) => setFilters({ ...filters, ip: e.target.value })} />
                    <select className="input" value={filters.protocol}
                            onChange={(e) => setFilters({ ...filters, protocol: e.target.value })}>
                        <option value="">{t('logs.protoAll')}</option>
                        <option value="web">Web Proxy</option>
                        <option value="mtproto">MTProto</option>
                    </select>
                    <select className="input" value={filters.status}
                            onChange={(e) => setFilters({ ...filters, status: e.target.value })}>
                        <option value="">{t('logs.statusAll')}</option>
                        <option value="ok">{t('logs.optOk')}</option>
                        <option value="blocked">{t('logs.optBlocked')}</option>
                        <option value="suspicious">{t('logs.optSusp')}</option>
                    </select>
                </div>
            </Card>

            {/* Список логов */}
            <Card className="!p-0 overflow-hidden">
                <div className="max-h-[60vh] overflow-auto font-mono text-xs">
                    {logs.length === 0 ? (
                        <p className="p-8 text-center text-slate-500 font-sans text-sm">
                            {t('logs.empty')}
                        </p>
                    ) : (
                        <table className="w-full min-w-[760px]">
                            <thead className="sticky top-0 bg-slate-100 dark:bg-slate-800 z-10">
                                <tr className="text-left">
                                    <th className="px-3 py-2 sticky left-0 bg-slate-100 dark:bg-slate-800 z-20">{t('logs.thTime')}</th>
                                    <th className="px-3 py-2">{t('logs.thClient')}</th>
                                    <th className="px-3 py-2">{t('logs.thIp')}</th>
                                    <th className="px-3 py-2">{t('logs.thDevice')}</th>
                                    <th className="px-3 py-2">{t('logs.thProto')}</th>
                                    <th className="px-3 py-2">{t('logs.thStatus')}</th>
                                </tr>
                            </thead>
                            <tbody>
                                {logs.map((log, i) => {
                                    const dev = deviceInfo(log.user_agent, lang);
                                    return (
                                        <tr key={log.id ?? i} className="border-t border-slate-100 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
                                            <td className="px-3 py-1.5 text-slate-500 whitespace-nowrap sticky left-0 bg-white dark:bg-slate-900 z-[5]">{formatDate(log.created_at, lang)}</td>
                                            <td className="px-3 py-1.5">
                                                <div className="flex items-center gap-2">
                                                    <Avatar name={log.username} className="w-6 h-6 text-[10px]" />
                                                    <span>{log.username || '—'}</span>
                                                </div>
                                            </td>
                                            <td className="px-3 py-1.5">{log.ip || '—'}</td>
                                            <td className="px-3 py-1.5 whitespace-nowrap" title={log.user_agent || ''}>{dev.icon} {dev.label}</td>
                                            <td className="px-3 py-1.5"><ProtoBadge protocol={log.protocol} /></td>
                                            <td className="px-3 py-1.5">
                                                <span className={statusBadge(log.status)[0]}>
                                                    {statusBadge(log.status)[1]}
                                                </span>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    )}
                </div>
            </Card>
        </div>
    );
}
