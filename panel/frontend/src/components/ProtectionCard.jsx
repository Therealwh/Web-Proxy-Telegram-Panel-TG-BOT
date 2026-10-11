/**
 * @fileoverview Карточка «Защита и отказоустойчивость».
 *
 * Собрана в одном месте, потому что настройки связаны одной причиной: всё
 * это способы пережить блокировку или не дать движку уронить сервер.
 * Часть настроек применяется с перезапуском Telemt — об этом сказано
 * прямо на карточке, иначе пользователь решит, что кнопка не сработала.
 */

import { useEffect, useState } from 'react';
import { Card } from '../components/ui';
import { toast } from '../store';
import { useT } from '../i18n';

/** Единый POST с авторизацией панели и корректной обработкой ошибок. */
async function post(path, body) {
    const res = await fetch(path, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-Requested-With': 'XMLHttpRequest',
            Authorization: `Bearer ${sessionStorage.getItem('tggate_token')}`,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
}

async function get(path) {
    const res = await fetch(path, {
        headers: {
            'X-Requested-With': 'XMLHttpRequest',
            Authorization: `Bearer ${sessionStorage.getItem('tggate_token')}`,
        },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
}

export default function ProtectionCard() {
    const t = useT();
    const [busy, setBusy] = useState('');
    const [carriers, setCarriers] = useState([]);
    const [limits, setLimits] = useState(null);
    const [masking, setMasking] = useState(null);
    const [faketls, setFaketls] = useState(null);
    const [domains, setDomains] = useState(null);
    const [domainsText, setDomainsText] = useState('');
    const [upstream, setUpstream] = useState('');
    const [selfmask, setSelfmask] = useState(false);

    const load = async () => {
        try {
            const [c, l, m, d, f] = await Promise.all([
                get('/api/settings/web-carriers').catch(() => null),
                get('/api/settings/engine-limits').catch(() => null),
                get('/api/settings/masking').catch(() => null),
                get('/api/settings/backup-domains').catch(() => null),
                get('/api/settings/faketls').catch(() => null),
            ]);
            if (c) setCarriers(c.candidates || []);
            if (l) setLimits(l);
            if (m) {
                setMasking(m);
                setSelfmask(!!m.selfmask);
                setUpstream(m.selfmaskUpstream || '');
            }
            if (d) {
                setDomains(d);
                setDomainsText((d.backups || []).join('\n'));
            }
            if (f) setFaketls(f);
        } catch { /* карточка просто останется пустой */ }
    };

    useEffect(() => { load(); }, []);

    const run = async (key, fn, okMsg) => {
        setBusy(key);
        try {
            await fn();
            if (okMsg) toast.success(okMsg);
            await load();
        } catch (err) {
            toast.error(err.message);
        } finally {
            setBusy('');
        }
    };

    const toggleCarrier = (name) => {
        const next = carriers.includes(name)
            ? carriers.filter((c) => c !== name)
            : [...carriers, name];
        setCarriers(next);
    };

    return (
        <Card title={t('settings.protTitle')} subtitle={t('settings.protSub')}>
            <div className="space-y-5">

                {/* Резервные транспорты веб-прокси */}
                <section>
                    <h4 className="text-sm font-semibold mb-1">{t('settings.protCarriers')}</h4>
                    <p className="text-xs text-slate-500 mb-2">{t('settings.protCarriersHint')}</p>
                    <div className="flex flex-wrap gap-2 mb-2">
                        {['https-lanes', 'websocket', 'websocket-lanes'].map((c) => (
                            <button key={c}
                                onClick={() => toggleCarrier(c)}
                                className={`px-3 py-1.5 rounded-lg text-sm border transition-colors ${
                                    carriers.includes(c)
                                        ? 'bg-blue-600 text-white border-blue-600'
                                        : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 border-slate-300 dark:border-slate-600'
                                }`}>
                                {c}
                            </button>
                        ))}
                    </div>
                    <button className="btn-secondary" disabled={busy === 'carriers'}
                        onClick={() => run('carriers',
                            () => post('/api/settings/web-carriers', { carriers }),
                            t('settings.protApplied'))}>
                        {busy === 'carriers' ? '…' : t('settings.protApply')}
                    </button>
                </section>

                {/* Fake TLS: показываем не только «работает/нет», но и почему нет.
                    Без причины пользователь неделю гадает, почему у клиентов
                    по-прежнему dd, хотя функция «включена». */}
                <section>
                    <h4 className="text-sm font-semibold mb-1">{t('settings.protFakeTls')}</h4>
                    <p className="text-xs text-slate-500 mb-2">{t('settings.protFakeTlsHint')}</p>
                    <div className="text-sm mb-2">
                        {!faketls ? '—' : faketls.ready ? (
                            <span className="text-emerald-600 dark:text-emerald-400">
                                ✓ {t('settings.protFakeTlsOk', { d: faketls.domain })}
                            </span>
                        ) : (
                            <span className="text-amber-600 dark:text-amber-400">
                                {t('settings.protFakeTlsOff')}: {t(`settings.faketlsReason.${faketls.reason}`)}
                                {faketls.detail ? ` (${faketls.detail})` : ''}
                            </span>
                        )}
                    </div>
                    <button className="btn-secondary" disabled={busy === 'faketls'}
                        onClick={() => run('faketls',
                            () => post('/api/settings/faketls/check'),
                            t('settings.protApplied'))}>
                        {busy === 'faketls' ? '…' : t('settings.protFakeTlsRecheck')}
                    </button>
                </section>

                {/* Политика SNI */}
                <section className="pt-4 border-t border-slate-200 dark:border-slate-700">
                    <h4 className="text-sm font-semibold mb-1">{t('settings.protSni')}</h4>
                    <p className="text-xs text-slate-500 mb-2">{t('settings.protSniHint')}</p>
                    <div className="flex flex-wrap gap-2 items-center">
                        <select className="input flex-1 min-w-[220px]"
                            value={masking?.sniAction || 'drop'}
                            onChange={(e) => setMasking({ ...masking, sniAction: e.target.value })}>
                            {(masking?.sniAllowed || ['drop', 'mask', 'accept', 'reject_handshake'])
                                .map((a) => (
                                    <option key={a} value={a}>{masking?.sniLabels?.[a] || a}</option>
                                ))}
                        </select>
                        <button className="btn-secondary" disabled={busy === 'sni'}
                            onClick={() => run('sni',
                                () => post('/api/settings/masking/sni', { action: masking?.sniAction }),
                                t('settings.protApplied'))}>
                            {busy === 'sni' ? '…' : t('settings.protApply')}
                        </button>
                    </div>
                </section>

                {/* Selfmask */}
                <section className="pt-4 border-t border-slate-200 dark:border-slate-700">
                    <h4 className="text-sm font-semibold mb-1">{t('settings.protSelfmask')}</h4>
                    <p className="text-xs text-slate-500 mb-2">{t('settings.protSelfmaskHint')}</p>
                    <div className="flex flex-wrap gap-2 items-center">
                        <label className="flex items-center gap-2 text-sm">
                            <input type="checkbox" checked={selfmask}
                                onChange={(e) => setSelfmask(e.target.checked)} />
                            {t('settings.protSelfmaskOn')}
                        </label>
                        <input className="input flex-1 min-w-[200px]" placeholder="127.0.0.1:8099"
                            value={upstream} onChange={(e) => setUpstream(e.target.value)} />
                        <button className="btn-secondary" disabled={busy === 'selfmask'}
                            onClick={() => run('selfmask',
                                () => post('/api/settings/masking/selfmask', { enabled: selfmask, upstream }),
                                t('settings.protApplied'))}>
                            {busy === 'selfmask' ? '…' : t('settings.protApply')}
                        </button>
                    </div>
                </section>

                {/* Запасные домены */}
                <section className="pt-4 border-t border-slate-200 dark:border-slate-700">
                    <h4 className="text-sm font-semibold mb-1">{t('settings.protDomains')}</h4>
                    <p className="text-xs text-slate-500 mb-2">{t('settings.protDomainsHint')}</p>
                    <textarea className="input w-full font-mono text-sm" rows={3}
                        placeholder="backup1.example.com"
                        value={domainsText} onChange={(e) => setDomainsText(e.target.value)} />
                    {domains?.exceedsProfiles && (
                        <p className="text-xs text-amber-600 dark:text-amber-400 mt-1">
                            {t('settings.protProfilesWarn', {
                                n: domains.profilesEstimate, max: domains.maxProfiles,
                            })}
                        </p>
                    )}
                    <button className="btn-secondary mt-2" disabled={busy === 'domains'}
                        onClick={() => run('domains',
                            () => post('/api/settings/backup-domains', {
                                domains: domainsText.split(/[\s,]+/).filter(Boolean),
                            }),
                            t('settings.protApplied'))}>
                        {busy === 'domains' ? '…' : t('settings.protApply')}
                    </button>
                </section>

                {/* Лимиты ресурсов */}
                <section className="pt-4 border-t border-slate-200 dark:border-slate-700">
                    <h4 className="text-sm font-semibold mb-1">{t('settings.protLimits')}</h4>
                    <p className="text-xs text-slate-500 mb-2">{t('settings.protLimitsHint')}</p>
                    <div className="text-sm mb-2">
                        {limits?.available ? (
                            limits.applied ? (
                                <span>
                                    {t('settings.protLimitsOn')} <b>{Math.round((limits.memoryMax || 0) / 1048576)} МБ</b>
                                    {limits.usagePercent !== null && (
                                        <span className="text-slate-500">
                                            {' '}· {t('settings.protLimitsUsed')} {limits.usagePercent}%
                                        </span>
                                    )}
                                </span>
                            ) : (
                                <span className="text-amber-600 dark:text-amber-400">{t('settings.protLimitsOff')}</span>
                            )
                        ) : (
                            <span className="text-slate-500">—</span>
                        )}
                    </div>
                    <button className="btn-secondary" disabled={busy === 'limits'}
                        onClick={() => run('limits',
                            () => post('/api/settings/engine-limits'),
                            t('settings.protApplied'))}>
                        {busy === 'limits' ? '…' : t('settings.protApplyLimits')}
                    </button>
                </section>
            </div>
        </Card>
    );
}