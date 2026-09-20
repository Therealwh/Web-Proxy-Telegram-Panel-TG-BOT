// Дашборд: сводка системы в реальном времени
import React, { useEffect, useState } from 'react';
import { AreaChart, Area, LineChart, Line, PieChart, Pie, Cell, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { Users, Link2, Wifi, HardDrive, Cpu, MemoryStick, RefreshCw } from 'lucide-react';
import { get, post } from '../api';
import { useAuthStore, toast } from '../store';
import { connectLive } from '../ws';
import { Card, StatusDot, Skeleton, formatBytes } from '../components/ui';

const COLORS = ['#0088cc', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6', '#f97316'];

/** Формат аптайма: «3 дн. 04:12» или «5 ч 12 мин» */
function formatUptime(secs) {
    if (secs == null) return '—';
    const d = Math.floor(secs / 86400);
    const h = Math.floor((secs % 86400) / 3600);
    const m = Math.floor((secs % 3600) / 60);
    if (d > 0) return `${d} дн. ${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    if (h > 0) return `${h} ч ${m} мин`;
    return `${m} мин`;
}

/** Карточка-счётчик */
function StatCard({ icon: Icon, label, value, sub }) {    return (
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
    const [active, setActive] = useState(null); // активные подключения (IP + страна)
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

    // Активные подключения (кто онлайн, IP, страна) — каждые 5 секунд
    useEffect(() => {
        const load = () => get('/stats/active').then(setActive).catch(() => {});
        load();
        const timer = setInterval(load, 5000);
        return () => clearInterval(timer);
    }, []);

    // Платежи, ожидающие подтверждения (ручная оплата)
    const [pending, setPending] = useState([]);
    useEffect(() => {
        const load = () => get('/payments').then((d) => setPending(
            (d.payments || []).filter((p) => p.status === 'pending')
        )).catch(() => {});
        load();
        const timer = setInterval(load, 10000);
        return () => clearInterval(timer);
    }, []);

    // Живой график трафика (получение/отправка) с выбором диапазона
    const [range, setRange] = useState('1h');
    const [liveTraffic, setLiveTraffic] = useState(null);
    useEffect(() => {
        const load = () => get(`/stats/traffic-live?range=${range}`).then(setLiveTraffic).catch(() => {});
        load();
        const timer = setInterval(load, 5000);
        return () => clearInterval(timer);
    }, [range]);

    const approvePayment = async (id) => {
        try {
            await post(`/payments/${id}/confirm`);
            toast.success(`Платёж #${id} подтверждён — доступ выдан`);
            setPending((p) => p.filter((x) => x.id !== id));
        } catch (e) {
            toast.error(e.message);
        }
    };

    // WebSocket: живая нагрузка сервера (с автопереподключением)
    useEffect(() => {
        if (!accessToken) return;
        return connectLive((msg) => {
            if (msg.type === 'stats') setLive(msg.data);
        });
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
                <StatCard icon={Wifi} label="Подключений сейчас" value={active?.active_total ?? connections.active}
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

            {/* Живой график трафика: получение/отправка */}
            <Card title="📈 Трафик прокси"
                  subtitle="скорость в реальном времени, обновление каждые 5 секунд"
                  actions={
                      <div className="flex gap-1">
                          {['1h', '6h', '24h'].map((r) => (
                              <button key={r} onClick={() => setRange(r)}
                                      className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors
                                          ${range === r ? 'bg-primary text-white' : 'bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700'}`}>
                                  {r}
                              </button>
                          ))}
                      </div>
                  }>
                  <div className="flex gap-8 mb-3">
                      <div>
                          <div className="text-xs text-slate-500 mb-0.5">↑ Отправка</div>
                          <div className="text-2xl font-bold">{formatBytes(liveTraffic?.current?.tx ?? 0)}<span className="text-sm font-normal text-slate-400"> /с</span></div>
                      </div>
                      <div>
                          <div className="text-xs text-slate-500 mb-0.5">↓ Получение</div>
                          <div className="text-2xl font-bold text-amber-500">{formatBytes(liveTraffic?.current?.rx ?? 0)}<span className="text-sm font-normal text-slate-400"> /с</span></div>
                      </div>
                  </div>
                  <ResponsiveContainer width="100%" height={220}>
                      <LineChart data={liveTraffic?.points || []} margin={{ top: 5, right: 5, bottom: 0, left: 5 }}>
                          <XAxis dataKey="t" type="number" scale="time" domain={['dataMin', 'dataMax']}
                                 tickFormatter={(t) => new Date(t).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}
                                 tick={{ fontSize: 10 }} stroke="#64748b" />
                          <YAxis tickFormatter={(v) => formatBytes(v)} tick={{ fontSize: 10 }} stroke="#64748b" width={70} />
                          <Tooltip
                              formatter={(v, name) => [`${formatBytes(v)}/с`, name]}
                              labelFormatter={(t) => new Date(t).toLocaleTimeString('ru-RU')}
                              contentStyle={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 8, color: '#e2e8f0' }} />
                          <Line type="monotone" dataKey="tx" name="Отправка" stroke="#0088cc" strokeWidth={1.5} dot={false} />
                          <Line type="monotone" dataKey="rx" name="Получение" stroke="#f59e0b" strokeWidth={1.5} dot={false} />
                      </LineChart>
                  </ResponsiveContainer>
                  <div className="flex gap-4 mt-2 text-xs text-slate-400">
                      <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-primary inline-block" /> Отправка</span>
                      <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-500 inline-block" /> Получение</span>
                  </div>
            </Card>

            {/* Платежи, ожидающие подтверждения */}
            {pending.length > 0 && (
                <Card title="⏳ Платежи к подтверждению" subtitle="Оплата шла напрямую администратору — подтвердите, чтобы выдать доступ">
                    <div className="space-y-2">
                        {pending.map((p) => (
                            <div key={p.id} className="flex items-center justify-between gap-3 rounded-lg bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/30 px-3 py-2">
                                <span className="text-sm">
                                    <b>#{p.id}</b> — {p.tariff_name || 'пополнение'} · {p.amount} {p.currency}
                                    {p.telegram_id ? ` · TG ${p.telegram_id}` : ''}
                                </span>
                                <button className="btn-primary !min-h-0 !px-3 !py-1.5 text-xs" onClick={() => approvePayment(p.id)}>
                                    ✓ Одобрить
                                </button>
                            </div>
                        ))}
                    </div>
                </Card>
            )}

            {/* Активные подключения: IP + страна */}
            <Card title="🌍 Активные подключения" subtitle="обновление каждые 5 секунд">
                {!active || active.connections.length === 0 ? (
                    <p className="text-sm text-slate-500 py-4 text-center">
                        Сейчас никто не подключён
                    </p>
                ) : (
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="text-left text-slate-500 border-b border-slate-200 dark:border-slate-700">
                                <th className="py-2 pr-4 font-medium">Клиент</th>
                                <th className="py-2 pr-4 font-medium">IP-адрес</th>
                                <th className="py-2 pr-4 font-medium">Страна</th>
                                <th className="py-2 font-medium">Протокол</th>
                            </tr>
                        </thead>
                        <tbody>
                            {active.connections.map((c, i) => (
                                <tr key={`${c.username}-${c.ip}-${i}`} className="border-b border-slate-100 dark:border-slate-800">
                                    <td className="py-2 pr-4 font-medium">{c.username}</td>
                                    <td className="py-2 pr-4 font-mono text-xs">{c.ip}</td>
                                    <td className="py-2 pr-4">{c.country}</td>
                                    <td className="py-2">{c.protocol === 'web' ? '🌐 Web' : '🔌 MTProto'}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}
            </Card>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                {/* Статусы сервисов + аптайм */}
                <Card title="Статус сервисов" subtitle="время работы без перезапусков">
                    <div className="space-y-3">
                        {[
                            ['telemt', services.telemt, 'Telemt (прокси)', data.uptimes?.telemt],
                            ['panel', services.panel, 'Панель', data.uptimes?.panel],
                            ['nginx', services.nginx, 'Nginx', data.uptimes?.nginx],
                            ['caddy', services.caddy, 'Caddy (HTTPS)', data.uptimes?.caddy],
                        ].map(([key, ok, label, uptime]) => (
                            <div key={key}>
                                <StatusDot ok={ok} label={label} />
                                <div className="text-xs text-slate-400 ml-5 mt-0.5">
                                    {uptime != null ? `без падений: ${formatUptime(uptime)}` : 'аптайм недоступен'}
                                </div>
                            </div>
                        ))}
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
