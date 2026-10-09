// Страница обновлений: версии списком, выбор цели, настройки автопроверки
import React, { useEffect, useRef, useState } from 'react';
import { RefreshCw, Download, ShieldCheck, ChevronDown } from 'lucide-react';
import { get, post, put } from '../api';
import { toast, useLangStore } from '../store';
import { useT } from '../i18n';
import { Card, Field, Skeleton, formatDate, PageHeader } from '../components/ui';

/** Живой статус-бар обновления (данные из /updates/progress) */
function ProgressCard({ progress, seenRunning }) {
    const t = useT();
    if (!progress) return null;
    const running = progress.status === 'running';
    const failed = progress.status === 'failed';
    // Успешное обновление показываем только если оно происходило при открытой
    // странице (итог уже был в тосте) — иначе плашка висит после F5.
    // Неудавшееся — показываем в течение часа, чтобы пользователь не пропустил.
    if (!running && !seenRunning) {
        if (!failed) return null;
        const fAge = Date.now() - new Date(progress.updated_at).getTime();
        if (!Number.isFinite(fAge) || fAge > 60 * 60 * 1000) return null;
    }
    const percent = progress.total
        ? Math.min(100, Math.round((progress.step / progress.total) * 100))
        : (running ? 10 : 100);
    const started = progress.started_at ? new Date(progress.started_at).getTime() : NaN;
    const mins = Number.isFinite(started) ? Math.max(0, Math.round((Date.now() - started) / 60000)) : null;
    const title = failed ? t('updates.failedTitle')
        : running ? t('updates.runningTitle', { what: progress.component === 'panel' ? t('updates.whatPanel') : 'Telemt' })
        : t('updates.doneTitle');

    return (
        <Card className={`border ${failed ? 'border-red-500/60' : running ? 'border-blue-500/60' : 'border-emerald-500/60'}`}>
            <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                <div className="font-medium">
                    {title}
                    {progress.step && progress.total ? (
                        <span className="text-slate-400 text-sm font-normal"> {t('updates.stepOf', { step: progress.step, total: progress.total })}</span>
                    ) : ''}
                </div>
                {running && mins !== null && <span className="text-xs text-slate-400">{t('updates.minsN', { n: mins })}</span>}
            </div>
            <div className="w-full h-2 rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden">
                <div className={`h-full rounded-full transition-all duration-500 ${failed ? 'bg-red-500' : running ? 'bg-blue-500' : 'bg-emerald-500'}`}
                     style={{ width: `${percent}%` }} />
            </div>
            <div className={`mt-2 text-sm ${failed ? 'text-red-400' : 'text-slate-500 dark:text-slate-400'}`}>
                {progress.message}
            </div>
            {running && (
                <div className="mt-1 text-xs text-slate-400">
                    {t('updates.keepNote')}
                </div>
            )}
        </Card>
    );
}

/** Карточка компонента с выбором версии из списка релизов */
function UpdateCard({ title, current, latest, releases, loading, busy, onUpdate }) {
    const [showList, setShowList] = useState(false);
    const [selected, setSelected] = useState('');
    const lang = useLangStore((s) => s.lang);
    const t = useT();

    // По умолчанию — последняя доступная
    useEffect(() => { setSelected(''); }, [releases]);

    const chosen = selected || latest || '';

    return (
        <Card title={title}>
            <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                    <span className="text-slate-500">{t('updates.curVer')}</span>
                    <span className="font-mono">{current || '—'}</span>
                </div>
                <div className="flex justify-between">
                    <span className="text-slate-500">{t('updates.latestVer')}</span>
                    <span className="font-mono">
                        {latest || '—'} {latest && current && latest !== current ? '✅' : ''}
                    </span>
                </div>
            </div>

            {/* Выбор версии из списка релизов */}
            <div className="mt-3">
                <button type="button" className="btn-ghost !min-h-0 !py-1.5 text-xs w-full justify-between"
                        onClick={() => setShowList(!showList)}>
                    <span>{chosen ? t('updates.installVer', { v: chosen }) : t('updates.pickVer')}</span>
                    <ChevronDown size={14} className={`transition-transform ${showList ? 'rotate-180' : ''}`} />
                </button>
                {showList && (
                    <div className="mt-1 max-h-48 overflow-y-auto rounded-lg border border-slate-200 dark:border-slate-700">
                        {loading ? (
                            <p className="p-3 text-xs text-slate-500 text-center">{t('common.loading')}</p>
                        ) : releases.length === 0 ? (
                            <p className="p-3 text-xs text-slate-500 text-center">{t('updates.listDown')}</p>
                        ) : (
                            releases.map((r) => (
                                <button key={r.tag} type="button"
                                        className={`w-full text-left px-3 py-2 text-xs font-mono flex justify-between gap-2
                                            hover:bg-slate-100 dark:hover:bg-slate-800
                                            ${r.tag === chosen ? 'bg-primary/10 text-primary' : ''}`}
                                        onClick={() => { setSelected(r.raw || r.tag); setShowList(false); }}>
                                    <span>{r.tag}{r.prerelease ? ' (beta)' : ''}</span>
                                    {r.date && <span className="text-slate-400">{formatDate(r.date, lang).split(',')[0]}</span>}
                                </button>
                            ))
                        )}
                    </div>
                )}
            </div>

            <button className="btn-primary w-full mt-3" disabled={busy !== '' || !chosen}
                    onClick={() => onUpdate(chosen)}>
                <Download size={16} /> {busy ? t('updates.updating') : chosen ? t('updates.updateTo', { v: chosen }) : t('updates.updateBtn')}
            </button>
        </Card>
    );
}

export default function Updates() {
    const [status, setStatus] = useState(null);
    const [history, setHistory] = useState([]);
    const [releases, setReleases] = useState({ panel: [], telemt: [] });
    const [busy, setBusy] = useState('');
    const [relLoading, setRelLoading] = useState(false);
    const [progress, setProgress] = useState(null);
    const [sawRunning, setSawRunning] = useState(false);
    const prevProgressStatus = useRef('');
    const lang = useLangStore((s) => s.lang);
    const t = useT();

    const load = () => {
        get('/updates/status').then(setStatus).catch((e) => toast.error(e.message));
        get('/updates/history').then((d) => setHistory(d.history)).catch(() => {});
    };
    useEffect(() => { load(); }, [$1]);

    // Живой прогресс: опрос каждые 2.5 секунды
    useEffect(() => {
        let stop = false;
        const tick = () => get('/updates/progress')
            .then((d) => {
                if (stop) return;
                setProgress(d.progress);
                if (d.progress?.status === 'running') setSawRunning(true);
            })
            .catch(() => {});
        tick();
        const timer = setInterval(tick, 2500);
        return () => { stop = true; clearInterval(timer); };
    }, []);

    // По завершении обновления — тост, обновляем версии и перезагружаем страницу
    useEffect(() => {
        const st = progress?.status || '';
        if ((st === 'success' || st === 'failed') && prevProgressStatus.current === 'running') {
            load();
            if (st === 'success') {
                toast.success(t('updates.updatedReload'));
                setTimeout(() => window.location.reload(), 2500);
            }
        }
        prevProgressStatus.current = st;
    }, [progress?.status]);

    const loadReleases = () => {
        setRelLoading(true);
        Promise.all([
            get('/updates/available?component=panel'),
            get('/updates/available?component=telemt'),
        ]).then(([p, tm]) => {
            setReleases({ panel: p.releases, telemt: tm.releases });
        }).catch(() => {}).finally(() => setRelLoading(false));
    };
    useEffect(() => { loadReleases(); }, [$1]);

    const run = async (action, version, label) => {
        setBusy(action);
        try {
            await post(`/updates/${action}`, version ? { version } : {});
            toast.success(label);
            load();
        } catch (e) {
            toast.error(e.message);
        } finally {
            setBusy('');
        }
    };

    const saveSettings = async () => {
        try {
            await put('/updates/settings', {
                auto_check: status.settings.auto_check,
                frequency: status.settings.frequency,
                channel: status.settings.channel,
                auto_install: status.settings.auto_install,
            });
            toast.success(t('updates.settingsSaved'));
        } catch (e) {
            toast.error(e.message);
        }
    };

    if (!status) return <div className="space-y-4">{[...Array(3)].map((_, i) => <Skeleton key={i} className="h-40" />)}</div>;

    const setS = (k, v) => setStatus((s) => ({ ...s, settings: { ...s.settings, [k]: v } }));

    return (
        <div className="space-y-4">
            <PageHeader icon={<RefreshCw size={20} />} title={t('updates.title')}
                        subtitle={t('updates.subtitle')}
                        actions={
                            <button className="btn-secondary" disabled={busy !== ''}
                                    onClick={() => run('check', null, t('updates.checkStarted'))}>
                                <RefreshCw size={16} /> {t('updates.checkNow')}
                            </button>
                        } />

            <ProgressCard progress={progress} seenRunning={sawRunning} />

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                <UpdateCard
                    title={t('updates.panelCard')}
                    current={status.panel.current} latest={status.panel.latest}
                    releases={releases.panel} loading={relLoading} busy={busy}
                    onUpdate={(v) => run('panel', v, t('updates.panelStarted', { v }))} />

                <UpdateCard
                    title={t('updates.telemtCard')}
                    current={status.telemt.current} latest={status.telemt.latest}
                    releases={releases.telemt} loading={relLoading} busy={busy}
                    onUpdate={(v) => run('telemt', v, t('updates.telemtStarted', { v }))} />

                {/* SSL */}
                <Card title={t('updates.sslCard')}>
                    {status.ssl?.expires ? (
                        <div className="text-center py-2">
                            <ShieldCheck size={28} className="mx-auto text-emerald-500 mb-2" />
                            <div className="text-sm text-slate-500">{t('updates.validUntil')}</div>
                            <div className="font-mono">{formatDate(status.ssl.expires, lang).split(',')[0]}</div>
                            <div className={`text-sm mt-1 ${status.ssl.daysLeft < 14 ? 'text-red-500' : 'text-emerald-500'}`}>
                                {t('updates.daysLeft', { n: status.ssl.daysLeft })}
                            </div>
                            <div className="text-xs text-slate-400 mt-2">{t('updates.sslAuto')}</div>
                        </div>
                    ) : (
                        <p className="text-sm text-slate-500 py-4 text-center">{t('updates.noSsl')}</p>
                    )}
                </Card>
            </div>

            {/* Настройки автопроверки */}
            <Card title={t('updates.autoTitle')} actions={
                <button className="btn-primary !min-h-0 !px-3 !py-1.5 text-sm" onClick={saveSettings}>{t('common.save')}</button>
            }>
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                    <Field label={t('updates.fAutoCheck')}>
                        <select className="input" value={String(status.settings.auto_check)}
                                onChange={(e) => setS('auto_check', e.target.value === 'true')}>
                            <option value="true">{t('common.enabled')}</option>
                            <option value="false">{t('common.disabled')}</option>
                        </select>
                    </Field>
                    <Field label={t('updates.fFreq')}>
                        <select className="input" value={status.settings.frequency}
                                onChange={(e) => setS('frequency', e.target.value)}>
                            <option value="hourly">{t('updates.freqHourly')}</option>
                            <option value="daily">{t('updates.freqDaily')}</option>
                            <option value="weekly">{t('updates.freqWeekly')}</option>
                            <option value="monthly">{t('updates.freqMonthly')}</option>
                        </select>
                    </Field>
                    <Field label={t('updates.fChannel')}>
                        <select className="input" value={status.settings.channel}
                                onChange={(e) => setS('channel', e.target.value)}>
                            <option value="stable">stable</option>
                            <option value="beta">beta</option>
                            <option value="latest">latest</option>
                        </select>
                    </Field>
                    <Field label={t('updates.fMode')}>
                        <select className="input" value={String(status.settings.auto_install)}
                                onChange={(e) => setS('auto_install', e.target.value === 'true')}>
                            <option value="false">{t('updates.modeNotify')}</option>
                            <option value="true">{t('updates.modeAuto')}</option>
                        </select>
                    </Field>
                </div>
                <div className="mt-4 text-sm text-slate-500">
                    {t('updates.lastCheck')}: {status.last_check ? formatDate(status.last_check, lang) : '—'}
                </div>
            </Card>

            {/* История обновлений */}
            <Card title={t('updates.historyTitle')}>
                {history.length === 0 ? (
                    <p className="text-sm text-slate-500">{t('updates.historyEmpty')}</p>
                ) : (
                    <ul className="space-y-2 text-sm">
                        {history.map((h) => (
                            <li key={h.id}>
                                <details className="group">
                                    <summary className="flex items-center gap-3 cursor-pointer list-none">
                                        <span className={h.status === 'success' ? 'badge-green' : 'badge-red'}>
                                            {h.status === 'success' ? '✅' : '❌'} {h.component}
                                        </span>
                                        <span className="font-mono">{h.to_version || 'latest'}</span>
                                        <span className="text-slate-400">{formatDate(h.created_at, lang)}</span>
                                        {h.status !== 'success' && h.log && (
                                            <span className="text-xs text-red-400">{t('common.showLog')}</span>
                                        )}
                                    </summary>
                                    {h.log && (
                                        <pre className="mt-2 rounded-lg bg-slate-100 dark:bg-slate-800 p-3 text-xs font-mono overflow-x-auto max-h-60 overflow-y-auto whitespace-pre-wrap">{h.log}</pre>
                                    )}
                                </details>
                            </li>
                        ))}
                    </ul>
                )}
            </Card>
        </div>
    );
}
