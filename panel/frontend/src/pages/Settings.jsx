// Настройки панели: категории слева, поля справа, автосохранение по полю.
//
// Раньше всё редактировалось через модалку с одной кнопкой «Сохранить» на всю
// страницу: тумблер нельзя было щёлкнуть, не открыв карточку, а сохранение
// уходило одним PUT со всеми настройками сразу — с риском затереть значение.
// Теперь каждое поле сохраняется отдельно и сразу, а состояние видно в строке.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Save,
    Globe, Bell, RefreshCcw, Palette, Database, ScrollText, Satellite, Radar,
    Search, Check, Loader2, AlertCircle, SlidersHorizontal,
} from 'lucide-react';
import { get, post, put } from '../api';
import { toast, useThemeStore } from '../store';
import { ACCENTS } from '../accents';
import { useT } from '../i18n';
import { Card, Field, Toggle, Skeleton, PageHeader } from '../components/ui';
import ProtectionCard from '../components/ProtectionCard';

// Описание категорий и их полей (подписи берутся из словаря i18n)
const CATEGORIES = (t) => [
    {
        id: 'network', Icon: Globe, title: t('settings.catNetwork'),
        fields: [
            { key: 'mask_domain', label: t('settings.fMaskDomain'), hint: t('settings.fMaskHint') },
            { key: 'ad_tag_global', label: t('settings.fAdTag'), hint: t('settings.fAdTagHint') },
            { key: 'web_proxy_enabled', label: t('settings.fWebOn'), type: 'toggle' },
            { key: 'mtproto_enabled', label: t('settings.fMtprotoOn'), type: 'toggle' },
            { key: 'web_domain', label: t('settings.fWebDomain'), hint: t('settings.fWebDomainHint') },
            { key: 'mtproto_domain', label: t('settings.fMtprotoDomain'), hint: t('settings.fMtprotoDomainHint') },
        ],
    },
    {
        id: 'notify', Icon: Bell, title: t('settings.catNotify'),
        fields: [
            { key: 'tg_bot_token', label: t('settings.fTgToken'), hint: t('settings.fTgTokenHint'), secret: true },
            { key: 'tg_admin_chat_id', label: t('settings.fTgChat'), hint: t('settings.fTgChatHint') },
            { key: 'notify_disk', label: t('settings.fDisk'), type: 'toggle' },
            { key: 'notify_services', label: t('settings.fServices'), type: 'toggle' },
            { key: 'notify_new_client', label: t('settings.fNewClient'), type: 'toggle' },
            { key: 'notify_quota', label: t('settings.fQuota'), type: 'toggle' },
            { key: 'auto_renew_enabled', label: t('settings.fAutoRenew'), type: 'toggle' },
            { key: 'backup_tg_enabled', label: t('settings.fBackupTg'), type: 'toggle', backupNow: true },
        ],
    },
    {
        id: 'quotareset', Icon: RefreshCcw, title: t('settings.catQuotaReset'),
        fields: [
            { key: 'quota_reset_mode', label: t('settings.fQrMode'), type: 'select', options: [['off', t('settings.qrOff')], ['daily', t('settings.qrDaily')], ['weekly', t('settings.qrWeekly')], ['monthly', t('settings.qrMonthly')]] },
            { key: 'quota_reset_day', label: t('settings.fQrDay'), hint: t('settings.fQrDayHint'), type: 'number' },
        ],
    },
    {
        id: 'appearance', Icon: Palette, title: t('settings.catAppearance'),
        fields: [
            { key: 'brand_name', label: t('settings.fBrand') },
            { key: 'theme', label: t('settings.fTheme'), type: 'select', options: [['dark', t('settings.themeDark')], ['light', t('settings.themeLight')]] },
            { key: 'accent', label: t('settings.fAccent'), hint: t('settings.fAccentHint'), type: 'accent' },
            { key: 'language', label: t('settings.fLang'), type: 'select', options: [['ru', 'Русский'], ['en', 'English']] },
        ],
    },
    {
        id: 'backup', Icon: Database, title: t('settings.catBackup'),
        fields: [
            { key: 'backup_auto', label: t('settings.fBackupAuto'), type: 'toggle' },
            { key: 'backup_keep_days', label: t('settings.fBackupKeep'), type: 'number' },
        ],
    },
    {
        id: 'logs', Icon: ScrollText, title: t('settings.catLogs'),
        fields: [
            { key: 'logs_keep_days', label: t('settings.fLogsKeep'), hint: t('settings.fLogsKeepHint'), type: 'number' },
        ],
    },
    {
        id: 'dc', Icon: Satellite, title: t('settings.catDc'),
        fields: [
            { key: 'dc_monitor_enabled', label: t('settings.fDcMonitor'), type: 'toggle' },
            { key: 'dc_coverage_threshold', label: t('settings.fDcThreshold'), hint: t('settings.fDcThresholdHint'), type: 'number' },
            { key: 'dc_auto_restart', label: t('settings.fDcRestart'), hint: t('settings.fDcRestartHint'), type: 'toggle' },
            { key: 'dc_cooldown_min', label: t('settings.fDcCooldown'), hint: t('settings.fDcCooldownHint'), type: 'number' },
        ],
    },
    {
        id: 'avail', Icon: Radar, title: t('settings.catAvail'),
        fields: [
            { key: 'avail_enabled', label: t('settings.fAvailMonitor'), type: 'toggle' },
            { key: 'avail_interval_min', label: t('settings.fAvailInterval'), hint: t('settings.fAvailIntervalHint'), type: 'number' },
            { key: 'avail_probes', label: t('settings.fAvailProbes'), hint: t('settings.fAvailProbesHint'), type: 'number' },
            { key: 'avail_threshold', label: t('settings.fAvailThreshold'), hint: t('settings.fAvailThresholdHint'), type: 'number' },
            { key: 'avail_target', label: t('settings.fAvailTarget'), hint: t('settings.fAvailTargetHint') },
            { key: 'avail_port', label: t('settings.fAvailPort'), hint: t('settings.fAvailPortHint'), type: 'number' },
            { key: 'avail_token', label: t('settings.fAvailToken'), hint: t('settings.fAvailTokenHint'), secret: true },
        ],
    },
];

/** Состояние сохранения одного поля: idle | saving | ok | error */
const useFieldSave = () => {
    const [state, setState] = useState({}); // key -> { status, error }
    const mark = (key, patch) => setState((s) => ({ ...s, [key]: { status: 'ok', error: null, ...patch } }));

    const save = async (key, value, request) => {
        mark(key, { status: 'saving' });
        try {
            await request();
            mark(key, { status: 'ok' });
            setTimeout(() => setState((s) => {
                const cur = s[key];
                if (!cur || cur.status !== 'ok') return s;
                const next = { ...s };
                delete next[key];
                return next;
            }), 1600);
        } catch (e) {
            mark(key, { status: 'error', error: e.message });
            toast.error(e.message);
        }
    };
    return { state, save, mark };
};

export default function Settings() {
    const [settings, setSettings] = useState(null);
    const [initial, setInitial] = useState(null);
    const [active, setActive] = useState('network');
    const [query, setQuery] = useState('');
    const [onlyChanged, setOnlyChanged] = useState(false);
    const [highlight, setHighlight] = useState(null);
    const { state, save } = useFieldSave();
    const t = useT();
    const cats = useMemo(() => CATEGORIES(t), [t]);
    const accent = useThemeStore((s) => s.accent);
    const setAccent = useThemeStore((s) => s.setAccent);

    useEffect(() => {
        get('/settings')
            .then((d) => { setSettings(d.settings); setInitial(d.settings); })
            .catch((e) => toast.error(e.message));
    }, []);

    const setValue = (key, value) => setSettings((s) => ({ ...s, [key]: value }));

    /** Сохраняет одно поле — запрос уходит с единственным ключом. */
    const commit = (key, value) => save(key, value, () => put('/settings', { [key]: value }));

    const revert = (key) => {
        setValue(key, initial[key]);
        save(key, initial[key], () => put('/settings', { [key]: initial[key] }));
    };

    const isChanged = (key) => initial && settings
        && JSON.stringify(settings[key]) !== JSON.stringify(initial[key]);

    const changedCount = settings && initial
        ? cats.reduce((n, c) => n + c.fields.filter((f) => isChanged(f.key)).length, 0)
        : 0;

    const changedIn = (cat) => cat.fields.filter((f) => isChanged(f.key)).length;

    // Поиск по всем категориям сразу
    const results = useMemo(() => {
        const q = query.trim().toLowerCase();
        if (!q) return null;
        const out = [];
        for (const cat of cats) {
            // Совпадение с названием категории показывает её целиком
            const byTitle = String(cat.title).toLowerCase().includes(q);
            const hits = byTitle ? cat.fields : cat.fields.filter((f) => {
                const label = String(f.label).toLowerCase();
                const value = String(f.key === 'accent' ? t(`settings.accent_${accent}`) : settings?.[f.key] ?? '').toLowerCase();
                return label.includes(q) || f.key.toLowerCase().includes(q) || value.includes(q);
            });
            if (hits.length) out.push({ cat, hits });
        }
        return out;
    }, [query, cats, settings, accent, t]);

    const visibleFields = (cat) => {
        let fields = cat.fields;
        if (query.trim()) {
            const group = results?.find((r) => r.cat.id === cat.id);
            fields = group ? group.hits : [];
        }
        if (onlyChanged) fields = fields.filter((f) => isChanged(f.key));
        return fields;
    };

    const jumpTo = (catId, key) => {
        setActive(catId);
        setQuery('');
        setTimeout(() => setHighlight(key), 30);
        setTimeout(() => setHighlight(null), 2200);
    };

    if (!settings || !initial) {
        return <div className="space-y-4">{[...Array(3)].map((_, i) => <Skeleton key={i} className="h-48" />)}</div>;
    }

    const activeCat = cats.find((c) => c.id === active) || cats[0];
    const activeFields = visibleFields(activeCat);

    return (
        <div className="space-y-4">
            <PageHeader icon={<SlidersHorizontal size={20} />} title={t('settings.title')}
                        subtitle={t('settings.subtitle')} />

            {/* Поиск и счётчик изменённых */}
            <Card className="!p-3">
                <div className="flex flex-wrap items-center gap-3">
                    <div className="relative flex-1 min-w-[220px]">
                        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                        <input className="input !pl-9" value={query} placeholder={t('settings.searchPlaceholder')}
                               onChange={(e) => setQuery(e.target.value)} />
                    </div>
                    <button onClick={() => setOnlyChanged((v) => !v)}
                            className={`btn-secondary !min-h-0 !py-2 text-sm ${onlyChanged ? 'ring-1 ring-primary text-primary' : ''}`}>
                        <SlidersHorizontal size={15} /> {t('settings.onlyChanged')}
                    </button>
                    {changedCount > 0 && (
                        <span className="text-sm text-amber-500 whitespace-nowrap">
                            {t('settings.changedCount', { n: changedCount })}
                        </span>
                    )}
                </div>

                {results && (
                    <div className="mt-3 border-t border-slate-100 dark:border-slate-800 pt-3 space-y-2">
                        {results.length === 0 ? (
                            <p className="text-sm text-slate-500 py-2">{t('settings.searchEmpty')}</p>
                        ) : results.map(({ cat, hits }) => (
                            <div key={cat.id}>
                                <p className="text-xs font-medium text-slate-400 mb-1">{cat.title}</p>
                                {hits.map((f) => (
                                    <button key={f.key} onClick={() => jumpTo(cat.id, f.key)}
                                            className="w-full text-left text-sm px-2 py-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 flex items-baseline justify-between gap-3">
                                        <span>{f.label}</span>
                                        <span className="text-xs text-slate-400 truncate max-w-[50%]">
                                            {f.key === 'accent' ? t(`settings.accent_${accent}`) : String(settings[f.key] ?? '—')}
                                        </span>
                                    </button>
                                ))}
                            </div>
                        ))}
                    </div>
                )}
            </Card>

            <div className="grid grid-cols-1 lg:grid-cols-[240px_1fr] gap-4 items-start">
                {/* Категории */}
                <nav className="flex lg:flex-col gap-1 overflow-x-auto pb-1 lg:pb-0 lg:sticky lg:top-4">
                    {cats.map((cat) => {
                        const Icon = cat.Icon;
                        const n = changedIn(cat);
                        const on = cat.id === active;
                        return (
                            <button key={cat.id} onClick={() => setActive(cat.id)}
                                    className={`flex items-center gap-2.5 whitespace-nowrap rounded-xl px-3 py-2.5 text-sm transition-colors shrink-0
                                        ${on ? 'bg-primary/10 text-primary ring-1 ring-primary/30'
                                              : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'}`}>
                                <Icon size={17} className="shrink-0" />
                                <span className="truncate">{cat.title}</span>
                                {n > 0 && (
                                    <span className="ml-auto shrink-0 rounded-full bg-amber-500/15 text-amber-600 dark:text-amber-400 px-1.5 text-[11px] font-semibold">
                                        {n}
                                    </span>
                                )}
                            </button>
                        );
                    })}
                </nav>

                {/* Поля активной категории */}
                <div className="space-y-3">
                    <Card title={activeCat.title} subtitle={t('settings.autoSaveHint')}>
                        {activeFields.length === 0 ? (
                            <p className="text-sm text-slate-500 py-4">{t('settings.noFields')}</p>
                        ) : (
                            <div className="space-y-4">
                                {activeFields.map((f) => (
                                    <SettingField key={f.key} f={f}
                                                  settings={settings} setValue={setValue}
                                                  commit={commit} revert={revert}
                                                  changed={isChanged(f.key)}
                                                  status={state[f.key]?.status}
                                                  error={state[f.key]?.error}
                                                  highlight={highlight === f.key}
                                                  accent={accent} setAccent={setAccent} />
                                ))}
                            </div>
                        )}
                    </Card>
                </div>
            </div>

            {/* Защита и отказоустойчивость */}
            <div className="pt-2 space-y-3">
                <ProtectionCard />
            </div>

            {/* Опасная зона */}
            <div className="pt-2 space-y-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-red-500">{t('settings.dangerZone')}</p>
                <p className="text-xs text-slate-500 -mt-1">{t('settings.dangerZoneHint')}</p>
                <DomainCard />
                <WebDomainCard />
                <WebProfilesLimitCard />
                <BackupCard />
            </div>
        </div>
    );
}

/** Карточка лимита WEB-профилей Telemt (сколько клиентов с Web Proxy). */
function WebProfilesLimitCard() {
    const [panel, setPanel] = useState('');
    const [engine, setEngine] = useState(null);
    const [busy, setBusy] = useState(false);
    const t = useT();

    useEffect(() => {
        get('/settings/web-profile-limit')
            .then((d) => { setPanel(String(d.panel ?? '')); setEngine(d.engine); })
            .catch((e) => toast.error(e.message));
    }, []);

    const apply = async () => {
        const v = Number(panel);
        if (!Number.isInteger(v) || v < 1) { toast.error(t('settings.wplBad')); return; }
        setBusy(true);
        try {
            const r = await post('/settings/web-profile-limit', { limit: v });
            toast.success(r.message || t('settings.wplDone', { v }));
            setPanel(String(v));
            get('/settings/web-profile-limit').then((d) => setEngine(d.engine)).catch(() => {});
        } catch (e) {
            toast.error(e.message);
        } finally {
            setBusy(false);
        }
    };

    return (
        <Card title={t('settings.wplTitle')} subtitle={t('settings.wplSubtitle')}>
            <div className="flex flex-wrap items-end gap-3">
                <label className="block">
                    <span className="text-xs text-slate-500 dark:text-slate-400 block mb-1">{t('settings.wplField')}</span>
                    <input type="number" min="1" value={panel}
                           onChange={(e) => setPanel(e.target.value)}
                           className="w-32 px-3 py-2 rounded-lg bg-slate-500/10 border border-slate-500/30 focus:border-indigo-500 outline-none" />
                </label>
                <button className="btn-primary" onClick={apply} disabled={busy || !panel}>
                    {busy ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                    {t('settings.wplApply')}
                </button>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-3">
                {t('settings.wplHint')}
                {engine !== null && (
                    <span className="block mt-1">
                        {t('settings.wplEngine', { v: engine })}
                    </span>
                )}
            </p>
        </Card>
    );
}

/** Одно поле настройки: переключатель, выбор, число, текст или акцент. */
function SettingField({ f, settings, setValue, commit, revert, changed, status, error, highlight, accent, setAccent }) {
    const t = useT();
    const value = settings[f.key];

    const statusIcon = () => {
        if (status === 'saving') return <Loader2 size={14} className="animate-spin text-slate-400" />;
        if (status === 'error') return (
            <span className="inline-flex items-center gap-1 text-red-500" title={error}>
                <AlertCircle size={14} /> <button onClick={() => revert(f.key)} className="underline">{t('settings.retry')}</button>
            </span>
        );
        if (status === 'ok') return <Check size={14} className="text-emerald-500" />;
        if (changed) return (
            <button onClick={() => revert(f.key)} title={t('settings.revert')}
                    className="inline-flex items-center gap-1 text-amber-500 hover:text-amber-400">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-500" /> {t('settings.revert')}
            </button>
        );
        return null;
    };

    const onBlur = () => {
        if (changed) commit(f.key, value);
    };

    let control;
    if (f.type === 'toggle') {
        control = (
            <Toggle label={f.label} checked={!!value}
                    onChange={(v) => { setValue(f.key, v); commit(f.key, v); }} />
        );
    } else if (f.type === 'select') {
        control = (
            <select className="input" value={value ?? ''}
                    onChange={(e) => { setValue(f.key, e.target.value); commit(f.key, e.target.value); }}>
                {f.options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
        );
    } else if (f.type === 'accent') {
        control = (
            <div className="flex flex-wrap gap-2">
                {ACCENTS.map((a) => {
                    const on = accent === a.id;
                    return (
                        <button key={a.id} type="button" title={t(`settings.accent_${a.id}`)}
                                onClick={() => { setAccent(a.id); commit(f.key, a.id); }}
                                className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-sm transition-all
                                    ${on ? 'border-primary bg-primary/10 text-primary shadow-sm shadow-primary/20'
                                         : 'border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600'}`}>
                            <span className="w-5 h-5 rounded-full shrink-0 ring-1 ring-black/10" style={{ backgroundColor: a.swatch }} />
                            {t(`settings.accent_${a.id}`)}
                        </button>
                    );
                })}
            </div>
        );
    } else {
        control = (
            <input className="input" type={f.type === 'number' ? 'number' : 'text'}
                   value={value ?? ''}
                   placeholder={f.secret ? '••••••' : ''}
                   onChange={(e) => setValue(f.key, f.type === 'number' ? Number(e.target.value) : e.target.value)}
                   onBlur={onBlur}
                   onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }} />
        );
    }

    return (
        <div className={`rounded-xl px-3 py-3 -mx-3 transition-colors
                        ${highlight ? 'bg-primary/5 ring-1 ring-primary/30' : ''}`}>
            <div className="flex items-start justify-between gap-3 mb-1.5">
                {!f.type && <span className="text-sm font-medium shrink-0">{f.label}</span>}
                <div className="ml-auto shrink-0">{statusIcon()}</div>
            </div>
            {f.type === 'accent' && <span className="block text-sm font-medium mb-1.5">{f.label}</span>}
            {control}
            {f.hint && <span className="block text-xs text-slate-500 mt-1">{f.hint}</span>}
            {f.backupNow && (
                <button className="btn-secondary !min-h-0 !py-1.5 text-xs mt-2"
                        onClick={async () => {
                            if (!settings[f.key]) return toast.error(t('settings.enableFirst'));
                            try {
                                const r = await post('/bot/backup-tg', {});
                                toast.success(t('settings.backupSent', { f: r.filename }));
                            } catch (e) { toast.error(e.message); }
                        }}>
                    {t('settings.sendBackupNow')}
                </button>
            )}
        </div>
    );
}


/** Карточка бэкапа: скачать все данные / восстановить из файла */
function BackupCard() {
    const [restoring, setRestoring] = useState(false);
    const fileRef = useRef(null);
    const t = useT();

    const download = () => {
        const token = sessionStorage.getItem('tggate_token');
        const a = document.createElement('a');
        a.href = `/api/backup/export?token=${encodeURIComponent(token || '')}`;
        a.download = '';
        document.body.appendChild(a);
        a.click();
        a.remove();
        toast.success(t('settings.bkDownloading'));
    };

    const restore = async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        if (!confirm(t('settings.bkConfirm', { f: file.name }))) {
            e.target.value = '';
            return;
        }
        setRestoring(true);
        try {
            const text = await file.text();
            const res = await fetch('/api/backup/restore', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Requested-With': 'XMLHttpRequest',
                    Authorization: `Bearer ${sessionStorage.getItem('tggate_token')}`,
                },
                body: text,
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data.error || t('settings.bkError', { s: res.status }));
            toast.success(t('settings.bkDone'));
        } catch (err) {
            toast.error(t('settings.bkFail', { e: err.message }));
        } finally {
            setRestoring(false);
            if (fileRef.current) fileRef.current.value = '';
        }
    };

    return (
        <Card title={t('settings.bkTitle')}
              subtitle={t('settings.bkSub')}>
            <div className="flex flex-wrap gap-2">
                <button className="btn-secondary" onClick={download}>
                    {t('settings.bkDownload')}
                </button>
                <label className="btn-secondary cursor-pointer">
                    {t('settings.bkRestore')}
                    <input ref={fileRef} type="file" accept=".json,application/json"
                           className="hidden" onChange={restore} disabled={restoring} />
                </label>
                {restoring && <span className="text-sm text-slate-500 self-center">{t('settings.bkRestoring')}</span>}
            </div>
            <p className="text-xs text-slate-400 mt-3">
                {t('settings.bkNote')}
            </p>
        </Card>
    );
}

/** Карточка смены домена: новый домен через Helper без переустановки панели */
function DomainCard() {
    const [info, setInfo] = useState(null);
    const [newDomain, setNewDomain] = useState('');
    const [force, setForce] = useState(false);
    const [busy, setBusy] = useState(false);
    const [changed, setChanged] = useState(false);
    const t = useT();

    useEffect(() => {
        get('/settings/domain').then(setInfo).catch(() => {});
    }, []);

    const changeDomain = async () => {
        const d = newDomain.trim().toLowerCase();
        if (!confirm(t('settings.dmConfirm', { from: info?.domain, to: d }))) return;
        setBusy(true);
        try {
            await post('/settings/domain', { domain: d, force });
            toast.success(t('settings.dmStarted'));
            setChanged(true);
            // Панель перезапустится: через 20 сек пробуем перезагрузить страницу
            setTimeout(() => window.location.reload(), 20000);
        } catch (e) {
            toast.error(e.message);
        } finally {
            setBusy(false);
        }
    };

    const notifyClients = async () => {
        if (!confirm(t('settings.dmNotifyConfirm'))) return;
        setBusy(true);
        try {
            const r = await post('/settings/domain/notify', {});
            toast.success(t('settings.dmSent', { s: r.sent, tot: r.total, f: r.failed }));
        } catch (e) {
            toast.error(e.message);
        } finally {
            setBusy(false);
        }
    };

    return (
        <Card title={t('settings.dmTitle')}
              subtitle={t('settings.dmCur', { d: info?.domain ?? '...' })}>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-end">
                <Field label={t('settings.fNewDomain')}
                       hint={t('settings.fNewDomainHint')}>
                    <input className="input font-mono" placeholder="proxy2.example.com"
                           value={newDomain}
                           onChange={(e) => setNewDomain(e.target.value)} />
                </Field>
                <div className="space-y-3">
                    <Toggle label={t('settings.tForce')}
                            checked={force}
                            onChange={setForce} />
                    <button className="btn-primary w-full" disabled={busy || !newDomain.trim()} onClick={changeDomain}>
                        {t('settings.changeDomain')}
                    </button>
                </div>
            </div>

            {/* Рассылка новых ссылок — доступна всегда (после смены домена и не только) */}
            <div className="mt-4 p-3 rounded-lg bg-slate-50 dark:bg-slate-800/50 flex flex-wrap items-center justify-between gap-3">
                <p className="text-sm text-slate-500">
                    {t('settings.dmNote')}
                </p>
                <button className="btn-secondary whitespace-nowrap text-sm" disabled={busy} onClick={notifyClients}>
                    {t('settings.dmNotifyBtn')}
                </button>
            </div>

            {changed && (
                <div className="mt-3 p-3 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800">
                    <p className="text-sm">
                        {t('settings.dmRestarting')}
                    </p>
                </div>
            )}
        </Card>
    );
}

/** Карточка отдельного домена Web Proxy (для прятанья за Cloudflare) */
function WebDomainCard() {
    const [domain, setDomain] = useState('');
    const [current, setCurrent] = useState(null);
    const [force, setForce] = useState(false);
    const [busy, setBusy] = useState(false);
    const t = useT();

    useEffect(() => {
        get('/settings').then((d) => setCurrent(d.settings?.web_domain ?? null)).catch(() => {});
    }, []);

    const apply = async () => {
        const d = domain.trim().toLowerCase();
        if (!confirm(t('settings.wdConfirm', { d: d || t('settings.wdDisable') }))) return;
        setBusy(true);
        try {
            const r = await post('/settings/web-domain', { domain: d, force });
            toast.success(r.message || t('settings.wdDone'));
            setCurrent(d || null);
            setDomain('');
        } catch (e) {
            toast.error(e.message);
        } finally {
            setBusy(false);
        }
    };

    return (
        <Card title={t('settings.wdTitle')}
              subtitle={t('settings.wdCur', { d: current || t('settings.wdNone') })}>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-end">
                <Field label={t('settings.fWebDomain')}
                       hint={t('settings.wdHint')}>
                    <input className="input font-mono" placeholder="web.example.com"
                           value={domain}
                           onChange={(e) => setDomain(e.target.value)} />
                </Field>
                <div className="space-y-3">
                    <Toggle label={t('settings.tForce')}
                            checked={force}
                            onChange={setForce} />
                    <div className="flex gap-2">
                        <button className="btn-primary flex-1" disabled={busy || !domain.trim()} onClick={apply}>
                            {t('settings.wdApply')}
                        </button>
                        {current && (
                            <button className="btn-secondary" disabled={busy}
                                    onClick={() => { setDomain(''); setTimeout(apply, 50); }}>
                                {t('settings.wdDisable')}
                            </button>
                        )}
                    </div>
                </div>
            </div>
            <p className="text-xs text-slate-400 mt-3">
                {t('settings.wdNote')}
            </p>
        </Card>
    );
}
