// Дашборд в «телеметрическом» стиле: статус-баннер, KPI со спарклайнами,
// проблемы, сетка DC, ME-пул, апстримы, живой трафик, события, платежи
import React, { useEffect, useMemo, useState } from 'react';
import {
    AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
    PieChart, Pie, Cell, Legend,
} from 'recharts';
import {
    AlertTriangle, CheckCircle2, Lock, Signal, Timer, Wallet,
} from 'lucide-react';
import { get, post } from '../api';
import { toast, useLangStore } from '../store';
import { useT } from '../i18n';
import { connectLive } from '../ws';
import {
    Card, StatusDot, ProgressBar, Skeleton, ProtoBadge, formatBytes, chartTheme,
} from '../components/ui';

/** Спарклайн без осей (для KPI-карточек) */
function Spark({ data, dataKey = 'v', color = '#0088cc' }) {
    return (
        <div className="h-9 -mx-1">
            <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={data} margin={{ top: 3, right: 0, bottom: 0, left: 0 }}>
                    <Area type="monotone" dataKey={dataKey} stroke={color}
                          fill={color} fillOpacity={0.15} strokeWidth={1.5} isAnimationActive={false} />
                </AreaChart>
            </ResponsiveContainer>
        </div>
    );
}

/** KPI-карточка: подпись, крупное значение, субтекст, спарклайн */
function Kpi({ label, value, sub, spark, color }) {
    return (
        <Card className="!p-4">
            <div className="text-xs font-medium text-slate-500 dark:text-slate-400">{label}</div>
            <div className="text-2xl font-bold leading-tight mt-0.5">{value}</div>
            {sub && <div className="text-[11px] text-slate-400 dark:text-slate-500 mt-0.5 truncate">{sub}</div>}
            <div className="mt-2">{spark}</div>
            {color && <div className="h-0.5 rounded-full mt-1" style={{ background: color }} />}
        </Card>
    );
}

export default function Dashboard() {
    const t = useT();
    const lang = useLangStore((s) => s.lang);

    // --- Данные ---
    const [dash, setDash] = useState(null);        // /stats/dashboard
    const [active, setActive] = useState(null);    // /stats/active
    const [connHist, setConnHist] = useState([]);  // история соединений для спарклайна
    const [series, setSeries] = useState(null);    // /stats/traffic-live
    const [range, setRange] = useState('1h');      // диапазон живого графика
    const [pay, setPay] = useState(null);          // /payments
    const [sales, setSales] = useState(null);      // /sales/summary
    const [clients, setClients] = useState([]);    // /clients?limit=200
    const [dc, setDc] = useState(null);            // /stats/dc
    const [engine, setEngine] = useState(null);    // /stats/engine
    const [upq, setUpq] = useState(null);          // /stats/uptime
    const [events, setEvents] = useState([]);      // /stats/events
    const [avail, setAvail] = useState(null);      // /stats/availability
    const [live, setLive] = useState(null);        // WebSocket: нагрузка сервера

    // --- WebSocket: пуш системной статистики каждую секунду ---
    useEffect(() => {
        const close = connectLive((msg) => {
            if (msg.type === 'stats') setLive(msg.data);
        });
        return close;
    }, []);

    // --- Опрос: активные подключения 5с (+история для спарклайна) ---
    useEffect(() => {
        const load = () => get('/stats/active').then((d) => {
            setActive(d);
            setConnHist((h) => [...h.slice(-29), { v: d.active_total || 0 }]);
        }).catch(() => {});
        load();
        const iv = setInterval(load, 5000);
        return () => clearInterval(iv);
    }, []);

    // --- Опрос: сводка дашборда, DC, движок, uptime, события, платежи, доступность 15с ---
    useEffect(() => {
        const load = () => {
            get('/stats/dashboard').then(setDash).catch(() => {});
            get('/stats/dc').then(setDc).catch(() => {});
            get('/stats/engine').then(setEngine).catch(() => {});
            get('/stats/uptime').then(setUpq).catch(() => {});
            get('/stats/events').then((d) => setEvents(d.events || [])).catch(() => {});
            get('/payments').then(setPay).catch(() => {});
            get('/stats/availability').then(setAvail).catch(() => {});
        };
        load();
        const iv = setInterval(load, 15000);
        return () => clearInterval(iv);
    }, []);

    // --- Опрос: клиенты и продажи 60с ---
    useEffect(() => {
        const load = () => {
            get('/clients?limit=200').then((d) => setClients(d.clients || [])).catch(() => {});
            get('/sales/summary?days=14').then(setSales).catch(() => {});
        };
        load();
        const iv = setInterval(load, 60000);
        return () => clearInterval(iv);
    }, []);

    // --- Живой график: смена диапазона + опрос 15с ---
    useEffect(() => {
        const load = () => get(`/stats/traffic-live?range=${range}`).then(setSeries).catch(() => {});
        load();
        const iv = setInterval(load, 15000);
        return () => clearInterval(iv);
    }, [range]);

    // --- Производные значения ---
    const d = dash || {};
    const ssl = d.ssl || null;
    const services = d.services || {};
    const uptimes = d.uptimes || {};
    const quality = useMemo(() => {
        const rows = upq?.uptime || [];
        const ok = rows.reduce((a, r) => a + (r.ok_count || 0), 0);
        const tot = rows.reduce((a, r) => a + (r.total || 0), 0);
        return tot > 0 ? (ok / tot) * 100 : null;
    }, [upq]);

    /** Аптайм в формате «12 дн. 04:12» */
    const upFmt = (sec) => {
        if (sec == null) return null;
        const days = Math.floor(sec / 86400);
        const h = Math.floor((sec % 86400) / 3600);
        const m = Math.floor((sec % 3600) / 60);
        if (lang === 'en') {
            if (days > 0) return `${days}d ${h}h ${m}m`;
            if (h > 0) return `${h}h ${m}m`;
            return `${m} min`;
        }
        if (days > 0) return `${days} дн. ${h} ч ${m} мин`;
        if (h > 0) return `${h} ч ${m} мин`;
        return `${m} мин`;
    };

    /** «N мин. назад» */
    const ago = (iso) => {
        const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
        if (mins < 60) return t('dashboard.evMinAgo', { n: Math.max(1, mins) });
        const hrs = Math.floor(mins / 60);
        if (hrs < 24) return t('dashboard.evHrsAgo', { n: hrs });
        return t('dashboard.evDaysAgo', { n: Math.floor(hrs / 24) });
    };

    /** Действие без HTTP-метода */
    const actOnly = (a) => String(a || '').replace(/^(GET|POST|PUT|PATCH|DELETE)\s+/i, '');

    /** Человекочитаемое событие из action/details аудита */
    const eventInfo = (e) => {
        const parts = String(e.action || '').split(' ');
        const method = parts[0];
        const path = parts.slice(1).join(' ') || e.action;
        let d = {};
        try { d = JSON.parse(e.details || '{}'); } catch { /* нет деталей */ }
        if (path.startsWith('/api/updates/panel')) return d.version ? t('dashboard.evUpdPanel', { v: d.version }) : t('dashboard.evUpdCheck');
        if (path.startsWith('/api/updates/telemt')) return d.version ? t('dashboard.evUpdTelemt', { v: d.version }) : t('dashboard.evUpdCheck');
        if (path.startsWith('/api/updates/check')) return t('dashboard.evUpdCheck');
        if (path.startsWith('/api/updates')) return t('dashboard.evUpdCheck');
        if (path.startsWith('/api/clients/bulk')) return t('dashboard.evBulk', { n: Array.isArray(d.ids) ? d.ids.length : '—' });
        if (path.endsWith('/rotate')) return t('dashboard.evRotate', { u: d.username || '—' });
        if (path.endsWith('/reset-quota')) return t('dashboard.evQuotaReset', { u: d.username || '—' });
        if (path.startsWith('/api/clients/') && method === 'DELETE') return t('dashboard.evUserDeleted', { u: d.username || '—' });
        if (path.startsWith('/api/clients/') && method === 'PATCH') return t('dashboard.evUserUpdated', { u: d.username || '—' });
        if (path.startsWith('/api/clients') && method === 'POST') return t('dashboard.evUserCreated', { u: d.username || '—' });
        if (path.startsWith('/api/settings/domain')) return t('dashboard.evDomain');
        if (path.startsWith('/api/settings')) return t('dashboard.evSettings');
        if (path.startsWith('/api/bot')) return t('dashboard.evBot');
        if (path.startsWith('/api/zapret2')) return t('dashboard.evZapret', { a: path.split('/').pop() });
        return path;
    };

    /** Время HH:MM */
    const hhmm = (iso) => new Date(iso).toLocaleTimeString(lang === 'en' ? 'en-GB' : 'ru-RU', {
        hour: '2-digit', minute: '2-digit',
    });

    /** Дней до даты */
    const daysLeft = (iso) => Math.ceil((new Date(iso).getTime() - Date.now()) / 86400000);

    // Метки сервисов (nginx/caddy — имена собственные, не переводим)
    const svcLabel = {
        telemt: t('dashboard.svcTelemt'),
        panel: t('dashboard.svcPanel'),
        nginx: 'nginx',
        caddy: 'caddy',
    };

    const downSvc = Object.entries(services).filter(([, ok]) => !ok).map(([k]) => k);

    // --- Проблемы: квоты, сроки, DC, сервисы ---
    const problems = useMemo(() => {
        const list = [];
        for (const c of clients) {
            if (c.quota_percent != null && c.quota_percent >= 85) {
                list.push({ kind: 'warn', text: t('dashboard.pQuota', { u: c.username, p: Math.round(c.quota_percent) }) });
            }
            if (c.status === 'active' && c.expires_at) {
                const dl = daysLeft(c.expires_at);
                if (dl <= 3) list.push({ kind: 'warn', text: t('dashboard.pExpire', { u: c.username, d: Math.max(0, dl) }) });
            }
        }
        if (dc?.enabled && dc?.overall === 'degraded') {
            list.push({ kind: 'bad', text: t('dashboard.dcDegraded') });
        }
        if (downSvc.length > 0) {
            list.push({ kind: 'bad', text: t('dashboard.pSvc', { list: downSvc.map((s) => svcLabel[s] || s).join(', ') }) });
        }
        return list;
    }, [clients, dc, downSvc.join(','), lang]);

    // Уровень статус-баннера: red — сервисы упали, yellow — есть предупреждения
    const warnings = (dc?.enabled && dc?.overall && dc.overall !== 'ok')
        || (ssl?.daysLeft != null && ssl.daysLeft < 14)
        || (quality != null && quality < 95);
    const level = downSvc.length > 0 ? 'bad' : warnings ? 'partial' : 'ok';
    const bannerStyle = {
        ok: { border: 'border-emerald-500/40 bg-emerald-500/5', dot: 'bg-emerald-500', text: 'text-emerald-600 dark:text-emerald-400' },
        partial: { border: 'border-amber-500/40 bg-amber-500/5', dot: 'bg-amber-500', text: 'text-amber-600 dark:text-amber-400' },
        bad: { border: 'border-red-500/50 bg-red-500/5', dot: 'bg-red-500', text: 'text-red-600 dark:text-red-400' },
    }[level];

    // Платежи к подтверждению
    const pending = (pay?.payments || []).filter((p) => p.status === 'pending');

    // Пул писателей / апстримы (поля могут быть null)
    const writers = engine?.pool?.writers || null;
    const ups = engine?.upstreams || null;

    const loadPayments = () => get('/payments').then(setPay).catch(() => {});

    // Подтвердить платёж — выдать доступ
    const approvePayment = async (id) => {
        try {
            await post(`/payments/${id}/confirm`);
            toast.success(t('dashboard.approved', { id }));
            loadPayments();
        } catch (e) {
            toast.error(e.message);
        }
    };

    // Отменить платёж
    const cancelPayment = async (id) => {
        if (!window.confirm(t('dashboard.confirmCancel', { id }))) return;
        try {
            await post(`/payments/${id}/cancel`);
            toast.success(t('dashboard.cancelled', { id }));
            loadPayments();
        } catch (e) {
            toast.error(e.message);
        }
    };

    // Ручной замер доступности из РФ
    const checkAvail = () => {
        post('/stats/availability/check').catch(() => {});
        toast.info(t('dashboard.availStarted'), { duration: 8000 });
    };

    if (!dash) {
        return <div className="space-y-4">{[...Array(4)].map((_, i) => <Skeleton key={i} className="h-32" />)}</div>;
    }

    // Данные графиков
    const newByDay = (sales?.new_clients_by_day || []).map((r) => ({ d: r.day, v: r.count }));
    const trafficSpark = (d.traffic?.daily || []).slice(-14).map((r) => ({ d: r.date, v: r.bytes }));
    const livePoints = (series?.points || []).map((p) => ({
        ...p, time: hhmm(p.t),
    }));
    const topClients = (d.traffic?.byClient || []).slice(0, 5).map((r) => ({ name: r.username, value: r.bytes }));
    const palette = [chartTheme.colors.primary, chartTheme.colors.green, chartTheme.colors.amber, chartTheme.colors.violet, chartTheme.colors.red];

    const quotaTop = clients
        .filter((c) => c.quota_percent != null)
        .sort((a, b) => b.quota_percent - a.quota_percent)
        .slice(0, 5);
    const expiring = clients
        .filter((c) => c.status === 'active' && c.expires_at && daysLeft(c.expires_at) <= 3)
        .sort((a, b) => new Date(a.expires_at) - new Date(b.expires_at))
        .slice(0, 3);

    return (
        <div className="space-y-4">
            {/* 1. Статус-баннер */}
            <div className={`rounded-2xl border p-4 flex flex-wrap items-center gap-4 justify-between ${bannerStyle.border}`}>
                <div className="flex items-center gap-3 min-w-0">
                    {level === 'ok'
                        ? <CheckCircle2 size={22} className={`${bannerStyle.text} shrink-0`} />
                        : <AlertTriangle size={22} className={`${bannerStyle.text} shrink-0`} />}
                    <div className="min-w-0">
                        <div className={`font-semibold ${bannerStyle.text}`}>
                            {t(level === 'ok' ? 'dashboard.bannerOk' : level === 'partial' ? 'dashboard.bannerPartial' : 'dashboard.bannerBad')}
                        </div>
                        {level === 'bad' && (
                            <div className="text-xs text-red-500/90 truncate">
                                {downSvc.map((s) => svcLabel[s] || s).join(', ')}
                            </div>
                        )}
                    </div>
                </div>
                <div className="flex gap-6 text-sm">
                    <div>
                        <div className="text-[11px] text-slate-500 dark:text-slate-400">{t('dashboard.bannerUptime')}</div>
                        <div className="font-bold">{upFmt(uptimes.panel) || '—'}</div>
                    </div>
                    <div>
                        <div className="text-[11px] text-slate-500 dark:text-slate-400">{t('dashboard.bannerSsl')}</div>
                        <div className={`font-bold ${ssl?.daysLeft != null && ssl.daysLeft < 14 ? 'text-amber-500' : ''}`}>
                            {ssl?.daysLeft != null ? t('dashboard.daysShort', { n: ssl.daysLeft }) : '—'}
                        </div>
                    </div>
                    <div>
                        <div className="text-[11px] text-slate-500 dark:text-slate-400">{t('dashboard.statOnline')}</div>
                        <div className="font-bold">{active?.active_total ?? '—'}</div>
                    </div>
                </div>
            </div>

            {/* 2. KPI-карточки со спарклайнами */}
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
                <Kpi label={t('dashboard.kpiConn')}
                     value={active?.active_total ?? '—'}
                     sub={t('dashboard.statOnlineSub', { n: d.connections?.total ?? 0 })}
                     spark={<Spark data={connHist.length > 1 ? connHist : [{ v: 0 }, { v: active?.active_total || 0 }]} color={chartTheme.colors.primary} />} />
                <Kpi label={t('dashboard.kpiUsers')}
                     value={d.clients?.activeToday ?? '—'}
                     sub={t('dashboard.statClientsSub', { today: d.clients?.activeToday ?? 0, week: d.clients?.newWeek ?? 0 })}
                     spark={<Spark data={newByDay.length > 1 ? newByDay : [{ v: 0 }, { v: 0 }]} color={chartTheme.colors.green} />} />
                <Kpi label={t('dashboard.kpiTrafficToday')}
                     value={formatBytes(d.traffic?.day, lang)}
                     sub={t('dashboard.statTrafficSub', { d: formatBytes(d.traffic?.day, lang), w: formatBytes(d.traffic?.week, lang) })}
                     spark={<Spark data={trafficSpark.length > 1 ? trafficSpark : [{ v: 0 }, { v: 0 }]} color={chartTheme.colors.amber} />} />
                <Kpi label={t('dashboard.kpiQuality')}
                     value={quality != null ? `${quality.toFixed(1)}%` : '—'}
                     sub={t('dashboard.kpiQualitySub')}
                     spark={<Spark data={(upq?.uptime || []).map((r) => ({ v: r.total ? (r.ok_count / r.total) * 100 : 100 }))} color={chartTheme.colors.green} />} />
            </div>

            {/* 3. Проблемы */}
            <Card title={t('dashboard.problems')}>
                {problems.length === 0 ? (
                    <p className="text-sm text-emerald-600 dark:text-emerald-400 py-1">{t('dashboard.problemsNone')}</p>
                ) : (
                    <ul className="space-y-2">
                        {problems.map((p, i) => (
                            <li key={i} className="flex items-center gap-2 text-sm">
                                <AlertTriangle size={15} className={p.kind === 'bad' ? 'text-red-500 shrink-0' : 'text-amber-500 shrink-0'} />
                                <span className={p.kind === 'bad' ? 'text-red-600 dark:text-red-400' : ''}>{p.text}</span>
                            </li>
                        ))}
                    </ul>
                )}
            </Card>

            {/* 4. Сетка DC */}
            {dc?.enabled && (dc?.perDc || []).length > 0 && (
                <Card title={t('dashboard.dcTitle')}
                      subtitle={t(dc.overall === 'ok' ? 'dashboard.dcOk' : dc.overall === 'degraded' ? 'dashboard.dcDegraded' : 'dashboard.dcPartial')}>
                    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
                        {dc.perDc.map((x) => (
                            <div key={x.dc}
                                 className={`rounded-xl border p-3 ${x.degraded ? 'border-red-500/60 bg-red-500/5' : 'border-emerald-500/40 bg-emerald-500/5'}`}>
                                <div className="text-xs font-semibold text-slate-500 dark:text-slate-400">DC{x.dc}</div>
                                <div className={`text-xl font-bold ${x.degraded ? 'text-red-500' : 'text-emerald-600 dark:text-emerald-400'}`}>
                                    {x.coverage_pct != null ? `${Math.round(x.coverage_pct)}%` : '—'}
                                </div>
                                <div className="text-[11px] text-slate-500 dark:text-slate-400">
                                    {x.rtt_ms != null ? t('dashboard.dcRtt', { n: Math.round(x.rtt_ms) }) : '—'}
                                </div>
                                <div className="text-[11px] text-slate-400 font-mono">{x.alive_writers}/{x.required_writers}</div>
                            </div>
                        ))}
                    </div>
                </Card>
            )}

            {/* 5. Двухколоночная сетка 2:1 */}
            <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
                {/* --- Левая колонка --- */}
                <div className="xl:col-span-2 space-y-4">
                    {/* ME-пул */}
                    <Card title={t('dashboard.meTitle')}>
                        {writers ? (
                            <>
                                <div className="flex items-baseline gap-2">
                                    <span className="text-3xl font-bold">{writers.alive ?? writers.healthy ?? ((writers.total || 0) - (writers.degraded || 0))}/{writers.total}</span>
                                    <span className="text-xs text-slate-400">{t('dashboard.meAvailSub')}</span>
                                </div>
                                <div className="flex flex-wrap gap-2 mt-3">
                                    <span className="badge-green">{t('dashboard.meHealthy')}: {writers.alive ?? writers.healthy ?? ((writers.total || 0) - (writers.degraded || 0))}</span>
                                    <span className={(writers.degraded || 0) > 0 ? 'badge-red' : 'badge-green'}>
                                        {t('dashboard.meDegraded')}: {writers.degraded ?? 0}
                                    </span>
                                    <span className="badge-blue">{t('common.total')}: {writers.total}</span>
                                </div>
                            </>
                        ) : (
                            <p className="text-sm text-slate-500 py-2">—</p>
                        )}
                    </Card>

                    {/* Апстримы */}
                    <Card title={t('dashboard.upsTitle')}>
                        {ups?.summary ? (
                            <>
                                <div className="flex items-center gap-2 text-sm mb-2">
                                    <Signal size={15} className="text-slate-400" />
                                    <span className="text-emerald-600 dark:text-emerald-400 font-semibold">{ups.summary.healthy_total ?? 0}</span>
                                    <span className="text-slate-400">/</span>
                                    <span className={`font-semibold ${(ups.summary.unhealthy_total || 0) > 0 ? 'text-red-500' : 'text-slate-500'}`}>
                                        {ups.summary.unhealthy_total ?? 0}
                                    </span>
                                    <span className="text-xs text-slate-400">{t('dashboard.upsHealthy')}</span>
                                </div>
                                <div className="space-y-1.5">
                                    {(ups.upstreams || []).slice(0, 3).map((u, i) => (
                                        <div key={u.address || i} className="flex items-center gap-2 text-sm">
                                            <span className={`w-2 h-2 rounded-full shrink-0 ${u.healthy ? 'bg-emerald-500' : 'bg-red-500'}`} />
                                            <span className="font-mono text-xs truncate">{u.route_kind || ''} {u.address || ''}</span>
                                            <span className="ml-auto text-xs text-slate-400 shrink-0">
                                                {u.effective_latency_ms != null ? t('dashboard.msVal', { n: Math.round(u.effective_latency_ms) }) : ''}
                                            </span>
                                        </div>
                                    ))}
                                </div>
                            </>
                        ) : (
                            <p className="text-sm text-slate-500 py-2">—</p>
                        )}
                    </Card>

                    {/* График трафика (1h / 6h / 24h) */}
                    <Card title={t('dashboard.liveTitle')}
                          subtitle={live ? t('dashboard.network', { rx: formatBytes(live?.network?.rx_sec, lang), tx: formatBytes(live?.network?.tx_sec, lang) }) : t('dashboard.liveSubtitle')}
                          actions={
                              <div className="flex rounded-lg overflow-hidden border border-slate-200 dark:border-slate-700 text-xs font-medium">
                                  {['1h', '6h', '24h'].map((r) => (
                                      <button key={r} onClick={() => setRange(r)}
                                              className={`px-2.5 py-1.5 transition-colors ${range === r ? 'bg-primary text-white' : 'text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800'}`}>
                                          {r}
                                      </button>
                                  ))}
                              </div>
                          }>
                        <div className="h-56">
                            <ResponsiveContainer width="100%" height="100%">
                                <AreaChart data={livePoints} margin={{ top: 5, right: 5, bottom: 0, left: 0 }}>
                                    <defs>
                                        <linearGradient id="gTx" x1="0" y1="0" x2="0" y2="1">
                                            <stop offset="0%" stopColor={chartTheme.colors.amber} stopOpacity={0.35} />
                                            <stop offset="100%" stopColor={chartTheme.colors.amber} stopOpacity={0} />
                                        </linearGradient>
                                        <linearGradient id="gRx" x1="0" y1="0" x2="0" y2="1">
                                            <stop offset="0%" stopColor={chartTheme.colors.primary} stopOpacity={0.35} />
                                            <stop offset="100%" stopColor={chartTheme.colors.primary} stopOpacity={0} />
                                        </linearGradient>
                                    </defs>
                                    <CartesianGrid strokeDasharray="3 3" stroke={chartTheme.gridColor} strokeOpacity={0.15} vertical={false} />
                                    <XAxis dataKey="time" tick={chartTheme.tick} tickLine={false} axisLine={false} minTickGap={40} />
                                    <YAxis tick={chartTheme.tick} tickLine={false} axisLine={false} width={62}
                                           tickFormatter={(v) => formatBytes(v, lang)} />
                                    <Tooltip contentStyle={chartTheme.tooltip}
                                             formatter={(v, name) => [`${formatBytes(v, lang)}${t('dashboard.perSecShort')}`, name]} />
                                    <Legend wrapperStyle={{ fontSize: 11 }} />
                                    <Area type="monotone" dataKey="tx" name={t('dashboard.seriesTx')}
                                          stroke={chartTheme.colors.amber} fill="url(#gTx)" strokeWidth={1.8} isAnimationActive={false} />
                                    <Area type="monotone" dataKey="rx" name={t('dashboard.seriesRx')}
                                          stroke={chartTheme.colors.primary} fill="url(#gRx)" strokeWidth={1.8} isAnimationActive={false} />
                                </AreaChart>
                            </ResponsiveContainer>
                        </div>
                    </Card>

                    {/* Активные подключения */}
                    <Card title={t('dashboard.activeTitle')} subtitle={t('dashboard.activeSubtitle')}>
                        {(active?.connections || []).length === 0 ? (
                            <p className="text-sm text-slate-500 py-4 text-center">{t('dashboard.activeEmpty')}</p>
                        ) : (
                            <table className="w-full text-sm">
                                <thead>
                                    <tr className="text-left text-slate-500 border-b border-slate-200 dark:border-slate-700">
                                        <th className="py-2 pr-4 font-medium">{t('dashboard.thClient')}</th>
                                        <th className="py-2 pr-4 font-medium">{t('dashboard.thIp')}</th>
                                        <th className="py-2 pr-4 font-medium hidden sm:table-cell">{t('dashboard.thCountry')}</th>
                                        <th className="py-2 font-medium">{t('dashboard.thProto')}</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {(active?.connections || []).slice(0, 8).map((c, i) => (
                                        <tr key={`${c.username}-${c.ip}-${i}`} className="border-b border-slate-100 dark:border-slate-800">
                                            <td className="py-1.5 pr-4 font-medium truncate max-w-[120px]">{c.username}</td>
                                            <td className="py-1.5 pr-4 font-mono text-xs">{c.ip}</td>
                                            <td className="py-1.5 pr-4 hidden sm:table-cell">{c.country || '—'}</td>
                                            <td className="py-1.5"><ProtoBadge protocol={c.protocol} /></td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        )}
                    </Card>
                </div>

                {/* --- Правая колонка --- */}
                <div className="space-y-4">
                    {/* События */}
                    <Card title={t('dashboard.eventsTitle')}>
                        {events.length === 0 ? (
                            <p className="text-sm text-slate-500 py-2 text-center">{t('dashboard.activeEmpty')}</p>
                        ) : (
                            <div className="relative space-y-3 pl-1 max-h-72 overflow-y-auto pr-1">
                                {events.slice(0, 10).map((e, i) => (
                                    <div key={i} className="flex gap-3 relative">
                                        {i < Math.min(events.length, 10) - 1 && (
                                            <span className="absolute left-[4.5px] top-4 -bottom-2 w-px bg-slate-200 dark:bg-slate-700" />
                                        )}
                                        <span className="mt-1.5 w-2.5 h-2.5 rounded-full bg-primary/70 ring-4 ring-primary/10 shrink-0" />
                                        <div className="min-w-0 flex-1">
                                            <div className="flex items-baseline justify-between gap-2">
                                                <span className="text-sm font-medium truncate">{eventInfo(e)}</span>
                                                <span className="text-[11px] text-slate-400 shrink-0">{hhmm(e.created_at)}</span>
                                            </div>
                                            <div className="text-xs text-slate-500 dark:text-slate-400 truncate">
                                                {ago(e.created_at)}
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </Card>

                    {/* Квоты и сроки */}
                    <Card title={t('dashboard.quotaTitle')}>
                        {quotaTop.length === 0 && expiring.length === 0 ? (
                            <p className="text-sm text-slate-500 py-2 text-center">—</p>
                        ) : (
                            <>
                                <div className="space-y-2.5">
                                    {quotaTop.map((c) => (
                                        <div key={c.id}>
                                            <div className="flex justify-between text-xs mb-1">
                                                <span className="font-medium truncate">{c.username}</span>
                                                <span className={c.quota_percent >= 85 ? 'text-red-500 font-semibold' : 'text-slate-500'}>
                                                    {Math.round(c.quota_percent)}%
                                                </span>
                                            </div>
                                            <ProgressBar percent={c.quota_percent} />
                                        </div>
                                    ))}
                                </div>
                                {expiring.length > 0 && (
                                    <div className="mt-3 pt-3 border-t border-slate-100 dark:border-slate-800 space-y-1.5">
                                        {expiring.map((c) => (
                                            <div key={c.id} className="flex items-center gap-2 text-xs">
                                                <Timer size={13} className="text-amber-500 shrink-0" />
                                                <span className="font-medium truncate">{c.username}</span>
                                                <span className="ml-auto text-slate-500 shrink-0">
                                                    {t('dashboard.daysShort', { n: Math.max(0, daysLeft(c.expires_at)) })}
                                                </span>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </>
                        )}
                    </Card>

                    {/* Платежи к подтверждению */}
                    <Card title={t('dashboard.pendingTitle')}>
                        {pending.length === 0 ? (
                            <p className="text-sm text-slate-500 py-2 text-center">{t('dashboard.activeEmpty')}</p>
                        ) : (
                            <div className="space-y-2.5">
                                {pending.map((p) => (
                                    <div key={p.id} className="flex items-center gap-2 text-sm">
                                        <Wallet size={15} className="text-slate-400 shrink-0" />
                                        <div className="min-w-0 flex-1">
                                            <div className="font-medium truncate">{p.username || t('dashboard.topupFallback')}</div>
                                            <div className="text-xs text-slate-400">#{p.id}</div>
                                        </div>
                                        <span className="font-bold shrink-0">{p.amount}</span>
                                        <button className="btn-ghost !min-h-0 !px-2 !py-1 text-xs text-emerald-600" onClick={() => approvePayment(p.id)}>
                                            {t('dashboard.approve')}
                                        </button>
                                        <button className="btn-ghost !min-h-0 !px-2 !py-1 text-xs text-red-500" onClick={() => cancelPayment(p.id)}>
                                            {t('dashboard.cancel')}
                                        </button>
                                    </div>
                                ))}
                            </div>
                        )}
                    </Card>

                    {/* Сервисы */}
                    <Card title={t('dashboard.svcTitle')} subtitle={t('dashboard.svcSubtitle')}>
                        <div className="space-y-2">
                            {['telemt', 'panel', 'nginx', 'caddy'].map((k) => (
                                <div key={k} className="flex items-center justify-between gap-2">
                                    <StatusDot ok={services[k]} label={svcLabel[k]} />
                                    <span className="text-xs text-slate-400 flex items-center gap-1 shrink-0">
                                        {uptimes[k] != null
                                            ? <>{t('dashboard.svcUptime', { t: upFmt(uptimes[k]) })}</>
                                            : t('dashboard.svcNoUptime')}
                                    </span>
                                </div>
                            ))}
                        </div>
                        <div className="mt-3 pt-3 border-t border-slate-100 dark:border-slate-800 space-y-2 text-sm">
                            <div className="flex items-center justify-between">
                                <span className="flex items-center gap-2"><Lock size={14} className="text-slate-400" />{t('dashboard.sslTitle')}</span>
                                <span className={`text-xs font-medium ${ssl?.daysLeft != null && ssl.daysLeft < 14 ? 'text-amber-500' : 'text-slate-500'}`}>
                                    {ssl?.daysLeft != null ? t('dashboard.sslDays') + `: ${ssl.daysLeft}` : t('dashboard.sslFail')}
                                </span>
                            </div>
                            <div className="flex items-center justify-between">
                                <span>{t('dashboard.protoWeb')}</span>
                                <span className={`text-xs font-medium ${d.protocols?.web ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-500'}`}>
                                    {d.protocols?.web ? t('dashboard.svcOn') : t('dashboard.svcOff')}
                                </span>
                            </div>
                            <div className="flex items-center justify-between">
                                <span>{t('dashboard.protoMtproto')}</span>
                                <span className="text-xs font-medium text-emerald-600 dark:text-emerald-400">{t('dashboard.svcOn')}</span>
                            </div>
                        </div>
                    </Card>

                    {/* Доступность из РФ */}
                    <Card title={t('dashboard.availTitle')}
                          actions={
                              <button className="btn-secondary !min-h-0 !py-1.5 !px-3 text-xs" onClick={checkAvail}>
                                  {t('dashboard.availCheckBtn')}
                              </button>
                          }>
                        {avail?.last ? (
                            <div className="text-sm mb-2">
                                <span className="font-bold">{avail.last.pct != null ? `${Math.round(avail.last.pct)}%` : '—'}</span>{' '}
                                <span className="text-xs text-slate-400">
                                    {t('dashboard.availPct', { ok: avail.last.probes_ok, total: avail.last.probes_total })}
                                </span>
                            </div>
                        ) : (
                            <p className="text-sm text-slate-500 mb-2">{t('dashboard.availNone')}</p>
                        )}
                        {(avail?.history || []).length > 0 && (
                            <div className="flex items-end gap-[3px] h-14">
                                {avail.history.slice(-24).map((h, i) => (
                                    <div key={i} title={`${Math.round(h.pct)}%`}
                                         className={`flex-1 min-w-[4px] rounded-t transition-all ${h.pct >= 70 ? 'bg-emerald-500/80' : h.pct >= 40 ? 'bg-amber-500/80' : 'bg-red-500/80'}`}
                                         style={{ height: `${Math.max(6, h.pct)}%` }} />
                                ))}
                            </div>
                        )}
                    </Card>

                    {/* Топ клиентов */}
                    <Card title={t('dashboard.topTitle')} subtitle={t('dashboard.topSubtitle')}>
                        {topClients.length === 0 ? (
                            <p className="text-sm text-slate-500 py-4 text-center">{t('dashboard.topEmpty')}</p>
                        ) : (
                            <div className="h-52">
                                <ResponsiveContainer width="100%" height="100%">
                                    <PieChart>
                                        <Pie data={topClients} dataKey="value" nameKey="name"
                                             innerRadius={38} outerRadius={62} paddingAngle={3} strokeWidth={0}>
                                            {topClients.map((_, i) => (
                                                <Cell key={i} fill={palette[i % palette.length]} />
                                            ))}
                                        </Pie>
                                        <Tooltip contentStyle={chartTheme.tooltip} formatter={(v) => formatBytes(v, lang)} />
                                        <Legend wrapperStyle={{ fontSize: 11 }} />
                                    </PieChart>
                                </ResponsiveContainer>
                            </div>
                        )}
                    </Card>
                </div>
            </div>
        </div>
    );
}
