// Узлы (локации) мульти-сервера: список, здоровье, добавление и правка
import React, { useEffect, useState } from 'react';
import { Server, Plus, Activity, Trash2, Pencil, RefreshCcw } from 'lucide-react';
import { get, post, patch, del } from '../api';
import { toast } from '../store';
import { useT } from '../i18n';
import { Card, Modal, PageHeader, StatusDot, Skeleton, Field } from '../components/ui';

const EMPTY = {
    name: '', emoji: '🌍', domain: '', mask_domain: '',
    control_url: '', api_token: '', mtproto_port: '', max_clients: '', enabled: true,
};

function HealthLine({ health }) {
    if (!health) return <span className="text-xs text-slate-500">—</span>;
    return (
        <span className="flex items-center gap-2">
            <StatusDot ok={health.ok} />
            <span className="text-xs text-slate-500">
                {health.ok ? `${health.latency_ms} мс` : (health.error || 'недоступен').slice(0, 60)}
            </span>
        </span>
    );
}

export default function Nodes() {
    const [data, setData] = useState(null);
    const [modal, setModal] = useState(null); // {mode:'add'|'edit', form}
    const [busy, setBusy] = useState(false);
    const t = useT();

    const load = () => get('/nodes').then(setData).catch(() => {});
    useEffect(() => { load(); }, []);

    const save = async () => {
        setBusy(true);
        try {
            const f = modal.form;
            const body = {
                name: f.name.trim(),
                emoji: f.emoji || null,
                domain: f.domain.trim().toLowerCase(),
                mask_domain: f.mask_domain ? f.mask_domain.trim().toLowerCase() : null,
                control_url: f.control_url.trim(),
                api_token: f.api_token || undefined,
                mtproto_port: f.mtproto_port ? Number(f.mtproto_port) : null,
                max_clients: f.max_clients ? Number(f.max_clients) : null,
                enabled: !!f.enabled,
            };
            if (modal.mode === 'add') await post('/nodes', body);
            else await patch(`/nodes/${modal.id}`, body);
            toast(t('nodes.saved'), 'ok');
            setModal(null);
            load();
        } catch (e) {
            toast(e.message, 'bad');
        } finally {
            setBusy(false);
        }
    };

    const remove = async (id) => {
        if (!window.confirm(t('nodes.removeConfirm'))) return;
        try {
            const r = await del(`/nodes/${id}`);
            toast(t('nodes.removed', { n: r.clients_moved_back ?? 0 }), 'ok');
            load();
        } catch (e) { toast(e.message, 'bad'); }
    };

    const checkHealth = async (id) => {
        try {
            const r = await post(`/nodes/${id}/health`);
            toast(r.health?.ok ? `${t('nodes.healthOk')} (${r.health.latency_ms} мс)` : `${t('nodes.healthBad')}: ${r.health?.error || ''}`, r.health?.ok ? 'ok' : 'bad');
            load();
        } catch (e) { toast(e.message, 'bad'); }
    };

    if (!data) return <div className="space-y-4">{[...Array(2)].map((_, i) => <Skeleton key={i} className="h-40" />)}</div>;

    const all = [data.local, ...data.nodes];

    return (
        <div className="space-y-4">
            <PageHeader icon={<Server size={20} />} title={t('nodes.title')}
                        subtitle={t('nodes.subtitle')}
                        actions={
                            <button className="btn primary !py-2" onClick={() => setModal({ mode: 'add', form: { ...EMPTY } })}>
                                <Plus size={16} className="inline mr-1" />{t('nodes.add')}
                            </button>
                        } />

            <Card title={t('nodes.listTitle')}>
                <div className="overflow-x-auto">
                    <table className="w-full text-sm min-w-[760px]">
                        <thead>
                            <tr className="text-left text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-slate-700">
                                <th className="px-3 py-2 font-medium">{t('nodes.colName')}</th>
                                <th className="px-3 py-2 font-medium">{t('nodes.colDomain')}</th>
                                <th className="px-3 py-2 font-medium">{t('nodes.colClients')}</th>
                                <th className="px-3 py-2 font-medium">{t('nodes.colHealth')}</th>
                                <th className="px-3 py-2 font-medium text-right">{t('nodes.colActions')}</th>
                            </tr>
                        </thead>
                        <tbody>
                            {all.map((nd) => (
                                <tr key={nd.id ?? 'local'} className="border-b border-slate-100 dark:border-slate-800">
                                    <td className="px-3 py-2.5 font-medium">
                                        {nd.emoji || '🏠'} {nd.name}
                                        {!nd.enabled && nd.id !== null && <span className="ml-2 text-xs text-slate-400">{t('nodes.disabled')}</span>}
                                    </td>
                                    <td className="px-3 py-2.5 text-slate-500">
                                        {nd.domain ? <code className="text-xs">{nd.domain}</code> : <span className="text-xs">—</span>}
                                    </td>
                                    <td className="px-3 py-2.5">{nd.clients}</td>
                                    <td className="px-3 py-2.5"><HealthLine health={nd.health} /></td>
                                    <td className="px-3 py-2.5 text-right whitespace-nowrap">
                                        {nd.id !== null ? (
                                            <>
                                                <button className="btn mini ghost mr-1" title={t('nodes.check')} onClick={() => checkHealth(nd.id)}><RefreshCcw size={13} /></button>
                                                <button className="btn mini ghost mr-1" title={t('nodes.edit')} onClick={() => setModal({
                                                    mode: 'edit', id: nd.id,
                                                    form: { ...EMPTY, ...nd, api_token: '', mtproto_port: nd.mtproto_port ?? '', max_clients: nd.max_clients ?? '', enabled: !!nd.enabled },
                                                })}><Pencil size={13} /></button>
                                                <button className="btn mini ghost !text-red-500" title={t('nodes.remove')} onClick={() => remove(nd.id)}><Trash2 size={13} /></button>
                                            </>
                                        ) : <span className="text-xs text-slate-400">главный</span>}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </Card>

            <Card>
                <div className="text-sm text-slate-500 space-y-1.5">
                    <p className="font-medium text-slate-600 dark:text-slate-300">{t('nodes.howTitle')}</p>
                    <p>{t('nodes.how1')}</p>
                    <p>{t('nodes.how2')}</p>
                    <p>{t('nodes.how3')}</p>
                </div>
            </Card>

            <Modal open={!!modal} onClose={() => setModal(null)} title={modal?.mode === 'add' ? t('nodes.add') : t('nodes.edit')} wide>
                {modal && (
                    <div className="grid sm:grid-cols-2 gap-3">
                        <Field label={t('nodes.fName')}><input className="input" value={modal.form.name} onChange={(e) => setModal({ ...modal, form: { ...modal.form, name: e.target.value } })} placeholder="Германия" /></Field>
                        <Field label={t('nodes.fEmoji')} hint={t('nodes.fEmojiHint')}><input className="input" value={modal.form.emoji || ''} onChange={(e) => setModal({ ...modal, form: { ...modal.form, emoji: e.target.value } })} placeholder="🇩🇪" /></Field>
                        <Field label={t('nodes.fDomain')}><input className="input" value={modal.form.domain} onChange={(e) => setModal({ ...modal, form: { ...modal.form, domain: e.target.value } })} placeholder="de1.example.com" /></Field>
                        <Field label={t('nodes.fMask')}><input className="input" value={modal.form.mask_domain || ''} onChange={(e) => setModal({ ...modal, form: { ...modal.form, mask_domain: e.target.value } })} placeholder="www.cloudflare.com" /></Field>
                        <Field label={t('nodes.fControlUrl')}><input className="input" value={modal.form.control_url} onChange={(e) => setModal({ ...modal, form: { ...modal.form, control_url: e.target.value } })} placeholder="http://1.2.3.4:9091" /></Field>
                        <Field label={t('nodes.fToken')} hint={t('nodes.fTokenHint')}><input className="input" value={modal.form.api_token} onChange={(e) => setModal({ ...modal, form: { ...modal.form, api_token: e.target.value } })} placeholder="••••••" /></Field>
                        <Field label={t('nodes.fPort')} hint={t('nodes.fPortHint')}><input className="input" type="number" value={modal.form.mtproto_port || ''} onChange={(e) => setModal({ ...modal, form: { ...modal.form, mtproto_port: e.target.value } })} /></Field>
                        <Field label={t('nodes.fMax')} hint={t('nodes.fMaxHint')}><input className="input" type="number" value={modal.form.max_clients || ''} onChange={(e) => setModal({ ...modal, form: { ...modal.form, max_clients: e.target.value } })} /></Field>
                        <label className="flex items-center gap-2 text-sm sm:col-span-2 cursor-pointer">
                            <input type="checkbox" checked={!!modal.form.enabled} onChange={(e) => setModal({ ...modal, form: { ...modal.form, enabled: e.target.checked } })} />
                            {t('nodes.fEnabled')}
                        </label>
                        <div className="sm:col-span-2 flex gap-2 justify-end">
                            <button className="btn ghost" onClick={() => setModal(null)}>{t('nodes.cancel')}</button>
                            <button className="btn primary" disabled={busy} onClick={save}><Activity size={15} className="inline mr-1" />{busy ? t('nodes.saving') : t('nodes.save')}</button>
                        </div>
                    </div>
                )}
            </Modal>
        </div>
    );
}
