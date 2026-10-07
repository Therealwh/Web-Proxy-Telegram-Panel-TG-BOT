// Страница телеметрии движка Telemt: ME-качество, пул, NAT/STUN, самопроверка, гейты, апстримы
import React, { useEffect, useState } from 'react';
import { Activity } from 'lucide-react';
import { get, post } from '../api';
import { toast } from '../store';
import { useT } from '../i18n';
import { Card, Skeleton, PageHeader } from '../components/ui';

/** Строка «метрика → значение» */
function Row({ label, value, bad }) {
    return (
        <div className="flex flex-wrap items-baseline justify-between gap-2 py-1.5 border-b border-slate-100 dark:border-slate-800/60 last:border-0">
            <span className="text-sm text-slate-500 dark:text-slate-400">{label}</span>
            <span className={`text-sm font-medium text-right break-all ${bad ? 'text-red-500' : ''}`}>
                {value ?? '—'}
            </span>
        </div>
    );
}

/** Секция с заглушкой при недоступности данных */
function Section({ title, data, children }) {
    return (
        <Card title={title}>
            {data ? children : <p className="text-sm text-slate-500 py-2">—</p>}
        </Card>
    );
}

export default function Engine() {
    const [data, setData] = useState(null);
    const [fp, setFp] = useState(null);
    const [fpQuery, setFpQuery] = useState('');
    const [enabling, setEnabling] = useState(false);
    const t = useT();

    useEffect(() => {
        const load = () => get('/stats/engine').then(setData).catch((e) => toast.error(e.message));
        load();
        const timer = setInterval(load, 30000);
        return () => clearInterval(timer);
    }, []);

    useEffect(() => {
        get('/stats/tls-fingerprints').then((d) => setFp(d.fingerprints || [])).catch(() => setFp([]));
    }, []);

    if (!data) return <div className="space-y-4">{[...Array(3)].map((_, i) => <Skeleton key={i} className="h-40" />)}</div>;

    const allNull = ['quality', 'pool', 'natStun', 'selftest', 'gates', 'upstreams', 'ready']
        .every((k) => !data[k]);

    const enableTelemetry = async () => {
        setEnabling(true);
        try {
            await post('/stats/engine/enable');
            toast.success(t('engine.enabledToast'));
            setTimeout(() => get('/stats/engine').then(setData).catch(() => {}), 5000);
        } catch (e) {
            toast.error(e.message);
        } finally {
            setEnabling(false);
        }
    };

    if (allNull) {
        return (
            <div className="space-y-4">
                <PageHeader icon={<Activity size={20} />} title={t('engine.title')}
                            subtitle={t('engine.subtitle')} />
                <Card>
                    <p className="text-sm text-slate-500 dark:text-slate-400 mb-4">
                        {t('engine.enableText')}
                    </p>
                    <button className="btn-primary" disabled={enabling} onClick={enableTelemetry}>
                        {enabling ? t('engine.enabling') : t('engine.enableBtn')}
                    </button>
                </Card>
            </div>
        );
    }

    const q = data.quality;
    const pool = data.pool;
    const nat = data.natStun;
    const self = data.selftest;
    const gates = data.gates;
    const ups = data.upstreams;
    const ready = data.ready;

    return (
        <div className="space-y-4">
            <PageHeader icon={<Activity size={20} />} title={t('engine.title')}
                        subtitle={t('engine.subtitle')} />

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <Section title={t('engine.qualityTitle')} data={q}>
                    <Row label={t('engine.reconnects')} value={q.counters ? `${q.counters.reconnect_success ?? '—'} / ${q.counters.reconnect_attempt ?? '—'}` : null} />
                    <Row label={t('engine.kdfDrift')} value={q.counters?.kdf_drift} />
                    <Row label={t('engine.routeDrops')} value={q.route_drops ? Object.values(q.route_drops).reduce((a, b) => a + (Number(b) || 0), 0) : null} />
                    <Row label={t('engine.reroute')} value={gates ? (gates.reroute_active ? t('engine.on') : t('engine.off')) : null}
                         bad={!!gates?.reroute_active} />
                    <Row label={t('engine.readyState')} value={ready ? (ready.ready ? t('engine.on') : t('engine.off')) : null}
                         bad={ready && !ready.ready} />
                </Section>

                <Section title={t('engine.poolTitle')} data={pool}>
                    <Row label={t('engine.writersAlive')} value={pool.writers?.alive} />
                    <Row label={t('engine.writersDegraded')} value={pool.writers?.degraded} bad={(pool.writers?.degraded || 0) > 0} />
                    <Row label={t('engine.writersTotal')} value={pool.writers?.total} />
                </Section>

                <Section title={t('engine.dcRttTitle')} data={q?.dc_rtt}>
                    {(q.dc_rtt || []).length === 0 ? (
                        <p className="text-sm text-slate-500 py-2">—</p>
                    ) : (
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="text-left text-slate-500 border-b border-slate-200 dark:border-slate-700">
                                    <th className="py-2 pr-4 font-medium">DC</th>
                                    <th className="py-2 pr-4 font-medium">RTT</th>
                                    <th className="py-2 font-medium">{t('engine.coverage')}</th>
                                </tr>
                            </thead>
                            <tbody>
                                {(q.dc_rtt || []).map((r) => (
                                    <tr key={r.dc} className="border-b border-slate-100 dark:border-slate-800">
                                        <td className="py-1.5 pr-4 font-mono">DC{r.dc}</td>
                                        <td className="py-1.5 pr-4">{r.rtt_ema_ms != null ? `${Math.round(r.rtt_ema_ms)} мс` : '—'}</td>
                                        <td className="py-1.5">{r.coverage_pct != null ? `${Math.round(r.coverage_pct)}%` : '—'}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )}
                </Section>

                <Section title={t('engine.natTitle')} data={nat}>
                    <Row label={t('engine.stunServers')} value={nat.servers ? (nat.servers.live ?? '—') : null} />
                    <Row label="IPv4" value={nat.reflection?.v4?.addr} />
                    <Row label="IPv6" value={nat.reflection?.v6?.addr} />
                </Section>

                <Section title={t('engine.selfTitle')} data={self}>
                    <Row label="KDF" value={self.kdf?.state} bad={self.kdf?.state === 'error'} />
                    <Row label={t('engine.timeskew')} value={self.timeskew?.state} bad={self.timeskew && self.timeskew.state !== 'ok'} />
                    <Row label="IPv4" value={self.ip?.v4?.state} />
                    <Row label="IPv6" value={self.ip?.v6?.state} />
                </Section>

                <Section title={t('engine.upsTitle')} data={ups}>
                    <Row label={t('engine.upsHealthy')} value={ups.summary ? `${ups.summary.healthy_total ?? '—'} / ${ups.summary.unhealthy_total ?? 0}` : null} />
                    {(ups.upstreams || []).slice(0, 8).map((u) => (
                        <Row key={u.upstream_id || u.address} label={`${u.route_kind || ''} ${u.address || u.upstream_id || ''}`}
                             value={`${u.healthy ? '✅' : '❌'} ${u.effective_latency_ms != null ? `${Math.round(u.effective_latency_ms)} мс` : ''}`}
                             bad={!u.healthy} />
                    ))}
                </Section>

                <Section title={t('engine.fpTitle')} data={fp}>
                    <input className="input mb-3" placeholder={t('engine.fpSearch')}
                           value={fpQuery} onChange={(e) => setFpQuery(e.target.value)} />
                    {(fp || []).filter((f) => !fpQuery || (f.fp || '').includes(fpQuery)).length === 0 ? (
                        <p className="text-sm text-slate-500 py-2 text-center">{t('engine.fpEmpty')}</p>
                    ) : (
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="text-left text-slate-500 border-b border-slate-200 dark:border-slate-700">
                                    <th className="py-2 pr-4 font-medium">JA4</th>
                                    <th className="py-2 pr-4 font-medium">{t('engine.fpTotal')}</th>
                                    <th className="py-2 font-medium">{t('engine.fpBad')}</th>
                                </tr>
                            </thead>
                            <tbody>
                                {(fp || []).filter((f) => !fpQuery || (f.fp || '').includes(fpQuery)).slice(0, 50).map((f) => (
                                    <tr key={f.fp} className="border-b border-slate-100 dark:border-slate-800">
                                        <td className="py-1.5 pr-4 font-mono text-xs break-all">{(f.ja4 || f.ja3 || '').slice(0, 40)}</td>
                                        <td className="py-1.5 pr-4">{f.total}</td>
                                        <td className={`py-1.5 ${f.bad_or_probe > 0 ? 'text-red-500 font-medium' : ''}`}>{f.bad_or_probe}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )}
                </Section>
            </div>
        </div>
    );
}
