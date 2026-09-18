// Дашборд: сводка системы в реальном времени
import React, { useEffect, useState } from 'react';
import { AreaChart, Area, PieChart, Pie, Cell, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { Users, Link2, Wifi, HardDrive, Cpu, MemoryStick, RefreshCw } from 'lucide-react';
import { get } from '../api';
import { useAuthStore } from '../store';
import { Card, StatusDot, Skeleton, formatBytes } from '../components/ui';

const COLORS = ['#0088cc', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6', '#f97316'];

/** Карточка-счётчик */
function StatCard({ icon: Icon, label, value, sub }) {
    return (
        <Card>
            <div className="flex items-center gap-3">
                <div className="w-11 h-11 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
                    <Icon size={22} />
                </div>
                <div>
                    <div className="text-2xl font-bold leading-tight">{value}</div>
                    <div className="text-sm text-slate-500 dark:text-slate-400">{label}</div>
                    {sub && <div className="text-xs text-slate-400 mt-0.5">{sub}</div>}
                </div>
            </div>
        </Card>
    );
}

export default function Dashboard() {
    const [data, setData] = useState(null);
    const [live, setLive] = useState(null); // real-time нагрузка из WebSocket
    const [error, setError] = useState('');
    const accessToken = useAuthStore((s) => s.accessToken);

    // Первичная загрузка сводки
    useEffect(() => {
        get('/stats/dashboard').then(setData).catch((e) => setError(e.message));
        const timer = setInterval(() => {
            get('/stats/dashboard').then(setData).catch(() => {});
        }, 30000);
        return () => clearInterval(timer);
    }, []);

    // WebSocket: живая нагрузка сервера
    useEffect(() => {
        if (!accessToken) return;
        const proto = location.protocol === 'https:' ? 'wss' : 'ws';
        const ws = new WebSocket(`${proto}://${location.host}/ws?token=${accessToken}`);
        ws.onmessage = (ev) => {
            try {
                const msg = JSON.parse(ev.data);
                if (msg.type === 'stats') setLive(msg.data);
            } catch { /* пропускаем битые сообщения */ }
        };
        return () => ws.close();
    }, [accessToken]);

    if (error) return <Card><p className="text-red-500">{error}</p></Card>;
    if (!data) {
        return (
            <div className="space-y-4">
                <Skeleton className="h-8 w-48" />
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                    {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-24" />)}
                </div>
                <Skeleton className="h-72" />
            </div>
        );
    }

    const { server, clients, connections, traffic, services, ssl, protocols } = data;
    const cpu = live?.cpu ?? server.cpu;
    const ram = live?.ram ?? server.ram;
    const net = live?.network ?? server.network;

    return (
        <div className="space-y-6">
            <h1 className="text-2xl font-bold">Дашборд</h1>

            {/* Счётчики */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <StatCard icon={Users} label="Клиентов всего" value={clients.total}
                    sub={`активных сегодня: ${clients.activeToday} · новых за неделю: ${clients.newWeek}`} />
                <StatCard icon={Link2} label="Активных ссылок" value={clients.active}
                    sub={`просроченных: ${clients.expired}`} />
                <StatCard icon={Wifi} label="Подключений сейчас" value={connections.active}
                    sub={`всего за сессию: ${connections.total}`} />
                <StatCard icon={HardDrive} label="Трафик за месяц" value={formatBytes(traffic.month)}
                    sub={`день: ${formatBytes(traffic.day)} · неделя: ${formatBytes(traffic.week)}`} />
            </div>

            {/* Нагрузка сервера */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                <Card title="Нагрузка сервера" subtitle="обновление каждую секунду">
                    <div className="space-y-4">
                        <div>
                            <div className="flex justify-between text-sm mb-1">
                                <span className="flex items-center gap-1.5"><Cpu size={14} /> CPU</span>
                                <span className="font-mono">{cpu}%</span>
                            </div>
                            <div className="h-2 rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden">
                                <div className="h-full bg-primary rounded-full transition-all duration-700" style={{ width: `${cpu}%` }} />
                            </div>
                        </div>
                        <div>
                            <div className="flex justify-between text-sm mb-1">
                                <span className="flex items-center gap-1.5"><MemoryStick size={14} /> RAM</span>
                                <span className="font-mono">{ram ? `${ram.percent}% (${formatBytes(ram.used)} / ${formatBytes(ram.total)})` : '—'}</span>
                            </div>
                            <div className="h-2 rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden">
                                <div className="h-full bg-emerald-500 rounded-full transition-all duration-700" style={{ width: `${ram?.percent ?? 0}%` }} />
                            </div>
                        </div>
                        <div className="text-sm text-slate-500 dark:text-slate-400">
                            Сеть: ↓ {formatBytes(net.rx_sec)}/с · ↑ {formatBytes(net.tx_sec)}/с
                        </div>
                    </div>
                </Card>

                {/* Трафик по дням */}
                <Card title="Трафик за 30 дней" className="lg:col-span-2">
                    <ResponsiveContainer width="100%" height={200}>
                        <AreaChart data={traffic.daily}>
                            <defs>
                                <linearGradient id="trafficGrad" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="0%" stopColor="#0088cc" stopOpacity={0.4} />
                                    <stop offset="100%" stopColor="#0088cc" stopOpacity={0} />
                                </linearGradient>
                            </defs>
                            <XAxis dataKey="date" tick={{ fontSize: 11 }} tickFormatter={(d) => d.slice(5)} />
                            <YAxis tick={{ fontSize: 11 }} tickFormatter={formatBytes} width={70} />
                            <Tooltip formatter={(v) => formatBytes(v)} labelFormatter={(d) => `Дата: ${d}`} />
                            <Area type="monotone" dataKey="bytes" stroke="#0088cc" fill="url(#trafficGrad)" name="Трафик" />
                        </AreaChart>
                    </ResponsiveContainer>
                </Card>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                {/* Статусы сервисов */}
                <Card title="Статус сервисов">
                    <div className="space-y-3">
                        <StatusDot ok={services.telemt} label="Telemt (прокси)" />
                        <StatusDot ok={services.panel} label="Панель" />
                        <StatusDot ok={services.nginx} label="Nginx" />
                        <StatusDot ok={services.caddy} label="Caddy (HTTPS)" />
                    </div>
                    <div className="mt-4 pt-4 border-t border-slate-200 dark:border-slate-700 space-y-2 text-sm">
                        <div className="flex justify-between">
                            <span className="text-slate-500">Web Proxy</span>
                            <span className={protocols.web ? 'text-emerald-500' : 'text-red-500'}>{protocols.web ? '✅ включён' : '❌ выключен'}</span>
                        </div>
                        <div className="flex justify-between">
                            <span className="text-slate-500">MTProto (8443)</span>
                            <span className={protocols.mtproto ? 'text-emerald-500' : 'text-red-500'}>{protocols.mtproto ? '✅ включён' : '❌ выключен'}</span>
                        </div>
                    </div>
                </Card>

                {/* SSL */}
                <Card title="SSL-сертификат">
                    {ssl ? (
                        <div className="text-center py-4">
                            <div className={`text-4xl font-bold ${ssl.daysLeft < 14 ? 'text-red-500' : 'text-emerald-500'}`}>
                                {ssl.daysLeft}
                            </div>
                            <div className="text-sm text-slate-500 mt-1">дней до истечения</div>
                            <div className="text-xs text-slate-400 mt-3 flex items-center justify-center gap-1">
                                <RefreshCw size={12} /> Автопродление Caddy включено
                            </div>
                        </div>
                    ) : (
                        <p className="text-sm text-slate-500 py-4 text-center">Не удалось проверить сертификат</p>
                    )}
                </Card>

                {/* Топ клиентов по трафику */}
                <Card title="Трафик по клиентам" subtitle="за 30 дней">
                    {traffic.byClient.length > 0 ? (
                        <ResponsiveContainer width="100%" height={180}>
                            <PieChart>
                                <Pie data={traffic.byClient} dataKey="bytes" nameKey="username"
                                     innerRadius={40} outerRadius={70} paddingAngle={2}>
                                    {traffic.byClient.map((_, i) => (
                                        <Cell key={i} fill={COLORS[i % COLORS.length]} />
                                    ))}
                                </Pie>
                                <Tooltip formatter={(v) => formatBytes(v)} />
                            </PieChart>
                        </ResponsiveContainer>
                    ) : (
                        <p className="text-sm text-slate-500 py-8 text-center">Пока нет данных о трафике</p>
                    )}
                </Card>
            </div>
        </div>
    );
}
