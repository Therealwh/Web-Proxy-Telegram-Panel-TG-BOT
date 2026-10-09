// Управление API-ключами для разработчиков
import React, { useEffect, useState } from 'react';
import { Plus, Copy, Trash2, Power, KeyRound } from 'lucide-react';
import { get, post, del, patch } from '../api';
import { toast, useLangStore } from '../store';
import { useT } from '../i18n';
import { Card, Modal, Field, Skeleton, PageHeader, formatDate } from '../components/ui';

export default function ApiKeys() {
    const [keys, setKeys] = useState(null);
    const [modal, setModal] = useState(false);
    const [form, setForm] = useState({ name: '', permissions: 'read', days: '' });
    const [newKey, setNewKey] = useState(null); // показывается один раз
    const lang = useLangStore((s) => s.lang);
    const t = useT();

    const load = () => get('/api-keys').then((d) => setKeys(d.keys)).catch((e) => toast.error(e.message));
    useEffect(() => { load(); }, [$1]);

    const create = async () => {
        try {
            const d = await post('/api-keys', {
                name: form.name,
                permissions: form.permissions,
                expires_at: form.days ? new Date(Date.now() + form.days * 86400000).toISOString() : null,
            });
            setNewKey(d.key);
            setModal(false);
            setForm({ name: '', permissions: 'read', days: '' });
            load();
        } catch (e) {
            toast.error(e.message);
        }
    };

    const toggle = async (key) => {
        try {
            await patch(`/api-keys/${key.id}`, { enabled: !key.enabled });
            load();
        } catch (e) { toast.error(e.message); }
    };

    const remove = async (key) => {
        if (!confirm(t('apikeys.confirmDel', { name: key.name }))) return;
        try {
            await del(`/api-keys/${key.id}`);
            load();
        } catch (e) { toast.error(e.message); }
    };

    const PERM_LABELS = { read: t('apikeys.permRead'), write: t('apikeys.permWrite'), full: t('apikeys.permFull') };

    return (
        <div className="space-y-4">
            <PageHeader icon={<KeyRound size={20} />} title={t('apikeys.title')}
                        subtitle={t('apikeys.subtitle')}
                        actions={
                            <button className="btn-primary" onClick={() => setModal(true)}><Plus size={16} /> {t('apikeys.createBtn')}</button>
                        } />

            {newKey && (
                <Card className="border-amber-300 dark:border-amber-500/50">
                    <p className="text-sm mb-2 font-medium">{t('apikeys.saveOnce')}</p>
                    <div className="flex gap-2">
                        <code className="flex-1 font-mono text-sm bg-slate-100 dark:bg-slate-800 rounded-lg px-3 py-2 break-all">{newKey}</code>
                        <button className="btn-secondary shrink-0" onClick={() => { navigator.clipboard.writeText(newKey); toast.success(t('common.copied')); }}>
                            <Copy size={16} />
                        </button>
                    </div>
                    <button className="btn-ghost mt-2 text-sm" onClick={() => setNewKey(null)}>{t('apikeys.savedBtn')}</button>
                </Card>
            )}

            <Card className="!p-0 overflow-x-auto">
                {!keys ? <div className="p-5"><Skeleton className="h-24" /></div> : keys.length === 0 ? (
                    <p className="p-8 text-center text-slate-500">{t('apikeys.empty')}</p>
                ) : (
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="text-left text-slate-500 border-b border-slate-200 dark:border-slate-700">
                                <th className="px-4 py-3 font-medium">{t('apikeys.thName')}</th>
                                <th className="px-4 py-3 font-medium">{t('apikeys.thKey')}</th>
                                <th className="px-4 py-3 font-medium">{t('apikeys.thPerms')}</th>
                                <th className="px-4 py-3 font-medium">{t('apikeys.thReqs')}</th>
                                <th className="px-4 py-3 font-medium">{t('apikeys.thExpires')}</th>
                                <th className="px-4 py-3 font-medium text-right">{t('common.actions')}</th>
                            </tr>
                        </thead>
                        <tbody>
                            {keys.map((k) => (
                                <tr key={k.id} className="border-b border-slate-100 dark:border-slate-800">
                                    <td className="px-4 py-3 font-medium">{k.name}</td>
                                    <td className="px-4 py-3 font-mono text-xs">{k.key_prefix}••••••••</td>
                                    <td className="px-4 py-3">{PERM_LABELS[k.permissions]}</td>
                                    <td className="px-4 py-3">{k.requests_count}</td>
                                    <td className="px-4 py-3 text-slate-500">{k.expires_at ? formatDate(k.expires_at, lang).split(',')[0] : t('common.infinity')}</td>
                                    <td className="px-4 py-3">
                                        <div className="flex justify-end gap-1">
                                            <button className="btn-ghost !min-h-0 !p-2" onClick={() => toggle(k)}>
                                                <Power size={16} className={k.enabled ? 'text-emerald-500' : 'text-red-500'} />
                                            </button>
                                            <button className="btn-ghost !min-h-0 !p-2 text-red-500" onClick={() => remove(k)}><Trash2 size={16} /></button>
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}
            </Card>

            <Modal open={modal} onClose={() => setModal(false)} title={t('apikeys.modalTitle')}>
                <div className="space-y-4">
                    <Field label={t('apikeys.fName')} hint={t('apikeys.fNameHint')}>
                        <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
                    </Field>
                    <Field label={t('apikeys.fPerms')}>
                        <select className="input" value={form.permissions} onChange={(e) => setForm({ ...form, permissions: e.target.value })}>
                            <option value="read">{t('apikeys.permRead')}</option>
                            <option value="write">{t('apikeys.permWrite')}</option>
                            <option value="full">{t('apikeys.permFull')}</option>
                        </select>
                    </Field>
                    <Field label={t('apikeys.fDays')} hint={t('apikeys.fDaysHint')}>
                        <input className="input" type="number" min="1" value={form.days} onChange={(e) => setForm({ ...form, days: e.target.value })} />
                    </Field>
                    <div className="flex justify-end gap-2">
                        <button className="btn-secondary" onClick={() => setModal(false)}>{t('common.cancel')}</button>
                        <button className="btn-primary" onClick={create} disabled={!form.name.trim()}>{t('common.create')}</button>
                    </div>
                </div>
            </Modal>
        </div>
    );
}
