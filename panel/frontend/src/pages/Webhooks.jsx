// Вебхуки: подписки на события + проверка доставки
import React, { useEffect, useState } from 'react';
import { Plus, Trash2, Power, Webhook, Send, Copy } from 'lucide-react';
import { get, post, del, patch } from '../api';
import { toast } from '../store';
import { useT } from '../i18n';
import { Card, Modal, Field, Skeleton, PageHeader } from '../components/ui';

export default function Webhooks() {
    const [data, setData] = useState(null);
    const [modal, setModal] = useState(false);
    const [form, setForm] = useState({ event: 'client.created', url: '' });
    const [newSecret, setNewSecret] = useState(null);
    const [busyId, setBusyId] = useState(null);
    const t = useT();

    const load = () => get('/webhooks').then(setData).catch((e) => toast.error(e.message));
    useEffect(() => { load(); }, []);

    const create = async () => {
        try {
            const d = await post('/webhooks', form);
            setNewSecret(d.secret);
            setModal(false);
            setForm({ event: 'client.created', url: '' });
            load();
        } catch (e) {
            toast.error(e.message);
        }
    };

    const toggle = async (h) => {
        try {
            await patch(`/webhooks/${h.id}`, { enabled: !h.enabled });
            load();
        } catch (e) { toast.error(e.message); }
    };

    const remove = async (h) => {
        if (!confirm(t('webhooks.confirmDel'))) return;
        try {
            await del(`/webhooks/${h.id}`);
            load();
        } catch (e) { toast.error(e.message); }
    };

    const test = async (h) => {
        setBusyId(h.id);
        try {
            await post(`/webhooks/${h.id}/test`, {});
            toast.success(t('webhooks.testOk'));
        } catch (e) {
            toast.error(t('webhooks.testFail', { err: e.message }));
        } finally {
            setBusyId(null);
            load();
        }
    };

    const hooks = data?.webhooks;
    const events = data?.events || [];

    return (
        <div className="space-y-4">
            <PageHeader icon={<Webhook size={20} />} title={t('webhooks.title')}
                        subtitle={t('webhooks.subtitle')}
                        actions={
                            <button className="btn-primary" onClick={() => setModal(true)} disabled={!events.length}>
                                <Plus size={16} /> {t('webhooks.createBtn')}
                            </button>
                        } />

            {newSecret && (
                <Card className="border-amber-300 dark:border-amber-500/50">
                    <p className="text-sm mb-2 font-medium">{t('webhooks.secretOnce')}</p>
                    <div className="flex gap-2">
                        <code className="flex-1 font-mono text-sm bg-slate-100 dark:bg-slate-800 rounded-lg px-3 py-2 break-all">{newSecret}</code>
                        <button className="btn-secondary shrink-0"
                                onClick={() => { navigator.clipboard.writeText(newSecret); toast.success(t('common.copied')); }}>
                            <Copy size={16} />
                        </button>
                    </div>
                    <button className="btn-ghost mt-2 text-sm" onClick={() => setNewSecret(null)}>{t('webhooks.savedBtn')}</button>
                </Card>
            )}

            <Card className="!p-0 overflow-x-auto">
                {!hooks ? <div className="p-5"><Skeleton className="h-24" /></div> : hooks.length === 0 ? (
                    <p className="p-8 text-center text-slate-500">{t('webhooks.empty')}</p>
                ) : (
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="text-left text-slate-500 border-b border-slate-200 dark:border-slate-700">
                                <th className="px-4 py-3 font-medium">{t('webhooks.thEvent')}</th>
                                <th className="px-4 py-3 font-medium">{t('webhooks.thUrl')}</th>
                                <th className="px-4 py-3 font-medium">{t('webhooks.thStatus')}</th>
                                <th className="px-4 py-3 font-medium text-right">{t('common.actions')}</th>
                            </tr>
                        </thead>
                        <tbody>
                            {hooks.map((h) => (
                                <tr key={h.id} className="border-b border-slate-100 dark:border-slate-800">
                                    <td className="px-4 py-3 font-mono text-xs">{h.event}</td>
                                    <td className="px-4 py-3 font-mono text-xs max-w-xs truncate" title={h.url}>{h.url}</td>
                                    <td className="px-4 py-3">
                                        {!h.enabled ? (
                                            <span className="text-xs text-slate-400">{t('webhooks.off')}</span>
                                        ) : h.last_status === 1 ? (
                                            <span className="text-xs text-emerald-500">{t('webhooks.delivered')}</span>
                                        ) : h.last_status === 0 ? (
                                            <span className="text-xs text-red-500" title={h.last_error || ''}>
                                                {t('webhooks.failed')}{h.last_error ? `: ${h.last_error.slice(0, 60)}` : ''}
                                            </span>
                                        ) : (
                                            <span className="text-xs text-slate-400">{t('webhooks.never')}</span>
                                        )}
                                    </td>
                                    <td className="px-4 py-3">
                                        <div className="flex justify-end gap-1">
                                            <button className="btn-ghost !min-h-0 !p-2" title={t('webhooks.testBtn')}
                                                    disabled={busyId === h.id || !h.enabled}
                                                    onClick={() => test(h)}>
                                                <Send size={16} className={busyId === h.id ? 'animate-pulse text-blue-500' : ''} />
                                            </button>
                                            <button className="btn-ghost !min-h-0 !p-2" onClick={() => toggle(h)}>
                                                <Power size={16} className={h.enabled ? 'text-emerald-500' : 'text-red-500'} />
                                            </button>
                                            <button className="btn-ghost !min-h-0 !p-2 text-red-500" onClick={() => remove(h)}>
                                                <Trash2 size={16} />
                                            </button>
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}
            </Card>

            <Modal open={modal} onClose={() => setModal(false)} title={t('webhooks.modalTitle')}>
                <div className="space-y-4">
                    <Field label={t('webhooks.fEvent')}>
                        <select className="input" value={form.event} onChange={(e) => setForm({ ...form, event: e.target.value })}>
                            {events.map((e) => <option key={e} value={e}>{e}</option>)}
                        </select>
                    </Field>
                    <Field label={t('webhooks.fUrl')} hint={t('webhooks.fUrlHint')}>
                        <input className="input" value={form.url} placeholder="https://example.com/hook"
                               onChange={(e) => setForm({ ...form, url: e.target.value })} />
                    </Field>
                    <div className="flex justify-end gap-2">
                        <button className="btn-secondary" onClick={() => setModal(false)}>{t('common.cancel')}</button>
                        <button className="btn-primary" onClick={create} disabled={!form.url.trim()}>{t('common.create')}</button>
                    </div>
                </div>
            </Modal>
        </div>
    );
}