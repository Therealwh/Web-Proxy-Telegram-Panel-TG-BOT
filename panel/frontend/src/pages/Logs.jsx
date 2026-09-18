// Живые логи подключений: WebSocket-обновления, фильтры, экспорт
import React, { useEffect, useRef, useState } from 'react';
import { Download, Pause, Play } from 'lucide-react';
import { get } from '../api';
import { useAuthStore, toast } from '../store';
import { Card, formatDate } from '../components/ui';

const STATUS_BADGE = {
    ok: ['badge-green', '✅ успех'],
    blocked: ['badge-red', '❌ блок'],
    suspicious: ['badge-yellow', '⚠️ подозрительно'],
};

export default function Logs() {
    const [logs, setLogs] = useState([]);
    const [filters, setFilters] = useState({ username: '', ip: '', protocol: '', status: '' });
    const [paused, setPaused] = useState(false);
    const accessToken = useAuthStore((s) => s.accessToken);
    const listRef = useRef(null);

    // Загрузка с фильтрами
    const load = () => {
        const params = new URLSearchParams();
        Object.entries(filters).forEach(([k, v]) => v && params.set(k, v));
        params.set('limit', '200');
        get(`/logs?${params}`).then((d) => setLogs(d.logs)).catch((e) => toast.error(e.message));
    };
    useEffect(load, [filters]);

    // Живой поток через WebSocket
    useEffect(() => {
        if (!accessToken || paused) return;
        const proto = location.protocol === 'https:' ? 'wss' : 'ws';
        const ws = new WebSocket(`${proto}://${location.host}/ws?token=${accessToken}`);
        ws.onmessage = (ev) => {
            try {
                const msg = JSON.parse(ev.data);
                if (msg.type === 'log') {
                    setLogs((prev) => [msg.data, ...prev].slice(0, 200));
                }
            } catch { /* пропускаем */ }
        };
        return () => ws.close();
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
            <div className="flex flex-wrap items-center justify-between gap-3">
                <h1 className="text-2xl font-bold">Живые логи</h1>
                <div className="flex gap-2">
                    <button className="btn-secondary" onClick={() => setPaused(!paused)}>
                        {paused ? <><Play size={16} /> Возобновить</> : <><Pause size={16} /> Пауза</>}
                    </button>
                    <a href={exportUrl()} className="btn-secondary" download>
                        <Download size={16} /> Экспорт
                    </a>
                </div>
            </div>

            {/* Фильтры */}
            <Card>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    <input className="input" placeholder="Клиент" value={filters.username}
                           onChange={(e) => setFilters({ ...filters, username: e.target.value })} />
                    <input className="input" placeholder="IP-адрес" value={filters.ip}
                           onChange={(e) => setFilters({ ...filters, ip: e.target.value })} />
                    <select className="input" value={filters.protocol}
                            onChange={(e) => setFilters({ ...filters, protocol: e.target.value })}>
                        <option value="">Все протоколы</option>
                        <option value="web">Web Proxy</option>
                        <option value="mtproto">MTProto</option>
                    </select>
                    <select className="input" value={filters.status}
                            onChange={(e) => setFilters({ ...filters, status: e.target.value })}>
                        <option value="">Все статусы</option>
                        <option value="ok">Успешные</option>
                        <option value="blocked">Блокированные</option>
                        <option value="suspicious">Подозрительные</option>
                    </select>
                </div>
            </Card>

            {/* Список логов */}
            <Card className="!p-0 overflow-hidden">
                <div ref={listRef} className="max-h-[60vh] overflow-y-auto font-mono text-xs">
                    {logs.length === 0 ? (
                        <p className="p-8 text-center text-slate-500 font-sans text-sm">
                            Логов пока нет — они появятся при подключениях клиентов
                        </p>
                    ) : (
                        <table className="w-full">
                            <thead className="sticky top-0 bg-slate-100 dark:bg-slate-800">
                                <tr className="text-left">
                                    <th className="px-3 py-2">Время</th>
                                    <th className="px-3 py-2">Клиент</th>
                                    <th className="px-3 py-2">IP</th>
                                    <th className="px-3 py-2">Протокол</th>
                                    <th className="px-3 py-2">Статус</th>
                                </tr>
                            </thead>
                            <tbody>
                                {logs.map((log, i) => (
                                    <tr key={log.id ?? i} className="border-t border-slate-100 dark:border-slate-800">
                                        <td className="px-3 py-1.5 text-slate-500 whitespace-nowrap">{formatDate(log.created_at)}</td>
                                        <td className="px-3 py-1.5">{log.username || '—'}</td>
                                        <td className="px-3 py-1.5">{log.ip || '—'}</td>
                                        <td className="px-3 py-1.5">{log.protocol === 'web' ? '🌐 web' : '🔌 mtproto'}</td>
                                        <td className="px-3 py-1.5">
                                            <span className={STATUS_BADGE[log.status]?.[0] || 'badge-blue'}>
                                                {STATUS_BADGE[log.status]?.[1] || log.status}
                                            </span>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )}
                </div>
            </Card>
        </div>
    );
}
