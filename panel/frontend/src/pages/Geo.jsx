// География: карта мира + справа рейтинг стран с процентами; клик по стране — показать на карте
import React, { useEffect, useMemo, useState } from 'react';
import { Globe2, RefreshCw, X } from 'lucide-react';
import { get } from '../api';
import { useT } from '../i18n';
import { Card, Skeleton, PageHeader } from '../components/ui';
import { feature } from 'topojson-client';
import worldData from '../assets/world-110m.json';

/** Флаг-эмодзи из ISO2 */
function flag(iso) {
    if (!iso || iso.length !== 2 || !/^[A-Z]{2}$/.test(iso)) return '🌐';
    return String.fromCodePoint(...[...iso].map((ch) => 0x1f1e6 + ch.charCodeAt(0) - 65));
}

const dnCache = {};
function countryName(iso, fallback) {
    if (!iso || iso === '—') return fallback || '—';
    try {
        dnCache[iso] = dnCache[iso] || new Intl.DisplayNames(['ru'], { type: 'region' });
        return dnCache[iso].of(iso) || fallback;
    } catch {
        return fallback || iso;
    }
}

const W = 1000, H = 500;
const px = (lng) => ((Number(lng) + 180) / 360) * W;
const py = (lat) => ((78 - Number(lat)) / 136) * H;
const project = ([lng, lat]) => [((lng + 180) / 360) * W, ((78 - lat) / 136) * H];

const WORLD_PATHS = (() => {
    try {
        const fc = feature(worldData, worldData.objects.countries);
        const paths = [];
        for (const f of fc.features) {
            if (f.id === '010') continue;
            const geom = f.geometry;
            if (!geom) continue;
            const polys = geom.type === 'Polygon' ? [geom.coordinates] : geom.coordinates;
            let d = '';
            for (const poly of polys) {
                for (const ring of poly) {
                    ring.forEach(([lng, lat], i) => {
                        const [x, y] = project([lng, lat]);
                        d += (i === 0 ? 'M' : 'L') + x.toFixed(1) + ',' + y.toFixed(1);
                    });
                    d += 'Z';
                }
            }
            if (d) paths.push(d);
        }
        return paths;
    } catch {
        return [];
    }
})();

const RANGES = ['24h', '7d', '30d'];

export default function Geo() {
    const [range, setRange] = useState('7d');
    const [data, setData] = useState(null);
    const [sel, setSel] = useState(null);
    const t = useT();

    const load = () => get(`/geo/summary?range=${range}`).then(setData).catch(() => {});
    useEffect(load, [range]);
    useEffect(() => {
        const iv = setInterval(load, 30000);
        return () => clearInterval(iv);
    }, [range]);

    const bubbles = useMemo(
        () => (data?.countries || []).filter((c) => c.lat != null && c.code !== '—'),
        [data]
    );
    const totalsConns = data?.totals?.conns || 0;
    const maxConns = Math.max(1, ...(data?.countries || []).map((c) => c.conns));
    // Подписи на карте — только у топ-4 (чтобы Европа не превращалась в кашу)
    const topCodes = new Set(
        [...(data?.countries || [])].sort((a, b) => b.conns - a.conns).slice(0, 4).map((c) => c.code)
    );

    if (!data) return <div className="space-y-4">{[...Array(3)].map((_, i) => <Skeleton key={i} className="h-40" />)}</div>;

    const selectedCountry = sel ? (data.countries.find((x) => x.code === sel) || null) : null;

    return (
        <div className="space-y-4">
            <PageHeader icon={<Globe2 size={20} />} title={t('geo.title')}
                        subtitle={t('geo.subtitle')}
                        actions={
                            <div className="flex gap-2 items-center">
                                <select className="input !w-auto" value={range} onChange={(e) => { setRange(e.target.value); setSel(null); }}>
                                    {RANGES.map((r) => <option key={r} value={r}>{t(`geo.range_${r}`)}</option>)}
                                </select>
                                <button className="btn-secondary !px-3" onClick={() => { load(); setSel(null); }}><RefreshCw size={16} /></button>
                            </div>
                        } />

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                {/* Карта (2/3) */}
                <div className="lg:col-span-2">
                    <Card>
                        <svg viewBox={`0 0 ${W} ${H}`} className="w-full rounded-xl">
                            <defs>
                                <radialGradient id="ocean" cx="50%" cy="40%" r="80%">
                                    <stop offset="0%" stopColor="#e2e8f0" />
                                    <stop offset="100%" stopColor="#cbd5e1" />
                                </radialGradient>
                                <radialGradient id="oceanDark" cx="50%" cy="40%" r="80%">
                                    <stop offset="0%" stopColor="#1e293b" />
                                    <stop offset="100%" stopColor="#0f172a" />
                                </radialGradient>
                            </defs>
                            <rect x="0" y="0" width={W} height={H} className="dark:hidden" fill="url(#ocean)" />
                            <rect x="0" y="0" width={W} height={H} className="hidden dark:block" fill="url(#oceanDark)" />
                            {WORLD_PATHS.map((d, i) => (
                                <path key={i} d={d} className="fill-slate-200/70 dark:fill-slate-800/80 stroke-slate-300/40 dark:stroke-slate-600/30" strokeWidth="0.5" />
                            ))}
                            {bubbles.map((c) => {
                                const isSel = sel && c.code === sel;
                                const dimmed = sel && !isSel;
                                const r = (isSel ? 16 : 7) + 20 * Math.sqrt(c.conns / maxConns);
                                const showLabels = (isSel && c.code === sel) || (!sel && topCodes.has(c.code));
                                return (
                                    <g key={c.code} className="cursor-pointer" opacity={dimmed ? 0.18 : 1}
                                       onClick={() => setSel(isSel ? null : c.code)}>
                                        <title>{`${flag(c.code)} ${countryName(c.code, c.country)} — ${t('geo.connections')}: ${c.conns}, ${t('geo.ipsN', { n: c.ips })}`}</title>
                                        {!dimmed && (
                                            <circle cx={px(c.lng)} cy={py(c.lat)} r={r} className="fill-primary/25">
                                                <animate attributeName="r" values={`${r};${r * 2.2}`} dur="2.2s" repeatCount="indefinite" />
                                                <animate attributeName="opacity" values="0.55;0" dur="2.2s" repeatCount="indefinite" />
                                            </circle>
                                        )}
                                        <circle cx={px(c.lng)} cy={py(c.lat)} r={r} className="fill-primary/30 stroke-primary" strokeWidth={isSel ? 3 : 2} />
                                        {showLabels && (
                                            <>
                                                <text x={px(c.lng)} y={py(c.lat) - r - 10} textAnchor="middle"
                                                      className="fill-slate-600 dark:fill-slate-200" fontSize="16" fontWeight="600">
                                                    {flag(c.code)} {c.conns}
                                                </text>
                                                <text x={px(c.lng)} y={py(c.lat) + r + 20} textAnchor="middle"
                                                      className="fill-slate-500 dark:fill-slate-400" fontSize="14">
                                                    {countryName(c.code, c.country)}
                                                </text>
                                            </>
                                        )}
                                    </g>
                                );
                            })}
                        </svg>
                        {data.totals.unresolved > 0 && (
                            <p className="text-xs text-slate-400 mt-2">{t('geo.resolving', { n: data.totals.unresolved })}</p>
                        )}
                    </Card>
                </div>

                {/* Правая колонка: страны с процентами, клик — фильтр на карте */}
                <Card title={t('geo.listTitle')}>
                    {sel && (
                        <button className="text-xs text-primary mb-2 flex items-center gap-1" onClick={() => setSel(null)}>
                            <X size={13} /> {t('geo.showAll')}
                        </button>
                    )}
                    {data.countries.length === 0 ? (
                        <p className="text-sm text-slate-500 py-6 text-center">{t('geo.empty')}</p>
                    ) : (
                        <div className="space-y-1.5 max-h-[520px] overflow-y-auto pr-1">
                            {data.countries.map((c) => {
                                const pct = totalsConns ? Math.round((c.conns / totalsConns) * 100) : 0;
                                const active = sel === c.code;
                                return (
                                    <button key={c.code}
                                            className={`w-full text-left rounded-lg px-2 py-1.5 transition-colors ${active ? 'bg-primary/10 ring-1 ring-primary/40' : 'hover:bg-slate-100 dark:hover:bg-slate-800'}`}
                                            onClick={() => setSel(active ? null : c.code)}>
                                        <div className="flex items-center gap-2">
                                            <span className="text-lg w-6 text-center">{flag(c.code)}</span>
                                            <span className="text-sm font-medium flex-1 truncate">{countryName(c.code, c.country)}</span>
                                            <span className="text-xs text-slate-400">{pct}%</span>
                                        </div>
                                        <div className="flex items-center gap-2 mt-1">
                                            <div className="flex-1 h-1 rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden">
                                                <div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
                                            </div>
                                            <span className="text-[11px] text-slate-400 w-16 text-right">
                                                {t('geo.ipsN', { n: c.ips })} · {c.users}👤
                                            </span>
                                        </div>
                                    </button>
                                );
                            })}
                        </div>
                    )}
                </Card>
            </div>

            {/* Сводка */}
            <div className="grid grid-cols-3 gap-4">
                <Card><div className="text-2xl font-bold">{data.totals.countries}</div><div className="text-sm text-slate-500">{t('geo.countries')}</div></Card>
                <Card><div className="text-2xl font-bold">{data.totals.ips}</div><div className="text-sm text-slate-500">{t('geo.uniqueIps')}</div></Card>
                <Card><div className="text-2xl font-bold">{data.totals.conns}</div><div className="text-sm text-slate-500">{t('geo.connections')}</div></Card>
            </div>
        </div>
    );
}
