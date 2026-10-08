// Управление клиентами: таблица, поиск, создание/редактирование, действия
import React, { useEffect, useMemo, useState } from 'react';
import { Plus, Search, Copy, QrCode, Power, Trash2, Pencil, CalendarPlus, KeyRound, Eraser, Download, Users } from 'lucide-react';
import { get, post, patch, del } from '../api';
import { toast, useLangStore } from '../store';
import { useT } from '../i18n';
import { Card, StatusBadge, ProgressBar, Modal, Field, Toggle, formatBytes, formatDate, Skeleton, PageHeader, Avatar, ProtoBadge } from '../components/ui';

// Пустая форма клиента
const EMPTY_FORM = {
    username: '', quota_gb: '', expires_at: '', max_ips: '',
    rate_down_mbps: '', rate_up_mbps: '', ad_tag: '',
    web_enabled: true, mtproto_enabled: true, note: '',
    quota_auto_reset: false,
};

/** Переводит значения формы в тело API-запроса */
function formToPayload(f) {
    return {
        username: f.username.trim(),
        quota_bytes: f.quota_gb ? Math.round(parseFloat(f.quota_gb) * 1024 ** 3) : null,
        expires_at: f.expires_at ? new Date(f.expires_at).toISOString() : null,
        max_ips: f.max_ips ? parseInt(f.max_ips, 10) : null,
        rate_down_bps: f.rate_down_mbps ? Math.round(parseFloat(f.rate_down_mbps) * 1_000_000) : null,
        rate_up_bps: f.rate_up_mbps ? Math.round(parseFloat(f.rate_up_mbps) * 1_000_000) : null,
        ad_tag: f.ad_tag || null,
        web_enabled: f.web_enabled,
        mtproto_enabled: f.mtproto_enabled,
        note: f.note || null,
        quota_auto_reset: !!f.quota_auto_reset,
    };
}

/** Копирование текста в буфер с уведомлением */
async function copyText(text, t) {
    try {
        await navigator.clipboard.writeText(text);
        toast.success(t('clients.copied'));
    } catch {
        toast.error(t('clients.copyFailed'));
    }
}

export default function Clients() {
    const [clients, setClients] = useState(null);
    const [search, setSearch] = useState('');
    const [statusFilter, setStatusFilter] = useState('');
    const [modal, setModal] = useState(null); // null | 'create' | client-объект
    const [selected, setSelected] = useState([]);
    const [bulkBusy, setBulkBusy] = useState(false);
    const [qrClient, setQrClient] = useState(null);
    const [connClient, setConnClient] = useState(null); // просмотр подключений клиента
    const [activeMap, setActiveMap] = useState({}); // username -> подключения[]
    const [form, setForm] = useState(EMPTY_FORM);
    const [saving, setSaving] = useState(false);
    const lang = useLangStore((s) => s.lang);
    const t = useT();

    const load = () => {
        const params = new URLSearchParams();
        if (search) params.set('search', search);
        if (statusFilter) params.set('status', statusFilter);
        params.set('limit', '200'); // максимум бэкенда; при >200 покажем уведомление
        get(`/clients?${params}`).then((d) => {
            if (d.total > d.clients.length) {
                toast.info(t('clients.shownOf', { shown: d.clients.length, total: d.total }));
            }
            setClients(d.clients);
        }).catch((e) => toast.error(e.message));
    };

    // Поиск с debounce 300 мс
    useEffect(() => {
        const t = setTimeout(load, 300);
        return () => clearTimeout(t);
    }, [search, statusFilter]);

    // Активные подключения (кто онлайн, IP, страна) — каждые 5 секунд
    useEffect(() => {
        const loadActive = () => get('/stats/active').then((d) => {
            const map = {};
            for (const c of d.connections || []) {
                (map[c.username] = map[c.username] || []).push(c);
            }
            setActiveMap(map);
        }).catch(() => {});
        loadActive();
        const timer = setInterval(loadActive, 5000);
        return () => clearInterval(timer);
    }, []);

    const openCreate = () => { setForm(EMPTY_FORM); setModal('create'); };
    const openEdit = (c) => {
        setForm({
            username: c.username,
            quota_gb: c.quota_bytes ? (c.quota_bytes / 1024 ** 3).toFixed(2) : '',
            expires_at: c.expires_at ? c.expires_at.slice(0, 10) : '',
            max_ips: c.max_ips ?? '',
            rate_down_mbps: c.rate_down_bps ? c.rate_down_bps / 1e6 : '',
            rate_up_mbps: c.rate_up_bps ? c.rate_up_bps / 1e6 : '',
            ad_tag: c.ad_tag ?? '',
            web_enabled: !!c.web_enabled,
            mtproto_enabled: !!c.mtproto_enabled,
            note: c.note ?? '',
            quota_auto_reset: c.quota_auto_reset !== 0,
        });
        setModal(c);
    };

    const save = async () => {
        setSaving(true);
        try {
            if (modal === 'create') {
                await post('/clients', formToPayload(form));
                toast.success(t('clients.created'));
            } else {
                const payload = formToPayload(form);
                delete payload.username; // логин менять нельзя
                await patch(`/clients/${modal.id}`, payload);
                toast.success(t('clients.updated'));
            }
            setModal(null);
            load();
        } catch (e) {
            toast.error(e.message);
        } finally {
            setSaving(false);
        }
    };

    const doAction = async (client, action, confirmText) => {
        if (confirmText && !confirm(confirmText)) return;
        try {
            await post(`/clients/${client.id}/${action}`);
            toast.success(t('common.done'));
            load();
        } catch (e) {
            toast.error(e.message);
        }
    };

    const remove = async (client) => {
        if (!confirm(t('clients.confirmRemove', { username: client.username }))) return;
        try {
            await del(`/clients/${client.id}`);
            toast.success(t('clients.removed'));
            load();
        } catch (e) {
            toast.error(e.message);
        }
    };

    const extend = async (client) => {
        const days = prompt(t('clients.extendPrompt', { username: client.username }), '30');
        if (!days) return;
        try {
            await post(`/clients/${client.id}/extend`, { days: parseInt(days, 10) });
            toast.success(t('clients.extended'));
            load();
        } catch (e) {
            toast.error(e.message);
        }
    };

    const toggleSelect = (id) => {
        setSelected((s) => s.includes(id) ? s.filter((x) => x !== id) : [...s, id]);
    };

    const bulkActionLabel = (action) => action === 'renew' ? t('clients.bulkRenew')
        : action === 'unblock' ? t('clients.bulkUnblock') : t('clients.bulkBlock');

    const bulk = async (action) => {
        let days;
        if (action === 'renew') {
            days = parseInt(prompt(t('clients.bulkDays'), '30'), 10);
            if (!days || days < 1) return;
        }
        if (action !== 'renew' && !confirm(t('clients.bulkConfirm', { n: selected.length, action: bulkActionLabel(action) }))) return;
        setBulkBusy(true);
        try {
            const r = await post('/clients/bulk', { ids: selected, action, days });
            toast.success(t('clients.bulkDone', { done: r.processed, total: r.total }));
            setSelected([]);
            load();
        } catch (e) {
            toast.error(e.message);
        } finally {
            setBulkBusy(false);
        }
    };

    return (
        <div className="space-y-4">
            <PageHeader icon={<Users size={20} />} title={t('clients.title')}
                        subtitle={t('clients.subtitle')}
                        actions={<>
                            <a href={`/api/clients/export/csv?token=${sessionStorage.getItem('tggate_token')}`} className="btn-secondary" download>
                                <Download size={16} /> {t('clients.exportCsv')}
                            </a>
                            <button onClick={openCreate} className="btn-primary">
                                <Plus size={16} /> {t('clients.create')}
                            </button>
                        </>} />

            {/* Поиск и фильтры */}
            <Card>
                <div className="flex flex-wrap gap-3">
                    <div className="relative flex-1 min-w-[220px]">
                        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                        <input
                            className="input !pl-9"
                            placeholder={t('clients.searchPh')}
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                        />
                    </div>
                    <select className="input !w-auto" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
                        <option value="">{t('clients.statusAll')}</option>
                        <option value="active">{t('clients.statusActive')}</option>
                        <option value="blocked">{t('clients.statusBlocked')}</option>
                        <option value="expired">{t('clients.statusExpired')}</option>
                    </select>
                </div>
            </Card>

            {/* Таблица */}
            <Card className="!p-0 overflow-x-auto">
                {selected.length > 0 && (
                    <div className="flex flex-wrap items-center gap-2 p-3 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50">
                        <span className="text-sm font-medium">{t('clients.selected', { n: selected.length })}</span>
                        <button className="btn-secondary !min-h-0 !py-1.5 text-xs" disabled={bulkBusy} onClick={() => bulk('renew')}>
                            {t('clients.bulkRenewBtn')}
                        </button>
                        <button className="btn-secondary !min-h-0 !py-1.5 text-xs" disabled={bulkBusy} onClick={() => bulk('unblock')}>
                            {t('clients.bulkUnblockBtn')}
                        </button>
                        <button className="btn-danger !min-h-0 !py-1.5 text-xs" disabled={bulkBusy} onClick={() => bulk('block')}>
                            {t('clients.bulkBlockBtn')}
                        </button>
                        <button className="btn-ghost !min-h-0 !py-1.5 text-xs" onClick={() => setSelected([])}>
                            {t('clients.clearSelection')}
                        </button>
                    </div>
                )}
                {!clients ? (
                    <div className="p-5 space-y-3">{[...Array(5)].map((_, i) => <Skeleton key={i} className="h-12" />)}</div>
                ) : clients.length === 0 ? (
                    <p className="p-8 text-center text-slate-500">👥 {t('clients.empty')}</p>
                ) : (
                    <table className="w-full text-sm min-w-[900px]">
                        <thead className="sticky top-0 z-10 bg-white dark:bg-slate-900">
                            <tr className="text-left text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-slate-700">
                                <th className="px-4 py-3 sticky left-0 bg-white dark:bg-slate-900 z-20">
                                    <input type="checkbox" className="cursor-pointer"
                                           checked={clients.length > 0 && selected.length === clients.length}
                                           onChange={(e) => setSelected(e.target.checked ? clients.map((c) => c.id) : [])} />
                                </th>
                                <th className="px-4 py-3 font-medium">{t('clients.thUser')}</th>
                                <th className="px-4 py-3 font-medium">{t('clients.thStatus')}</th>
                                <th className="px-4 py-3 font-medium">{t('clients.thIpNow')}</th>
                                <th className="px-4 py-3 font-medium">{t('clients.thTraffic')}</th>
                                <th className="px-4 py-3 font-medium">{t('clients.thExpires')}</th>
                                <th className="px-4 py-3 font-medium">{t('clients.thProtocols')}</th>
                                <th className="px-4 py-3 font-medium text-right">{t('common.actions')}</th>
                            </tr>
                        </thead>
                        <tbody>
                            {clients.map((c) => {
                                const conns = activeMap[c.username] || [];
                                return (
                                <tr key={c.id} className="border-b border-slate-100 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
                                    <td className="px-4 py-3 sticky left-0 bg-white dark:bg-slate-900 z-[5]">
                                        <input type="checkbox" className="cursor-pointer"
                                               checked={selected.includes(c.id)}
                                               onChange={() => toggleSelect(c.id)} />
                                    </td>
                                    <td className="px-4 py-3">
                                        <div className="flex items-center gap-2">
                                            <Avatar name={c.note || c.username} />
                                            <div>
                                                <button className="font-medium hover:text-primary transition-colors text-left"
                                                        onClick={() => setConnClient(c)}
                                                        title={t('clients.showConns')}>
                                                    {c.username}
                                                </button>
                                                {c.note && <div className="text-xs text-slate-400">{c.note}</div>}
                                            </div>
                                        </div>
                                    </td>
                                    <td className="px-4 py-3"><StatusBadge status={c.status} /></td>
                                    <td className="px-4 py-3">
                                        {conns.length > 0 ? (
                                            <button className="badge-green cursor-pointer" onClick={() => setConnClient(c)}
                                                    title={t('clients.whoOnline')}>
                                                🟢 {conns.length} IP
                                            </button>
                                        ) : (
                                            <span className="text-xs text-slate-400">{t('clients.offline')}</span>
                                        )}
                                    </td>
                                    <td className="px-4 py-3 min-w-[170px]">
                                        <div className="text-base font-bold leading-tight">
                                            {formatBytes(c.traffic_used, lang)}{c.quota_bytes ? '' : ` / ${t('common.infinity')}`}
                                            {c.quota_auto_reset ? (
                                                <span className="ml-1 text-xs align-middle" title={t('clients.autoResetOn')}>♻️</span>
                                            ) : null}
                                        </div>
                                        {c.quota_bytes ? (
                                            <>
                                                <div className="text-xs text-slate-500 mb-1">
                                                    {t('clients.quotaOf', { used: formatBytes(c.quota_bytes, lang), pct: c.quota_percent })}
                                                </div>
                                                <ProgressBar percent={c.quota_percent} />
                                            </>
                                        ) : (
                                            <div className="w-full h-1.5 rounded-full bg-gradient-to-r from-primary via-primary/60 to-transparent mt-1" />
                                        )}
                                    </td>
                                    <td className="px-4 py-3 text-slate-500">{c.expires_at ? formatDate(c.expires_at, lang).split(',')[0] : t('common.infinity')}</td>
                                    <td className="px-4 py-3">
                                        <span className="text-xs">
                                            {c.web_enabled ? t('clients.protoWeb') : ''}{c.web_enabled && c.mtproto_enabled ? ' + ' : ''}{c.mtproto_enabled ? t('clients.protoMtproto') : ''}
                                        </span>
                                    </td>
                                    <td className="px-4 py-3">
                                        <div className="flex justify-end gap-1">
                                            <button className="btn-ghost !min-h-0 !p-2" title={t('clients.actQr')} onClick={() => setQrClient(c)}><QrCode size={16} /></button>
                                            <button className="btn-ghost !min-h-0 !p-2" title={t('clients.actEdit')} onClick={() => openEdit(c)}><Pencil size={16} /></button>
                                            <button className="btn-ghost !min-h-0 !p-2" title={t('clients.actExtend')} onClick={() => extend(c)}><CalendarPlus size={16} /></button>
                                            <button className="btn-ghost !min-h-0 !p-2" title={c.status === 'active' ? t('clients.actDisable') : t('clients.actEnable')}
                                                onClick={() => doAction(c, 'toggle', c.status === 'active' ? t('clients.confirmDisable', { username: c.username }) : null)}>
                                                <Power size={16} className={c.status === 'active' ? 'text-red-500' : 'text-emerald-500'} />
                                            </button>
                                            <button className="btn-ghost !min-h-0 !p-2" title={t('clients.actRotate')}
                                                onClick={() => doAction(c, 'rotate', t('clients.confirmRotate', { username: c.username }))}>
                                                <KeyRound size={16} />
                                            </button>
                                            <button className="btn-ghost !min-h-0 !p-2" title={t('clients.actResetQuota')} onClick={() => doAction(c, 'reset-quota')}><Eraser size={16} /></button>
                                            <button className="btn-ghost !min-h-0 !p-2 text-red-500" title={t('common.delete')} onClick={() => remove(c)}><Trash2 size={16} /></button>
                                        </div>
                                    </td>
                                </tr>
                                );
                            })}
                        </tbody>
                    </table>
                )}
            </Card>

            {/* Модал создания/редактирования */}
            <Modal open={!!modal} onClose={() => setModal(null)} wide
                   title={modal === 'create' ? t('clients.modalCreate') : t('clients.modalEdit', { username: modal?.username })}>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <Field label={t('clients.fUsername')} hint={t('clients.fUsernameHint')}>
                        <input className="input" value={form.username} disabled={modal !== 'create'}
                               onChange={(e) => setForm({ ...form, username: e.target.value })} />
                    </Field>
                    <Field label={t('clients.fQuota')} hint={t('clients.fQuotaHint')}>
                        <input className="input" type="number" min="0" step="0.1" value={form.quota_gb}
                               onChange={(e) => setForm({ ...form, quota_gb: e.target.value })} />
                    </Field>
                    <Field label={t('clients.fExpires')} hint={t('clients.fExpiresHint')}>
                        <input className="input" type="date" value={form.expires_at}
                               onChange={(e) => setForm({ ...form, expires_at: e.target.value })} />
                    </Field>
                    <Field label={t('clients.fMaxIps')} hint={t('clients.fMaxIpsHint')}>
                        <input className="input" type="number" min="1" max="100" value={form.max_ips}
                               onChange={(e) => setForm({ ...form, max_ips: e.target.value })} />
                    </Field>
                    <Field label={t('clients.fRateDown')} hint={t('clients.fRateHint')}>
                        <input className="input" type="number" min="0" value={form.rate_down_mbps}
                               onChange={(e) => setForm({ ...form, rate_down_mbps: e.target.value })} />
                    </Field>
                    <Field label={t('clients.fRateUp')} hint={t('clients.fRateHint')}>
                        <input className="input" type="number" min="0" value={form.rate_up_mbps}
                               onChange={(e) => setForm({ ...form, rate_up_mbps: e.target.value })} />
                    </Field>
                    <Field label={t('clients.fAdTag')} hint={t('clients.fAdTagHint')} className="sm:col-span-2">
                        <input className="input font-mono" value={form.ad_tag} maxLength={32}
                               onChange={(e) => setForm({ ...form, ad_tag: e.target.value })} />
                    </Field>
                    <Field label={t('clients.fNote')} hint={t('clients.fNoteHint')}>
                        <input className="input" value={form.note}
                               onChange={(e) => setForm({ ...form, note: e.target.value })} />
                    </Field>
                    <div className="flex items-center gap-6">
                        <Toggle checked={form.web_enabled} onChange={(v) => setForm({ ...form, web_enabled: v })} label={t('clients.protoWebFull')} />
                        <Toggle checked={form.mtproto_enabled} onChange={(v) => setForm({ ...form, mtproto_enabled: v })} label={t('clients.protoMtprotoFull')} />
                    </div>
                    {modal !== 'create' && (
                        <div className="sm:col-span-2">
                            <Toggle checked={!!form.quota_auto_reset} onChange={(v) => setForm({ ...form, quota_auto_reset: v })} label={t('clients.fAutoReset')} />
                            <span className="block text-xs text-slate-500 mt-1">{t('clients.fAutoResetHint')}</span>
                        </div>
                    )}
                </div>
                <div className="flex justify-end gap-2 mt-6">
                    <button className="btn-secondary" onClick={() => setModal(null)}>{t('common.cancel')}</button>
                    <button className="btn-primary" onClick={save} disabled={saving || !form.username.trim()}>
                        {saving ? t('common.saving') : t('common.save')}
                    </button>
                </div>
            </Modal>

            {/* Модал QR-кодов */}
            <Modal open={!!qrClient} onClose={() => setQrClient(null)} title={t('clients.qrTitle', { username: qrClient?.username })} wide>
                {qrClient && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                        {qrClient.links.web && (
                            <div className="text-center">
                                <h4 className="font-medium mb-3">{t('clients.qrWeb')}</h4>
                                <img src={`/api/qr/client/${qrClient.id}/web.png?token=${sessionStorage.getItem('tggate_token')}`} alt="QR Web Proxy"
                                     className="mx-auto rounded-lg border border-slate-200 dark:border-slate-700 w-48 h-48" />
                                <button className="btn-secondary mt-3 w-full" onClick={() => copyText(qrClient.links.web, t)}>
                                    <Copy size={14} /> {t('clients.qrCopy')}
                                </button>
                            </div>
                        )}
                        {qrClient.links.mtproto && (
                            <div className="text-center">
                                <h4 className="font-medium mb-3">{t('clients.qrMtproto')}</h4>
                                <img src={`/api/qr/client/${qrClient.id}/mtproto.png?token=${sessionStorage.getItem('tggate_token')}`} alt="QR MTProto"
                                     className="mx-auto rounded-lg border border-slate-200 dark:border-slate-700 w-48 h-48" />
                                <button className="btn-secondary mt-3 w-full" onClick={() => copyText(qrClient.links.mtproto, t)}>
                                    <Copy size={14} /> {t('clients.qrCopy')}
                                </button>
                            </div>
                        )}
                    </div>
                )}
            </Modal>
            {/* Модал подключений клиента */}
            <ConnModal client={connClient}
                       activeConns={connClient ? (activeMap[connClient.username] || []) : []}
                       onClose={() => setConnClient(null)} t={t} lang={lang} />
        </div>
    );
}

/** Модал подключений клиента: кто онлайн + персистентная история */
function ConnModal({ client, activeConns, onClose, t, lang }) {
    const [history, setHistory] = useState(null);
    useEffect(() => {
        if (!client) return;
        setHistory(null);
        get(`/logs?username=${encodeURIComponent(client.username)}&limit=20`)
            .then((d) => setHistory(d.logs || []))
            .catch(() => setHistory([]));
    }, [client?.username]);
    return (
        <Modal open={!!client} onClose={onClose}
               title={t('clients.connTitle', { username: client?.username })}>
            {client && activeConns.length === 0 ? (
                <p className="text-sm text-slate-500 py-6 text-center">
                    {t('clients.connEmpty')}
                </p>
            ) : client && (
                <table className="w-full text-sm">
                    <thead>
                        <tr className="text-left text-slate-500 border-b border-slate-200 dark:border-slate-700">
                            <th className="py-2 pr-4 font-medium">{t('dashboard.thIp')}</th>
                            <th className="py-2 pr-4 font-medium">{t('dashboard.thCountry')}</th>
                            <th className="py-2 font-medium">{t('dashboard.thProto')}</th>
                        </tr>
                    </thead>
                    <tbody>
                        {activeConns.map((c, i) => (
                            <tr key={`${c.ip}-${i}`} className="border-b border-slate-100 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
                                <td className="py-2 pr-4 font-mono text-xs">{c.ip}</td>
                                <td className="py-2 pr-4">{c.country}</td>
                                <td className="py-2"><ProtoBadge protocol={c.protocol} /></td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            )}
            {/* История подключений (переживает рестарты) */}
            <h4 className="font-medium mt-5 mb-2 text-sm">{t('clients.histTitle')}</h4>
            {!history ? (
                <Skeleton className="h-16" />
            ) : history.length === 0 ? (
                <p className="text-sm text-slate-500 py-2 text-center">{t('clients.histEmpty')}</p>
            ) : (
                <table className="w-full text-sm">
                    <tbody>
                        {history.map((h) => (
                            <tr key={h.id} className="border-b border-slate-100 dark:border-slate-800">
                                <td className="py-1.5 pr-4 text-slate-500 whitespace-nowrap">{formatDate(h.created_at, lang)}</td>
                                <td className="py-1.5 pr-4 font-mono text-xs">{h.ip}</td>
                                <td className="py-1.5"><ProtoBadge protocol={h.protocol} /></td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            )}
            <p className="text-xs text-slate-400 mt-4">{t('clients.connNote')}</p>
        </Modal>
    );
}
