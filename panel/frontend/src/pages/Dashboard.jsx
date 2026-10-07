// Дашборд: сводка системы в реальном времени
import React, { useEffect, useState } from 'react';
import { AreaChart, Area, LineChart, Line, PieChart, Pie, Cell, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { Users, Link2, Wifi, HardDrive, Cpu, MemoryStick, RefreshCw, LayoutDashboard, Satellite } from 'lucide-react';
import { get, post } from '../api';
import { useAuthStore, useLangStore, toast } from '../store';
import { useT } from '../i18n';
import { connectLive } from '../ws';
import { Card, StatusDot, Skeleton, formatBytes, deviceInfo, PageHeader, chartTheme, Avatar, ProtoBadge } from '../components/ui';

const COLORS = ['#0088cc', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6', '#f97316'];

/** Формат аптайма: «3 дн. 04:12» или «5 ч 12 мин» */
function formatUptime(secs, lang) {
    if (secs == null) return '—';
    const d = Math.floor(secs / 86400);
    const h = Math.floor((secs % 86400) / 3600);
    const m = Math.floor((secs % 3600) / 60);
    if (lang === 'en') {
        if (d > 0) return `${d}d ${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
        if (h > 0) return `${h}h ${m}m`;
        return `${m} min`;
    }
    if (d > 0) return `${d} дн. ${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    if (h > 0) return `${h} ч ${m} мин`;
    return `${m} мин`;
}

/** Карточка-счётчик (опционально: мини-тренд справа) */
function StatCard({ icon: Icon, label, value, sub, spark, sparkColor }) {
    return (
        <Card>
            <div className="flex items-center gap-3">
                <div className="w-11 h-11 rounded-xl bg-primary/10 text-primary flex items-center justify-center shrink-0">
                    <Icon size={22} />
                </div>
                <div className="flex-1 min-w-0">
                    <div className="text-2xl font-bold leading-tight">{value}</div>
                    <div className="text-sm text-slate-500 dark:text-slate-400">{label}</div>
                    {sub && <div className="text-xs text-slate-400 mt-0.5">{sub}</div>}
                </div>
                {spark && spark.length >= 2 && (
                    <ResponsiveContainer width={96} height={36}>
                        <LineChart data={spark} margin={{ top: 2, right: 2, bottom: 2, left: 2 }}>
                            <Line type="monotone" dataKey="v" stroke={sparkColor || chartTheme.colors.primary}
                                  strokeWidth={2} dot={false} isAnimationActive={false} />
                        </LineChart>
                    </ResponsiveContainer>
                )}
            </div>
        </Card>
    );
}

/** Полоса состояния дата-центров Telegram (DC-монитор) */
function DcStrip({ t }) {
    const [dc, setDc] = useState(null);
    useEffect(() => {
        const load = () => get('/stats/dc').then(setDc).catch(() => {});
        load();
        const timer = setInterval(load, 30000);
        return () => clearInterval(timer);
    }, []);
    if (!dc || !dc.enabled || dc.overall === 'unknown' || dc.perDc.length === 0) return null;
    const style = dc.overall === 'ok'
        ? 'border-emerald-500/40 bg-emerald-500/5'
        : dc.overall === 'degraded'
            ? 'border-red-500/40 bg-red-500/5'
            : 'border-amber-500/40 bg-amber-500/5';
    const icon = dc.overall === 'ok' ? '🟢' : dc.overall === 'degraded' ? '🔴' : '🟡';
    return (
        <div className={`flex flex-wrap items-center gap-3 p-4 rounded-2xl border transition-colors ${style}`}>
            <span className="text-2xl">{icon}</span>
            <div className="flex-1 min-w-[200px]">
                <div className="font-bold flex items-center gap-2">
                    <Satellite size={16} /> {t('dashboard.dcTitle')}
                </div>
                <div className="flex flex-wrap gap-1.5 mt-1.5">
                    {dc.perDc.map((d) => (
                        <span key={d.dc} title={d.rtt_ms != null ? t('dashboard.dcRtt', { n: Math.round(d.rtt_ms) }) : undefined}
                              className={d.degraded ? 'badge-red' : 'badge-green'}>
                            DC{d.dc} · {Math.round(d.coverage_pct)}%
                        </span>
                    ))}
                </div>
            </div>
            <div className="text-xs text-slate-400">
                {dc.overall === 'ok' ? t('dashboard.dcOk')
                    : dc.overall === 'degraded' ? t('dashboard.dcDegraded') : t('dashboard.dcPartial')}
            </div>
        </div>
    );
}

/** Карточка внешней доступности (замеры Globalping) */
function AvailCard({ t }) {
    const [avail, setAvail] = useState(null);
    const [checking, setChecking] = useState(false);
    useEffect(() => {
        const load = () => get('/stats/availability').then(setAvail).catch(() => {});
        load();
        const timer = setInterval(load, 60000);
        return () => clearInterval(timer);
    }, []);
    if (!avail || (!avail.enabled && !avail.last)) return null;
    const hist = (avail.history || []).slice(-30);
    const last = avail.last;
    const checkNow = async () => {
        setChecking(true);
        try {
            await post('/stats/availability/check');
            toast.success(t('dashboard.availStarted'));
            setTimeout(() => get('/stats/availability').then(setAvail).catch(() => {}), 95000);
        } catch (e) {
            toast.error(e.message);
        } finally {
            setChecking(false);
        }
    };
    return (
        <Card title={t('dashboard.availTitle')}
              subtitle={last ? t('dashboard.availPct', { ok: last.probes_ok, total: last.probes_total }) : t('dashboard.availNone')}
              actions={
                  <button className="btn-secondary !min-h-0 !px-3 !py-1.5 text-sm" disabled={checking} onClick={checkNow}>
                      <RefreshCw size={14} /> {t('dashboard.availCheckBtn')}
                  </button>
              }>
            {hist.length > 0 && (
                <div className="flex items-end gap-1 h-14">
                    {hist.map((h, i) => {
                        const pct = h.pct ?? 0;
                        const color = pct >= 80 ? 'bg-emerald-500' : pct >= 50 ? 'bg-amber-500' : 'bg-red-500';
                        return (
                            <div key={i} title={`${h.probes_ok}/${h.probes_total}`}
                                 className={`flex-1 rounded-sm ${color} opacity-80`}
                                 style={{ height: `${Math.max(8, pct)}%` }} />
                        );
                    })}
                </div>
            )}
        </Card>
    );
}

export default function Dashboard() {    const [data, setData] = useState(null);
    const [live, setLive] = useState(null); // real-time нагрузка из WebSocket
    const [active, setActive] = useState(null); // активные подключения (IP + страна)
    const [error, setError] = useState('');
    const accessToken = useAuthStore((s) => s.accessToken);
    const lang = useLangStore((s) => s.lang);
    const t = useT();

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

    // Мини-тренды для KPI-карточек: новые клиенты по дням (14 дн.)
    const [trends, setTrends] = useState({ clients: null });
    useEffect(() => {
        get('/sales/summary?days=14')
            .then((d) => setTrends({ clients: (d.new_clients_by_day || []).map((r) => ({ v: r.count })) }))
            .catch(() => {});
    }, []);

    const approvePayment = async (id) => {
        try {
            await post(`/payments/${id}/confirm`);
            toast.success(t('dashboard.approved', { id }));
            setPending((p) => p.filter((x) => x.id !== id));
        } catch (e) {
            toast.error(e.message);
        }
    };

    const cancelPayment = async (id) => {
        if (!confirm(t('dashboard.confirmCancel', { id }))) return;
        try {
            await post(`/payments/${id}/cancel`);
            toast.success(t('dashboard.cancelled', { id }));
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
            <PageHeader icon={<LayoutDashboard size={20} />} title={t('dashboard.title')}
                        subtitle={t('dashboard.subtitle')} />

            {/* Hero-полоса: общее состояние сервисов */}
            {(() => {
                const items = [
                    { key: 'telemt', ok: services.telemt, label: 'Telemt' },
                    { key: 'panel', ok: services.panel, label: t('dashboard.heroPanel') },
                    { key: 'nginx', ok: services.nginx, label: 'Nginx' },
                    { key: 'caddy', ok: services.caddy, label: 'Caddy' },
                ];
                const down = items.filter((i) => !i.ok);
                const allOk = down.length === 0;
                return (
                    <div className={`flex flex-wrap items-center gap-3 p-4 rounded-2xl border transition-colors
                        ${allOk ? 'border-emerald-500/40 bg-emerald-500/5' : 'border-red-500/40 bg-red-500/5'}`}>
                        <span className="text-2xl">{allOk ? '🟢' : '🔴'}</span>
                        <div className="flex-1 min-w-[200px]">
                            <div className="font-bold">
                                {allOk ? t('dashboard.heroOk') : t('dashboard.heroDown', { list: down.map((d) => d.label).join(', ') })}
                            </div>
                            <div className="text-xs text-slate-500 dark:text-slate-400">
                                {items.map((i) => `${i.ok ? '✅' : '❌'} ${i.label}`).join(' · ')}
                            </div>
                        </div>
                        <div className="text-xs text-slate-400">
                            SSL: {ssl ? t('dashboard.heroSsl', { days: ssl.daysLeft }) : '—'}
                        </div>
                    </div>
                );
            })()}

            {/* DC-монитор: доступность дата-центров Telegram */}
            <DcStrip t={t} />

            {/* Внешняя доступность: видимость прокси из России */}
            <AvailCard t={t} />

            {/* Счётчики */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <StatCard icon={Users} label={t('dashboard.statClients')} value={clients.total}
                    sub={t('dashboard.statClientsSub', { today: clients.activeToday, week: clients.newWeek })}
                    spark={trends.clients} sparkColor={chartTheme.colors.green} />
                <StatCard icon={Link2} label={t('dashboard.statLinks')} value={clients.active}
                    sub={t('dashboard.statLinksSub', { n: clients.expired })} />
                <StatCard icon={Wifi} label={t('dashboard.statOnline')} value={active?.active_total ?? connections.active}
                    sub={t('dashboard.statOnlineSub', { n: connections.total })} />
                <StatCard icon={HardDrive} label={t('dashboard.statTraffic')} value={formatBytes(traffic.month, lang)}
                    sub={t('dashboard.statTrafficSub', { d: formatBytes(traffic.day, lang), w: formatBytes(traffic.week, lang) })}
                    spark={(traffic.daily || []).slice(-14).map((r) => ({ v: r.bytes }))}
                    sparkColor={chartTheme.colors.primary} />
            </div>

            {/* Нагрузка сервера */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                <Card title={t('dashboard.loadTitle')} subtitle={t('dashboard.loadSubtitle')}>
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
                                <span className="font-mono">{ram ? `${ram.percent}% (${formatBytes(ram.used, lang)} / ${formatBytes(ram.total, lang)})` : '—'}</span>
                            </div>
                            <div className="h-2 rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden">
                                <div className="h-full bg-emerald-500 rounded-full transition-all duration-700" style={{ width: `${ram?.percent ?? 0}%` }} />
                            </div>
                        </div>
                        <div className="text-sm text-slate-500 dark:text-slate-400">
                            {t('dashboard.network', { rx: formatBytes(net.rx_sec, lang), tx: formatBytes(net.tx_sec, lang) })}
                        </div>
                    </div>
                </Card>

                {/* Трафик по дням */}
                <Card title={t('dashboard.traffic30')} className="lg:col-span-2">
                    <ResponsiveContainer width="100%" height={200}>
                        <AreaChart data={traffic.daily}>
                            <defs>
                                <linearGradient id="trafficGrad" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="0%" stopColor="#0088cc" stopOpacity={0.4} />
                                    <stop offset="100%" stopColor="#0088cc" stopOpacity={0} />
                                </linearGradient>
                            </defs>
                            <XAxis dataKey="date" tick={chartTheme.tick} tickFormatter={(d) => d.slice(5)} />
                            <YAxis tick={chartTheme.tick} tickFormatter={(v) => formatBytes(v, lang)} width={70} />
                            <Tooltip formatter={(v) => formatBytes(v, lang)} labelFormatter={(d) => t('dashboard.trafficDate', { d })}
                                     contentStyle={chartTheme.tooltip} labelStyle={{ color: '#e2e8f0' }} />
                            <Area type="monotone" dataKey="bytes" stroke="#0088cc" fill="url(#trafficGrad)" name={t('dashboard.trafficSeries')} />
                        </AreaChart>
                    </ResponsiveContainer>
                </Card>
            </div>

            {/* Живой график трафика: получение/отправка */}
            <Card title={t('dashboard.liveTitle')}
                  subtitle={t('dashboard.liveSubtitle')}
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
                          <div className="text-xs text-slate-500 mb-0.5">{t('dashboard.liveUp')}</div>
                          <div className="text-2xl font-bold">{formatBytes(liveTraffic?.current?.tx ?? 0, lang)}<span className="text-sm font-normal text-slate-400"> {t('dashboard.perSec')}</span></div>
                      </div>
                      <div>
                          <div className="text-xs text-slate-500 mb-0.5">{t('dashboard.liveDown')}</div>
                          <div className="text-2xl font-bold text-amber-500">{formatBytes(liveTraffic?.current?.rx ?? 0, lang)}<span className="text-sm font-normal text-slate-400"> {t('dashboard.perSec')}</span></div>
                      </div>
                  </div>
                  <ResponsiveContainer width="100%" height={220}>
                      <LineChart data={liveTraffic?.points || []} margin={{ top: 5, right: 5, bottom: 0, left: 5 }}>
                           <XAxis dataKey="t" type="number" scale="time" domain={['dataMin', 'dataMax']}
                                  tickFormatter={(t) => new Date(t).toLocaleTimeString(lang === 'en' ? 'en-GB' : 'ru-RU', { hour: '2-digit', minute: '2-digit' })}
                                  tick={{ fontSize: 10, fill: '#94a3b8' }} stroke="#64748b" />
                           <YAxis tickFormatter={(v) => formatBytes(v, lang)} tick={{ fontSize: 10, fill: '#94a3b8' }} stroke="#64748b" width={70} />
                           <Tooltip
                               formatter={(v, name) => [`${formatBytes(v, lang)}${t('dashboard.perSecShort')}`, name]}
                               labelFormatter={(t) => new Date(t).toLocaleTimeString(lang === 'en' ? 'en-GB' : 'ru-RU')}
                               contentStyle={chartTheme.tooltip} />
                           <Line type="monotone" dataKey="tx" name={t('dashboard.seriesTx')} stroke="#0088cc" strokeWidth={1.5} dot={false} />
                           <Line type="monotone" dataKey="rx" name={t('dashboard.seriesRx')} stroke="#f59e0b" strokeWidth={1.5} dot={false} />
                      </LineChart>
                  </ResponsiveContainer>
                  <div className="flex gap-4 mt-2 text-xs text-slate-400">
                      <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-primary inline-block" /> {t('dashboard.seriesTx')}</span>
                      <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-500 inline-block" /> {t('dashboard.seriesRx')}</span>
                  </div>
            </Card>

            {/* Платежи, ожидающие подтверждения */}
            {pending.length > 0 && (
                <Card title={t('dashboard.pendingTitle')} subtitle={t('dashboard.pendingSubtitle')}>
                    <div className="space-y-2">
                        {pending.map((p) => (
                            <div key={p.id} className="flex items-center justify-between gap-3 rounded-lg bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/30 px-3 py-2">
                                <span className="text-sm">
                                    <b>#{p.id}</b> — {p.tariff_name || t('dashboard.topupFallback')} · {p.amount} {p.currency}
                                    {p.username ? ` · ${p.username}` : ''}
                                    {p.telegram_id ? ` · TG ${p.telegram_id}` : ''}
                                </span>
                                <span className="flex gap-2">
                                    <button className="btn-danger !min-h-0 !px-3 !py-1.5 text-xs" onClick={() => cancelPayment(p.id)}>
                                        {t('dashboard.cancel')}
                                    </button>
                                    <button className="btn-primary !min-h-0 !px-3 !py-1.5 text-xs" onClick={() => approvePayment(p.id)}>
                                        {t('dashboard.approve')}
                                    </button>
                                </span>
                            </div>
                        ))}
                    </div>
                </Card>
            )}

            {/* Активные подключения: IP + страна */}
            <Card title={t('dashboard.activeTitle')} subtitle={t('dashboard.activeSubtitle')}>
                {!active || active.connections.length === 0 ? (
                    <p className="text-sm text-slate-500 py-4 text-center">
                        {t('dashboard.activeEmpty')}
                    </p>
                ) : (
                    <div className="overflow-x-auto">
                    <table className="w-full text-sm min-w-[560px]">
                        <thead className="sticky top-0 z-10 bg-white dark:bg-slate-900">
                            <tr className="text-left text-slate-500 border-b border-slate-200 dark:border-slate-700">
                                <th className="py-2 pr-4 font-medium">{t('dashboard.thClient')}</th>
                                <th className="py-2 pr-4 font-medium">{t('dashboard.thIp')}</th>
                                <th className="py-2 pr-4 font-medium">{t('dashboard.thCountry')}</th>
                                <th className="py-2 pr-4 font-medium">{t('dashboard.thDevice')}</th>
                                <th className="py-2 font-medium">{t('dashboard.thProto')}</th>
                            </tr>
                        </thead>
                        <tbody>
                            {active.connections.map((c, i) => {
                                const dev = deviceInfo(c.user_agent, lang);
                                return (
                                    <tr key={`${c.username}-${c.ip}-${i}`} className="border-b border-slate-100 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
                                        <td className="py-2 pr-4">
                                            <div className="flex items-center gap-2">
                                                <Avatar name={c.username} className="w-7 h-7 text-[11px]" />
                                                <span className="font-medium">{c.username}</span>
                                            </div>
                                        </td>
                                        <td className="py-2 pr-4 font-mono text-xs">{c.ip}</td>
                                        <td className="py-2 pr-4">{c.country}</td>
                                        <td className="py-2 pr-4 whitespace-nowrap" title={c.user_agent || ''}>{dev.icon} {dev.label}</td>
                                        <td className="py-2"><ProtoBadge protocol={c.protocol} /></td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                    </div>
                )}
            </Card>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                {/* Статусы сервисов + аптайм */}
                <Card title={t('dashboard.svcTitle')} subtitle={t('dashboard.svcSubtitle')}>
                    <div className="space-y-3">
                        {[
                            ['telemt', services.telemt, t('dashboard.svcTelemt'), data.uptimes?.telemt],
                            ['panel', services.panel, t('dashboard.svcPanel'), data.uptimes?.panel],
                            ['nginx', services.nginx, 'Nginx', data.uptimes?.nginx],
                            ['caddy', services.caddy, 'Caddy (HTTPS)', data.uptimes?.caddy],
                        ].map(([key, ok, label, uptime]) => (
                            <div key={key}>
                                <StatusDot ok={ok} label={label} />
                                <div className="text-xs text-slate-400 ml-5 mt-0.5">
                                    {uptime != null ? t('dashboard.svcUptime', { t: formatUptime(uptime, lang) }) : t('dashboard.svcNoUptime')}
                                </div>
                            </div>
                        ))}
                    </div>
                    <div className="mt-4 pt-4 border-t border-slate-200 dark:border-slate-700 space-y-2 text-sm">
                        <div className="flex justify-between">
                            <span className="text-slate-500">Web Proxy</span>
                            <span className={protocols.web ? 'text-emerald-500' : 'text-red-500'}>{protocols.web ? t('dashboard.svcOn') : t('dashboard.svcOff')}</span>
                        </div>
                        <div className="flex justify-between">
                            <span className="text-slate-500">MTProto (8443)</span>
                            <span className={protocols.mtproto ? 'text-emerald-500' : 'text-red-500'}>{protocols.mtproto ? t('dashboard.svcOn') : t('dashboard.svcOff')}</span>
                        </div>
                    </div>
                </Card>

                {/* SSL */}
                <Card title={t('dashboard.sslTitle')}>
                    {ssl ? (
                        <div className="text-center py-4">
                            <div className={`text-4xl font-bold ${ssl.daysLeft < 14 ? 'text-red-500' : 'text-emerald-500'}`}>
                                {ssl.daysLeft}
                            </div>
                            <div className="text-sm text-slate-500 mt-1">{t('dashboard.sslDays')}</div>
                            <div className="text-xs text-slate-400 mt-3 flex items-center justify-center gap-1">
                                <RefreshCw size={12} /> {t('dashboard.sslAuto')}
                            </div>
                        </div>
                    ) : (
                        <p className="text-sm text-slate-500 py-4 text-center">{t('dashboard.sslFail')}</p>
                    )}
                </Card>

                {/* Топ клиентов по трафику */}
                <Card title={t('dashboard.topTitle')} subtitle={t('dashboard.topSubtitle')}>
                    {traffic.byClient.length > 0 ? (
                        <ResponsiveContainer width="100%" height={180}>
                            <PieChart>
                                <Pie data={traffic.byClient} dataKey="bytes" nameKey="username"
                                     innerRadius={40} outerRadius={70} paddingAngle={2}>
                                    {traffic.byClient.map((_, i) => (
                                        <Cell key={i} fill={COLORS[i % COLORS.length]} />
                                    ))}
                                </Pie>
                                <Tooltip formatter={(v) => formatBytes(v, lang)} />
                            </PieChart>
                        </ResponsiveContainer>
                    ) : (
                        <p className="text-sm text-slate-500 py-8 text-center">{t('dashboard.topEmpty')}</p>
                    )}
                </Card>
            </div>
        </div>
    );
}
