// Промокоды: создание (дни/скидка, новеньким/всем) и список
import React, { useEffect, useState } from 'react';
import { Plus, Trash2, Ticket, Dices } from 'lucide-react';
import { get, post, del } from '../api';
import { toast, useLangStore } from '../store';
import { useT } from '../i18n';
import { Card, Field, Skeleton, PageHeader, formatDate } from '../components/ui';

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const genCode = () => 'PROMO-' + Array.from({ length: 5 }, () => ALPHABET[Math.floor(Math.random() * ALPHABET.length)]).join('');

const EMPTY = {
    code: '', kind: 'days', audience: 'new', days: '', discount_percent: '',
    max_uses: '', expires_at: '', one_per_user: true,
};

export default function Promos() {
    const [list, setList] = useState(null);
    const [form, setForm] = useState({ ...EMPTY, code: genCode() });
    const [busy, setBusy] = useState(false);
    const lang = useLangStore((s) => s.lang);
    const t = useT();
    const upd = (patch) => setForm((f) => ({ ...f, ...patch }));

    const load = () => get('/payments/promo').then((d) => setList(d.promo)).catch((e) => toast.error(e.message));
    useEffect(() => { load(); }, []);

    const create = async () => {
        setBusy(true);
        try {
            const body = {
                code: form.code.trim(), kind: form.kind, audience: form.audience,
                one_per_user: !!form.one_per_user,
                max_uses: form.max_uses === '' ? null : Number(form.max_uses),
                expires_at: form.expires_at ? new Date(form.expires_at).toISOString() : null,
                ...(form.kind === 'days'
                    ? { days: Number(form.days) }
                    : { discount_percent: Number(form.discount_percent) }),
            };
            const r = await post('/payments/promo', body);
            toast.success(t('promos.created', { code: r.code }));
            setForm({ ...EMPTY, code: genCode() });
            load();
        } catch (e) { toast.error(e.message); } finally { setBusy(false); }
    };

    const remove = async (code) => {
        if (!window.confirm(t('promos.removeConfirm', { code }))) return;
        try {
            await del(`/payments/promo/${code}`);
            toast.success(t('promos.removed'));
            load();
        } catch (e) { toast.error(e.message); }
    };

    const kindLabel = (p) => p.kind === 'days'
        ? t('promos.kindDays', { n: p.days })
        : (p.discount_percent ? t('promos.kindPercent', { n: p.discount_percent }) : t('promos.kindFixed', { n: p.discount_fixed }));
    const audienceLabel = (p) => p.audience === 'new' ? t('promos.audNew') : t('promos.audAll');

    return (
        <div className="space-y-4">
            <PageHeader icon={<Ticket size={20} />} title={t('promos.title')}
                        subtitle={t('promos.subtitle')} />

            {/* Создание */}
            <Card title={t('promos.createTitle')}>
                <div className="grid sm:grid-cols-2 gap-3">
                    <Field label={t('promos.fCode')}>
                        <div className="flex gap-2">
                            <input className="input font-mono uppercase" value={form.code} maxLength={32} spellCheck={false}
                                   autoComplete="off" placeholder="PROMO-…"
                                   onChange={(e) => upd({ code: e.target.value.toUpperCase() })} />
                            <button className="btn-secondary !min-h-0 !px-3" title={t('promos.gen')}
                                    onClick={() => upd({ code: genCode() })} aria-label={t('promos.gen')}>
                                <Dices size={16} />
                            </button>
                        </div>
                    </Field>
                    <Field label={t('promos.fKind')}>
                        <select className="input" value={form.kind} onChange={(e) => upd({ kind: e.target.value })}>
                            <option value="days">{t('promos.kindDaysOpt')}</option>
                            <option value="percent">{t('promos.kindPercentOpt')}</option>
                        </select>
                    </Field>
                    {form.kind === 'days' ? (
                        <Field label={t('promos.fDays')} hint={t('promos.fDaysHint')}>
                            <input className="input" type="number" min="1" max="3650" value={form.days}
                                   onChange={(e) => upd({ days: e.target.value })} />
                        </Field>
                    ) : (
                        <Field label={t('promos.fPercent')} hint={t('promos.fPercentHint')}>
                            <input className="input" type="number" min="1" max="99" value={form.discount_percent}
                                   onChange={(e) => upd({ discount_percent: e.target.value })} />
                        </Field>
                    )}
                    <Field label={t('promos.fAudience')} hint={t('promos.fAudienceHint')}>
                        <select className="input" value={form.audience} onChange={(e) => upd({ audience: e.target.value })}>
                            <option value="new">{t('promos.audNew')}</option>
                            <option value="all">{t('promos.audAll')}</option>
                        </select>
                    </Field>
                    <Field label={t('promos.fExpires')}>
                        <input className="input" type="datetime-local" value={form.expires_at}
                               onChange={(e) => upd({ expires_at: e.target.value })} />
                    </Field>
                    <Field label={t('promos.fMax')} hint={t('promos.fMaxHint')}>
                        <input className="input" type="number" min="1" value={form.max_uses}
                               onChange={(e) => upd({ max_uses: e.target.value })} />
                    </Field>
                    <label className="flex items-center gap-2 text-sm cursor-pointer sm:col-span-2">
                        <input type="checkbox" checked={!!form.one_per_user}
                               onChange={(e) => upd({ one_per_user: e.target.checked })} />
                        {t('promos.fOnePerUser')}
                    </label>
                </div>
                <div className="flex justify-end mt-4">
                    <button className="btn-primary" disabled={busy || !form.code.trim()} onClick={create}>
                        <Plus size={15} /> {t('promos.create')}
                    </button>
                </div>
            </Card>

            {/* Список */}
            <Card title={t('promos.listTitle')}>
                {!list ? <Skeleton className="h-24" /> : list.length === 0 ? (
                    <p className="text-sm text-slate-500 py-4 text-center">{t('promos.empty')}</p>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm min-w-[720px]">
                            <thead>
                                <tr className="text-left text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-slate-700">
                                    <th className="py-2 pr-4 font-medium">{t('promos.colCode')}</th>
                                    <th className="py-2 pr-4 font-medium">{t('promos.colKind')}</th>
                                    <th className="py-2 pr-4 font-medium">{t('promos.colAudience')}</th>
                                    <th className="py-2 pr-4 font-medium tabular-nums">{t('promos.colUses')}</th>
                                    <th className="py-2 pr-4 font-medium">{t('promos.colExpires')}</th>
                                    <th className="py-2 pr-4 font-medium text-right">{t('common.actions')}</th>
                                </tr>
                            </thead>
                            <tbody>
                                {list.map((p) => {
                                    const dead = p.expired || (p.max_uses && p.uses >= p.max_uses) || !p.enabled;
                                    return (
                                        <tr key={p.code} className={`border-b border-slate-100 dark:border-slate-800 ${dead ? 'opacity-50' : ''}`}>
                                            <td className="py-2 pr-4 font-mono font-medium">{p.code}</td>
                                            <td className="py-2 pr-4">{kindLabel(p)}</td>
                                            <td className="py-2 pr-4 text-slate-500">{audienceLabel(p)}</td>
                                            <td className="py-2 pr-4 tabular-nums">{p.uses}{p.max_uses ? ` / ${p.max_uses}` : ''}</td>
                                            <td className="py-2 pr-4 text-slate-500 text-xs">
                                                {p.expires_at ? formatDate(p.expires_at, lang) : '∞'}
                                            </td>
                                            <td className="py-2 pr-4 text-right">
                                                <button className="btn-ghost !min-h-0 !p-2 text-red-500" title={t('common.delete')}
                                                        aria-label={t('common.delete')}
                                                        onClick={() => remove(p.code)}>
                                                    <Trash2 size={15} />
                                                </button>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                )}
            </Card>
        </div>
    );
}
