// Настройки панели с категориями
import React, { useEffect, useRef, useState } from 'react';
import { Save, Pencil, Settings as SettingsIcon } from 'lucide-react';
import { get, post, put } from '../api';
import { toast, useThemeStore } from '../store';
import { ACCENTS } from '../accents';
import { useT } from '../i18n';
import { Card, Field, Toggle, Skeleton, Modal, PageHeader } from '../components/ui';

// Описание категорий и их полей (подписи берутся из словаря i18n)
const CATEGORIES = (t) => [
    {
        id: 'network', icon: '🌐', title: t('settings.catNetwork'),
        fields: [
            { key: 'mask_domain', label: t('settings.fMaskDomain'), hint: t('settings.fMaskHint') },
            { key: 'ad_tag_global', label: t('settings.fAdTag'), hint: t('settings.fAdTagHint') },
            { key: 'web_proxy_enabled', label: t('settings.fWebOn'), type: 'toggle' },
            { key: 'mtproto_enabled', label: t('settings.fMtprotoOn'), type: 'toggle' },
        ],
    },
    {
        id: 'notify', icon: '🔔', title: t('settings.catNotify'),
        fields: [
            { key: 'tg_bot_token', label: t('settings.fTgToken'), hint: t('settings.fTgTokenHint') },
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
        id: 'appearance', icon: '🎨', title: t('settings.catAppearance'),
        fields: [
            { key: 'brand_name', label: t('settings.fBrand') },
            { key: 'theme', label: t('settings.fTheme'), type: 'select', options: [['dark', t('settings.themeDark')], ['light', t('settings.themeLight')]] },
            { key: 'accent', label: t('settings.fAccent'), hint: t('settings.fAccentHint'), type: 'accent' },
            { key: 'language', label: t('settings.fLang'), type: 'select', options: [['ru', 'Русский'], ['en', 'English']] },
        ],
    },
    {
        id: 'backup', icon: '📊', title: t('settings.catBackup'),
        fields: [
            { key: 'backup_auto', label: t('settings.fBackupAuto'), type: 'toggle' },
            { key: 'backup_keep_days', label: t('settings.fBackupKeep'), type: 'number' },
        ],
    },
];

export default function Settings() {
    const [settings, setSettings] = useState(null);
    const [saving, setSaving] = useState(false);
    const [editingCat, setEditingCat] = useState(null); // id категории в модалке
    const t = useT();
    const cats = CATEGORIES(t);
    const accent = useThemeStore((s) => s.accent);
    const setAccent = useThemeStore((s) => s.setAccent);

    useEffect(() => {
        get('/settings').then((d) => setSettings(d.settings)).catch((e) => toast.error(e.message));
    }, []);

    const setValue = (key, value) => setSettings((s) => ({ ...s, [key]: value }));

    const save = async () => {
        setSaving(true);
        try {
            await put('/settings', settings);
            toast.success(t('settings.saved'));
        } catch (e) {
            toast.error(e.message);
        } finally {
            setSaving(false);
        }
    };

    // Отображение текущего значения поля в сводке
    const displayValue = (f) => {
        if (f.type === 'accent') return t(`settings.accent_${accent}`);
        const v = settings[f.key];
        if (f.type === 'toggle') return v ? t('bot.yes') : t('bot.no');
        if (f.type === 'select') {
            const opt = (f.options || []).find(([ov]) => String(ov) === String(v ?? ''));
            return (opt && opt[1]) || v || '—';
        }
        if (f.type === 'number') return v ?? '—';
        const s = String(v ?? '');
        return s === '' ? '—' : (s.length > 80 ? `${s.slice(0, 80)}…` : s);
    };

    // Форма редактирования категории (в модалке)
    const renderCatFields = (cat) => (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {cat.fields.map((f) => {
                if (f.type === 'toggle') {
                    return (
                        <div key={f.key}>
                            <Toggle label={f.label}
                                    checked={!!settings[f.key]}
                                    onChange={(v) => setValue(f.key, v)} />
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
                if (f.type === 'select') {
                    return (
                        <Field key={f.key} label={f.label} hint={f.hint}>
                            <select className="input" value={settings[f.key] ?? ''}
                                    onChange={(e) => setValue(f.key, e.target.value)}>
                                {f.options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                            </select>
                        </Field>
                    );
                }
                if (f.type === 'accent') {
                    return (
                        <div key={f.key} className="md:col-span-2">
                            <span className="block text-sm font-medium mb-1.5">{f.label}</span>
                            {f.hint && <span className="block text-xs text-slate-500 mt-0 mb-2">{f.hint}</span>}
                            <div className="flex flex-wrap gap-2">
                                {ACCENTS.map((a) => {
                                    const active = accent === a.id;
                                    return (
                                        <button key={a.id} type="button"
                                                title={t(`settings.accent_${a.id}`)}
                                                onClick={() => setAccent(a.id)}
                                                className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-sm transition-all
                                                    ${active
                                                        ? 'border-primary bg-primary/10 text-primary shadow-sm shadow-primary/20'
                                                        : 'border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600'}`}>
                                            <span className="w-5 h-5 rounded-full shrink-0 ring-1 ring-black/10"
                                                  style={{ backgroundColor: a.swatch }} />
                                            {t(`settings.accent_${a.id}`)}
                                        </button>
                                    );
                                })}
                            </div>
                        </div>
                    );
                }
                return (
                    <Field key={f.key} label={f.label} hint={f.hint}>
                        <input className="input"
                               type={f.type === 'number' ? 'number' : 'text'}
                               value={settings[f.key] ?? ''}
                               onChange={(e) => setValue(f.key, f.type === 'number' ? Number(e.target.value) : e.target.value)} />
                    </Field>
                );
            })}
        </div>
    );

    if (!settings) return <div className="space-y-4">{[...Array(3)].map((_, i) => <Skeleton key={i} className="h-48" />)}</div>;

    return (
        <div className="space-y-6">
            <PageHeader icon={<SettingsIcon size={20} />} title={t('settings.title')}
                        subtitle={t('settings.subtitle')} />


            {/* Смена домена без переустановки */}
            <DomainCard />

            {cats.map((cat) => (
                <Card key={cat.id} title={`${cat.icon} ${cat.title}`} actions={
                    <button className="btn-ghost !min-h-0 !p-2" title={t('common.edit')}
                            onClick={() => setEditingCat(cat.id)}>
                        <Pencil size={16} />
                    </button>
                }>
                    <div>
                        {cat.fields.map((f) => (
                            <div key={f.key} className="flex flex-wrap items-baseline justify-between gap-2 py-1.5 border-b border-slate-100 dark:border-slate-800/60 last:border-0">
                                <span className="text-sm text-slate-500 dark:text-slate-400">{f.label}</span>
                                <span className="text-sm font-medium text-right break-all max-w-[60%]">{displayValue(f)}</span>
                            </div>
                        ))}
                    </div>
                </Card>
            ))}

            {/* Модал редактирования категории */}
            <Modal open={!!editingCat} onClose={() => setEditingCat(null)} wide
                   title={(() => { const c = cats.find((x) => x.id === editingCat); return c ? `${c.icon} ${c.title}` : ''; })()}>
                {(() => { const c = cats.find((x) => x.id === editingCat); return c ? renderCatFields(c) : null; })()}
                <div className="flex justify-end gap-2 mt-4">
                    <button className="btn-secondary" onClick={() => setEditingCat(null)}>{t('common.cancel')}</button>
                    <button className="btn-primary" disabled={saving}
                            onClick={async () => { await save(); setEditingCat(null); }}>
                        <Save size={14} /> {saving ? t('common.saving') : t('common.save')}
                    </button>
                </div>
            </Modal>

            {/* Резервное копирование: экспорт/импорт всех данных */}
            <BackupCard />
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
