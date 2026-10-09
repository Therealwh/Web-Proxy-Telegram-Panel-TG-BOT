// География подключений: карта-проекция с пузырями стран + рейтинг стран
import React, { useEffect, useMemo, useState } from 'react';
import { Globe2, RefreshCw } from 'lucide-react';
import { get } from '../api';
import { useT } from '../i18n';
import { Card, Skeleton, PageHeader } from '../components/ui';
import { feature } from 'topojson-client';
import worldData from '../assets/world-110m.json';

/** Флаг-эмодзи из ISO2 кода */
function flag(iso) {
    if (!iso || iso.length !== 2 || !/^[A-Z]{2}$/.test(iso)) return '🌐';
    return String.fromCodePoint(...[...iso].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));
}

/** Локализованное имя страны (Intl, с фолбэком на страну из гео) */
const displayNames = {};
function countryName(iso, fallback) {
    if (!iso || iso === '—') return fallback || '—';
    try {
        displayNames[iso] = displayNames[iso] || new Intl.DisplayNames(['ru'], { type: 'region' });
        return displayNames[iso].of(iso) || fallback;
    } catch {
        return fallback || iso;
    }
}

// Проекция: lng -180..180 → x 0..1000, lat 78..-58 → y 0..500
const W = 1000, H = 500;
const px = (lng) => ((Number(lng) + 180) / 360) * W;
const py = (lat) => ((78 - Number(lat)) / 136) * H;

const project = ([lng, lat]) => [((lng + 180) / 360) * W, ((78 - lat) / 136) * H];

// Контуры стран из world-atlas (110m) — строим один раз
const WORLD_PATHS = (() => {
    try {
        const fc = feature(worldData, worldData.objects.countries);
        const paths = [];
        for (const f of fc.features) {
            if (f.id === '010') continue; // Антарктида
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
    const t = useT();

    const load = () => {
        get(`/geo/summary?range=${range}`).then(setData).catch(() => {});
    };
    useEffect(load, [range]);
    useEffect(() => {
        const iv = setInterval(load, 30000);
        return () => clearInterval(iv);
    }, [range]);

    const bubbles = useMemo(
        () => (data?.countries || []).filter((c) => c.lat != null && c.code !== '—'),
        [data]
    );
    const maxConns = Math.max(1, ...(data?.countries || []).map((c) => c.conns));

    if (!data) return <div className="space-y-4">{[...Array(3)].map((_, i) => <Skeleton key={i} className="h-40" />)}</div>;

    return (
        <div className="space-y-4">
            <PageHeader icon={<Globe2 size={20} />} title={t('geo.title')}
                        subtitle={t('geo.subtitle')}
                        actions={
                            <div className="flex gap-2 items-center">
                                <select className="input !w-auto" value={range} onChange={(e) => setRange(e.target.value)}>
                                    {RANGES.map((r) => <option key={r} value={r}>{t(`geo.range_${r}`)}</option>)}
                                </select>
                                <button className="btn-secondary !px-3" onClick={load}><RefreshCw size={16} /></button>
                            </div>
                        } />

            {/* Карта */}
            <Card>
                <svg viewBox={`0 0 ${W} ${H}`} className="w-full rounded-xl bg-slate-100 dark:bg-slate-900/60">
                    {WORLD_PATHS.map((d, i) => (
                        <path key={i} d={d} className="fill-slate-200/70 dark:fill-slate-800/80 stroke-slate-300/40 dark:stroke-slate-600/30" strokeWidth="0.5" />
                    ))}
                    {bubbles.map((c) => {
                        const r = 6 + 18 * Math.sqrt(c.conns / maxConns);
                        return (
                            <g key={c.code}>
                                <circle cx={px(c.lng)} cy={py(c.lat)} r={r + 6}
                                        className="fill-primary/10" />
                                <circle cx={px(c.lng)} cy={py(c.lat)} r={r}
                                        className="fill-primary/30 stroke-primary" strokeWidth="1.5" />
                                <text x={px(c.lng)} y={py(c.lat) - r - 8} textAnchor="middle"
                                      className="fill-slate-500 dark:fill-slate-300" fontSize="15">
                                    {flag(c.code)} {c.conns}
                                </text>
                            </g>
                        );
                    })}
                </svg>
                {data.totals.unresolved > 0 && (
                    <p className="text-xs text-slate-400 mt-2">{t('geo.resolving', { n: data.totals.unresolved })}</p>
                )}
            </Card>

            {/* Сводка */}
            <div className="grid grid-cols-3 gap-4">
                <Card><div className="text-2xl font-bold">{data.totals.countries}</div><div className="text-sm text-slate-500">{t('geo.countries')}</div></Card>
                <Card><div className="text-2xl font-bold">{data.totals.ips}</div><div className="text-sm text-slate-500">{t('geo.uniqueIps')}</div></Card>
                <Card><div className="text-2xl font-bold">{data.totals.conns}</div><div className="text-sm text-slate-500">{t('geo.connections')}</div></Card>
            </div>

            {/* Рейтинг стран */}
            <Card title={t('geo.listTitle')}>
                {data.countries.length === 0 ? (
                    <p className="text-sm text-slate-500 py-6 text-center">{t('geo.empty')}</p>
                ) : (
                    <div className="space-y-2">
                        {data.countries.map((c) => (
                            <div key={c.code} className="flex items-center gap-3">
                                <span className="text-xl w-7 text-center">{flag(c.code)}</span>
                                <div className="flex-1 min-w-0">
                                    <div className="flex justify-between text-sm">
                                        <span className="font-medium truncate">{countryName(c.code, c.country)}</span>
                                        <span className="text-slate-500 text-xs ml-2 shrink-0">
                                            {t('geo.ipsN', { n: c.ips })} · {t('geo.usersN', { n: c.users })}
                                        </span>
                                    </div>
                                    <div className="h-1.5 rounded-full bg-slate-200 dark:bg-slate-700 mt-1 overflow-hidden">
                                        <div className="h-full rounded-full bg-primary" style={{ width: `${(c.conns / maxConns) * 100}%` }} />
                                    </div>
                                </div>
                                <span className="text-sm font-bold w-14 text-right">{c.conns}</span>
                            </div>
                        ))}
                    </div>
                )}
            </Card>
        </div>
    );
}
