// Настройка Telegram-бота продаж: админка (пользователи, баланс), тарифы, платежки
import React, { useEffect, useState } from 'react';
import { Plus, Save, Trash2, Power, Wallet, MessageSquare, ChevronDown, ChevronLeft, ChevronRight,
         Pencil, Bot as BotIcon, Search, RefreshCcw, Users as UsersIcon,
         SlidersHorizontal, Receipt } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { get, post, put, del } from '../api';
import { toast, useLangStore } from '../store';
import { useT } from '../i18n';
import { Card, Field, Toggle, Skeleton, Modal, StatusBadge, formatDate, PageHeader, Avatar } from '../components/ui';

/** Строка «настройка → значение» для сводного вида карточек */
function settingRow(label, value) {
    return (
        <div key={label} className="flex flex-wrap items-baseline justify-between gap-2 py-1.5 border-b border-slate-100 dark:border-slate-800/60 last:border-0">
            <span className="text-sm text-slate-500 dark:text-slate-400">{label}</span>
            <span className="text-sm font-medium text-right break-all">{value || '—'}</span>
        </div>
    );
}

export default function Bot() {
    const [settings, setSettings] = useState(null);
    const [tariffs, setTariffs] = useState(null);
    const [botStatus, setBotStatus] = useState(null);
    const [stats, setStats] = useState(null);
    const [balanceModal, setBalanceModal] = useState(null); // {tgId, name}
    const [balanceAmount, setBalanceAmount] = useState('');
    const [issueModal, setIssueModal] = useState(null);     // {telegram_id, days, protocols, max_ips, quota_gb}
    const [issueBusy, setIssueBusy] = useState(false);
    const [editCard, setEditCard] = useState(null);     // 'buttons' | 'basic' | 'sub' | 'pay' — модалка настроек
    const [tariffModal, setTariffModal] = useState(null);   // редактирование тарифа (null = закрыто)
    const lang = useLangStore((s) => s.lang);
    const t = useT();

    const toggleTariff = async (row, v) => {
        if (!row.id) return;
        try {
            await put(`/bot/tariffs/${row.id}`, { ...row, enabled: v ? 1 : 0 });
            load();
        } catch (e) { toast.error(e.message); }
    };
    const [msgModal, setMsgModal] = useState(null); // {tgId, name}
    const [msgText, setMsgText] = useState('');
    const [expanded, setExpanded] = useState(null); // раскрытый tgId

    // ── Список пользователей: состояние в URL (глубокие ссылки на вкладку,
    //    страницу, поиск и фильтр) ──
    const [searchParams, setSearchParams] = useSearchParams();
    const tab = searchParams.get('tab') || 'users';
    const setTab = (v) => setSearchParams(v === 'users' ? {} : { tab: v }, { replace: true });
    const usersPage = Math.max(1, parseInt(searchParams.get('page') || '1', 10) || 1);
    const usersLimit = Math.min(100, Math.max(10, parseInt(searchParams.get('limit') || '25', 10) || 25));
    const usersFilter = ['all', 'proxies', 'active', 'noproxies', 'balance'].includes(searchParams.get('filter'))
        ? searchParams.get('filter') : 'all';
    const usersQuery = searchParams.get('q') || '';
    const [searchInput, setSearchInput] = useState(usersQuery);
    const [usersResp, setUsersResp] = useState(null);
    const [usersLoading, setUsersLoading] = useState(true);

    const loadUsers = React.useCallback(() => {
        setUsersLoading(true);
        const p = new URLSearchParams({ page: String(usersPage), limit: String(usersLimit), filter: usersFilter });
        if (usersQuery) p.set('search', usersQuery);
        get(`/bot/users?${p}`).then(setUsersResp).catch(() => {}).finally(() => setUsersLoading(false));
    }, [usersPage, usersLimit, usersFilter, usersQuery]);
    useEffect(() => { loadUsers(); }, [loadUsers]);

    // Поиск с задержкой: не дёргаем сервер на каждое нажатие
    useEffect(() => {
        const tm = setTimeout(() => {
            const p = new URLSearchParams(searchParams);
            if (searchInput) p.set('q', searchInput); else p.delete('q');
            p.delete('page'); // новый поиск — с первой страницы
            setSearchParams(p, { replace: true });
        }, 350);
        return () => clearTimeout(tm);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [searchInput]);

    const load = () => {
        get('/bot/status').then(setBotStatus).catch(() => setBotStatus({ running: false }));
        get('/bot/settings').then((d) => setSettings(d)).catch((e) => toast.error(e.message));
        get('/bot/tariffs').then((d) => setTariffs(d.tariffs)).catch(() => {});
        get('/bot/stats').then(setStats).catch(() => {});
    };
    useEffect(() => { load(); }, []);

    const saveSettings = async () => {
        try {
            await put('/bot/settings', settings);
            toast.success(t('bot.saved'));
            load();
        } catch (e) {
            toast.error(e.message);
        }
    };

    const saveTariff = async (tar) => {
        // Нормализация: пустые строки → null (без лимита)
        const payload = {
            ...tar,
            max_ips: tar.max_ips === '' || tar.max_ips == null ? null : Number(tar.max_ips),
            quota_gb: tar.quota_gb === '' || tar.quota_gb == null ? null : Number(tar.quota_gb),
        };
        try {
            if (payload.id) {
                await put(`/bot/tariffs/${payload.id}`, payload);
            } else {
                await post('/bot/tariffs', payload);
            }
            toast.success(t('bot.tariffSaved'));
            load();
        } catch (e) {
            toast.error(e.message);
        }
    };

    const deleteTariff = async (id) => {
        if (!confirm(t('bot.confirmDelTariff'))) return;
        try {
            await del(`/bot/tariffs/${id}`);
            load();
        } catch (e) {
            toast.error(e.message);
        }
    };

    const curName = (cur) => ({ RUB: t('bot.curRub'), USD: t('bot.curUsd'), USDT: t('bot.curUsdt') }[cur] || cur);

    /* ═══ Включение/выключение бота и сброс статистики ═══ */

    const toggleBot = async () => {
        const next = !settings.enabled;
        try {
            await put('/bot/settings', { enabled: next });
            toast.success(next ? t('bot.botOnToast') : t('bot.botOffToast'));
            load();
        } catch (e) { toast.error(e.message); }
    };

    const resetStats = async () => {
        if (!confirm(t('bot.confirmResetStats'))) return;
        try {
            await post('/bot/stats/reset');
            toast.success(t('bot.statsReset'));
            load();
        } catch (e) { toast.error(e.message); }
    };

    if (!settings || !tariffs) return <div className="space-y-4">{[...Array(3)].map((_, i) => <Skeleton key={i} className="h-48" />)}</div>;

    return (
        <div className="space-y-6">
            <PageHeader icon={<BotIcon size={20} />} title={t('bot.title')}
                        subtitle={t('bot.subtitle')}
                        actions={
                            <div className="flex items-center gap-2">
                                {/* Переключатель вынесен в шапку: включать и выключать
                                    бот приходится чаще всего, а раньше для этого нужно
                                    было открыть модалку и найти поле в списке. */}
                                <button className={settings.enabled ? 'btn-secondary !min-h-0 !px-3 !py-1.5 text-sm' : 'btn-primary !min-h-0 !px-3 !py-1.5 text-sm'}
                                        onClick={toggleBot}>
                                    <Power size={14} />
                                    {settings.enabled ? t('bot.btnDisable') : t('bot.btnEnable')}
                                </button>
                                <span className={botStatus?.running ? 'badge-green' : 'badge-red'}>
                                    {botStatus?.running ? t('bot.running') : t('bot.stopped')}
                                </span>
                            </div>
                        } />

            {/* Без токена бот не заработает — говорим об этом сразу, а не заставляем
                искать «не задан» в самом низу списка настроек. */}
            {!settings.bot_token && (
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-300 dark:border-amber-700/60 bg-amber-50 dark:bg-amber-950/30 px-4 py-3">
                    <div className="flex items-start gap-2 text-sm text-amber-900 dark:text-amber-200">
                        <BotIcon size={18} className="mt-0.5 shrink-0" />
                        <span>{t('bot.noTokenWarn')}</span>
                    </div>
                    <button className="btn-secondary !min-h-0 !px-3 !py-1.5 text-sm"
                            onClick={() => setEditCard('basic')}>
                        <Pencil size={14} /> {t('bot.setToken')}
                    </button>
                </div>
            )}

            {/* Статистика продаж */}
            {stats && (
                <div>
                    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                        <Card><div className="text-2xl font-bold">{stats.sales_total}</div><div className="text-sm text-slate-500">{t('bot.statSalesTotal')}</div></Card>
                        <Card><div className="text-2xl font-bold">{stats.sales_month}</div><div className="text-sm text-slate-500">{t('bot.statMonth')}</div></Card>
                        <Card><div className="text-2xl font-bold">{stats.revenue_month} ₽</div><div className="text-sm text-slate-500">{t('bot.statRevMonth')}</div></Card>
                        <Card><div className="text-2xl font-bold">{stats.revenue_total} ₽</div><div className="text-sm text-slate-500">{t('bot.statRevTotal')}</div></Card>
                    </div>
                    {/* Сброс статистики — разрушительное действие, поэтому живёт
                        отдельно от цифр, а не внутри плитки с доходом: там его
                        можно было нажать случайно, рядом с числом. */}
                    <div className="flex justify-end mt-2">
                        <button className="btn-ghost !min-h-0 !px-2 !py-1 text-xs text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40"
                                onClick={resetStats}>
                            <Trash2 size={13} /> {t('bot.resetSales')}
                        </button>
                    </div>
                </div>
            )}

            {/* ── Вкладки: пользователи / тарифы / настройки ── */}
            <div className="flex flex-wrap gap-2" role="tablist" aria-label={t('bot.tabsAria')}>
                {[
                    { id: 'users', icon: <UsersIcon size={15} aria-hidden="true" />, label: t('bot.tabUsers') },
                    { id: 'tariffs', icon: <Receipt size={15} aria-hidden="true" />, label: t('bot.tabTariffs') },
                    { id: 'settings', icon: <SlidersHorizontal size={15} aria-hidden="true" />, label: t('bot.tabSettings') },
                ].map((tb) => (
                    <button key={tb.id} role="tab" aria-selected={tab === tb.id}
                            className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-medium transition-colors
                                focus-visible:ring-2 focus-visible:ring-primary/60 outline-none
                                ${tab === tb.id ? 'bg-primary text-white shadow' : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'}`}
                            onClick={() => setTab(tb.id)}>
                        {tb.icon} {tb.label}
                    </button>
                ))}
            </div>

            {tab === 'users' && <>
            {/* ═══ Админка бота: пользователи Telegram ═══ */}
            <Card title={t('bot.usersTitle')}
                  subtitle={t('bot.usersSub')}
                  actions={
                      <button className="btn-secondary !min-h-0 !px-3 !py-1.5 text-sm" onClick={loadUsers}
                              aria-label={t('bot.refresh')}>
                          <RefreshCcw size={14} />
                      </button>
                  }>
                {/* Поиск + фильтры + счётчик */}
                <div className="flex flex-wrap items-center gap-2 mb-3">
                    <div className="relative flex-1 min-w-[230px]">
                        <Search size={15} aria-hidden="true"
                                className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                        <input type="search" className="input !pl-9" value={searchInput}
                               onChange={(e) => setSearchInput(e.target.value)}
                               placeholder={t('bot.searchPh')}
                               aria-label={t('bot.searchAria')}
                               autoComplete="off" spellCheck={false} />
                    </div>
                    <div className="flex flex-wrap gap-1.5" role="group" aria-label={t('bot.filterAria')}>
                        {[['all', t('bot.fAll')], ['proxies', t('bot.fProxies')], ['active', t('bot.fActive')],
                          ['noproxies', t('bot.fNoProxies')], ['balance', t('bot.fBalance')]].map(([id, label]) => (
                            <button key={id} aria-pressed={usersFilter === id}
                                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors outline-none
                                        focus-visible:ring-2 focus-visible:ring-primary/60
                                        ${usersFilter === id ? 'bg-primary text-white' : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'}`}
                                    onClick={() => setSearchParams((sp) => {
                                        const p = new URLSearchParams(sp);
                                        p.set('filter', id); p.delete('page');
                                        setSearchParams(p, { replace: true });
                                    })}>
                                {label}
                            </button>
                        ))}
                    </div>
                </div>
                <p className="text-xs text-slate-400 mb-2" aria-live="polite">
                    {t('bot.foundN', { n: usersResp?.total ?? 0 })}
                </p>
                {!usersLoading && (!usersResp || usersResp.users.length === 0) ? (
                    <p className="text-sm text-slate-500 py-6 text-center">
                        {usersQuery || usersFilter !== 'all' ? t('bot.searchEmpty') : t('bot.usersEmpty')}
                    </p>
                ) : (
                    <>
                    <div className="overflow-x-auto">
                    <table className="w-full text-sm min-w-[720px]">
                        <thead className="sticky top-0 z-10 bg-white dark:bg-slate-900">
                            <tr className="text-left text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-slate-700">
                                <th className="py-2 pr-4 font-medium sticky left-0 bg-white dark:bg-slate-900 z-20">{t('bot.thTgId')}</th>
                                <th className="py-2 pr-4 font-medium">{t('bot.thProxies')}</th>
                                <th className="py-2 pr-4 font-medium">{t('bot.thBalance')}</th>
                                <th className="py-2 pr-4 font-medium">{t('bot.thLastSeen')}</th>
                                <th className="py-2 pr-4 font-medium text-right">{t('common.actions')}</th>
                            </tr>
                        </thead>
                        <tbody>
                            {(usersResp?.users || []).map((u) => (
                                <React.Fragment key={u.telegram_id}>
                                    <tr className="border-b border-slate-100 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
                                        <td className="py-2 pr-4 sticky left-0 bg-white dark:bg-slate-900 z-[5]">
                                            <div className="flex flex-wrap items-center gap-2">
                                                <Avatar name={u.username || [u.first_name, u.last_name].filter(Boolean).join(' ') || String(u.telegram_id)} className="w-7 h-7 text-[11px]" />
                                                <button className="flex items-center gap-1 font-mono text-xs hover:text-primary transition-colors"
                                                        onClick={() => setExpanded(expanded === u.telegram_id ? null : u.telegram_id)}>
                                                    <ChevronDown size={14} className={`transition-transform ${expanded === u.telegram_id ? 'rotate-180' : ''}`} />
                                                    {u.telegram_id}
                                                </button>
                                                {u.username && (
                                                    <a className="text-xs text-primary hover:underline"
                                                       href={`https://t.me/${u.username}`} target="_blank" rel="noreferrer">
                                                        @{u.username}
                                                    </a>
                                                )}
                                                {!u.username && (u.first_name || u.last_name) && (
                                                    <span className="text-xs text-slate-400">
                                                        {[u.first_name, u.last_name].filter(Boolean).join(' ')}
                                                    </span>
                                                )}
                                            </div>
                                        </td>
                                        <td className="py-2 pr-4 tabular-nums">
                                            <span className="badge-green">{t('bot.activeN', { n: u.active_count })}</span>{' '}
                                            <span className="text-xs text-slate-400">{t('bot.totalN', { n: u.proxies_count })}</span>
                                        </td>
                                        <td className="py-2 pr-4 font-medium tabular-nums">{u.balance.toFixed(2)}</td>
                                        <td className="py-2 pr-4 text-xs text-slate-400">
                                            {u.seen_at ? formatDate(u.seen_at, lang).split(',')[0] : '—'}
                                        </td>
                                        <td className="py-2 pr-4">
                                            <div className="flex justify-end gap-1">
                                                <button className="btn-secondary !min-h-0 !px-2 !py-1.5 text-xs"
                                                        title={t('bot.issueTitleAttr')}
                                                        onClick={() => setIssueModal({ telegram_id: u.telegram_id, days: 30, protocols: 'both', max_ips: '', quota_gb: '' })}>
                                                    {t('bot.issueBtn')}
                                                </button>
                                                <button className="btn-secondary !min-h-0 !px-2 !py-1.5 text-xs"
                                                        title={t('bot.balanceTitleAttr')}
                                                        onClick={() => { setBalanceModal(u); setBalanceAmount(''); }}>
                                                    <Wallet size={14} /> {t('bot.balanceBtn')}
                                                </button>
                                                <button className="btn-secondary !min-h-0 !px-2 !py-1.5 text-xs"
                                                        title={t('bot.msgTitleAttr')}
                                                        onClick={() => { setMsgModal(u); setMsgText(''); }}>
                                                    <MessageSquare size={14} /> {t('bot.msgBtn')}
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                    {/* Раскрытый список прокси пользователя */}
                                    {expanded === u.telegram_id && (
                                        <tr className="border-b border-slate-100 dark:border-slate-800">
                                            <td colSpan={5} className="py-3 px-4 bg-slate-50 dark:bg-slate-800/50 rounded-lg">
                                                <table className="w-full text-xs">
                                                    <thead>
                                                        <tr className="text-left text-slate-400">
                                                            <th className="py-1 pr-4">{t('bot.subThProxy')}</th>
                                                            <th className="py-1 pr-4">{t('bot.subThStatus')}</th>
                                                            <th className="py-1 pr-4">{t('bot.subThUntil')}</th>
                                                            <th className="py-1">{t('bot.subThBalance')}</th>
                                                        </tr>
                                                    </thead>
                                                    <tbody>
                                                        {u.proxies.map((p) => (
                                                            <tr key={p.id}>
                                                                <td className="py-1 pr-4 font-mono">{p.username}</td>
                                                                <td className="py-1 pr-4"><StatusBadge status={p.status} /></td>
                                                                <td className="py-1 pr-4">{p.expires_at ? formatDate(p.expires_at, lang).split(',')[0] : t('common.infinity')}</td>
                                                                <td className="py-1">{(p.balance || 0).toFixed(2)}</td>
                                                            </tr>
                                                        ))}
                                                    </tbody>
                                                </table>
                                            </td>
                                        </tr>
                                    )}
                                </React.Fragment>
                            ))}
                        </tbody>
                    </table>
                    </div>
                    {/* Пагинация: страница, размер страницы, переходы */}
                    <div className="flex flex-wrap items-center justify-between gap-2 mt-3">
                        <span className="text-xs text-slate-500 tabular-nums" aria-live="polite">
                            {t('bot.pageOf', { page: usersResp?.page ?? 1, pages: usersResp?.pages ?? 1 })}
                        </span>
                        <div className="flex items-center gap-1.5">
                            <select className="input !w-auto !py-1.5 text-xs" value={usersLimit} aria-label={t('bot.perPage')}
                                    onChange={(e) => setSearchParams((sp) => {
                                        const p = new URLSearchParams(sp);
                                        p.set('limit', e.target.value); p.delete('page');
                                        setSearchParams(p, { replace: true });
                                    })}>
                                {[25, 50, 100].map((v) => <option key={v} value={v}>{v}</option>)}
                            </select>
                            <button className="btn-secondary !min-h-0 !p-2" aria-label={t('bot.prevPage')}
                                    disabled={(usersResp?.page ?? 1) <= 1}
                                    onClick={() => setSearchParams((sp) => {
                                        const p = new URLSearchParams(sp);
                                        p.set('page', String(usersPage - 1));
                                        setSearchParams(p, { replace: true });
                                    })}>
                                <ChevronLeft size={14} />
                            </button>
                            <span className="text-sm tabular-nums px-1">{usersResp?.page ?? 1} / {usersResp?.pages ?? 1}</span>
                            <button className="btn-secondary !min-h-0 !p-2" aria-label={t('bot.nextPage')}
                                    disabled={(usersResp?.page ?? 1) >= (usersResp?.pages ?? 1)}
                                    onClick={() => setSearchParams((sp) => {
                                        const p = new URLSearchParams(sp);
                                        p.set('page', String(usersPage + 1));
                                        setSearchParams(p, { replace: true });
                                    })}>
                                <ChevronRight size={14} />
                            </button>
                        </div>
                    </div>
                    </>
                )}
            </Card>
            </>}

            {/* Модал: выдать прокси пользователю */}
            <Modal open={!!issueModal} onClose={() => setIssueModal(null)}
                   title={t('bot.issueTitle', { id: issueModal?.telegram_id })}>
                <div className="grid grid-cols-2 gap-3">
                    <Field label={t('bot.fDays')}>
                        <input className="input" type="number" min="1" value={issueModal?.days ?? 30}
                               onChange={(e) => setIssueModal((m) => ({ ...m, days: e.target.value }))} />
                    </Field>
                    <Field label={t('bot.fProtocols')}>
                        <select className="input" value={issueModal?.protocols ?? 'both'}
                                onChange={(e) => setIssueModal((m) => ({ ...m, protocols: e.target.value }))}>
                            <option value="both">{t('bot.protoBoth')}</option>
                            <option value="web">{t('bot.protoWebOnly')}</option>
                            <option value="mtproto">{t('bot.protoMtprotoOnly')}</option>
                        </select>
                    </Field>
                    <Field label={t('bot.fMaxIp')} hint={t('bot.noLimitHint')}>
                        <input className="input" type="number" min="1" placeholder="∞" value={issueModal?.max_ips ?? ''}
                               onChange={(e) => setIssueModal((m) => ({ ...m, max_ips: e.target.value }))} />
                    </Field>
                    <Field label={t('bot.fQuotaGb')} hint={t('bot.noLimitHint')}>
                        <input className="input" type="number" min="0" placeholder="∞" value={issueModal?.quota_gb ?? ''}
                               onChange={(e) => setIssueModal((m) => ({ ...m, quota_gb: e.target.value }))} />
                    </Field>
                </div>
                <p className="text-xs text-slate-400 mt-3">
                    {t('bot.issueNote')}
                </p>
                <div className="flex justify-end gap-2 mt-4">
                    <button className="btn-secondary" onClick={() => setIssueModal(null)}>{t('common.cancel')}</button>
                    <button className="btn-primary" disabled={issueBusy}
                            onClick={async () => {
                                setIssueBusy(true);
                                try {
                                    const r = await post(`/bot/users/${issueModal.telegram_id}/issue`, {
                                        days: Number(issueModal.days),
                                        protocols: issueModal.protocols,
                                        max_ips: issueModal.max_ips === '' ? null : Number(issueModal.max_ips),
                                        quota_gb: issueModal.quota_gb === '' ? null : Number(issueModal.quota_gb),
                                    });
                                    toast.success(t('bot.issuedOk', { u: r.username }) + (r.notified ? t('bot.issuedNotified') : t('bot.issuedNoNotify')));
                                    setIssueModal(null);
                                    load();
                                } catch (e) { toast.error(e.message); }
                                finally { setIssueBusy(false); }
                            }}>
                        {t('bot.issueBtn')}
                    </button>
                </div>
            </Modal>

            {/* Модал: настройки (кастомные кнопки / основные / подписка / платежи) */}
            <Modal open={!!editCard} onClose={() => setEditCard(null)} wide
                   title={editCard === 'buttons' ? t('bot.modalButtons')
                       : editCard === 'basic' ? t('bot.modalBasic')
                       : editCard === 'sub' ? t('bot.modalSub')
                       : t('bot.modalPay')}>
                {editCard === 'buttons' && (
                    <div className="space-y-2">
                        {(settings.custom_buttons || []).map((b, i) => (
                            <div key={i} className="flex flex-wrap items-center gap-2 p-2 rounded-lg bg-slate-50 dark:bg-slate-800/50">
                                <input className="input !w-44" placeholder={t('bot.btnNamePh')}
                                       value={b.name}
                                       onChange={(e) => setSettings((s) => ({
                                           ...s,
                                           custom_buttons: s.custom_buttons.map((x, j) => j === i ? { ...x, name: e.target.value } : x),
                                       }))} />
                                <input className="input flex-1 min-w-[200px] font-mono text-xs" placeholder={t('bot.btnUrlPh')}
                                       value={b.url}
                                       onChange={(e) => setSettings((s) => ({
                                           ...s,
                                           custom_buttons: s.custom_buttons.map((x, j) => j === i ? { ...x, url: e.target.value } : x),
                                       }))} />
                                <Toggle label={t('common.on')} checked={b.enabled !== false}
                                        onChange={(v) => setSettings((s) => ({
                                            ...s,
                                            custom_buttons: s.custom_buttons.map((x, j) => j === i ? { ...x, enabled: v } : x),
                                        }))} />
                                <button className="btn-ghost !min-h-0 !p-2 text-red-500"
                                        onClick={() => setSettings((s) => ({
                                            ...s,
                                            custom_buttons: s.custom_buttons.filter((_, j) => j !== i),
                                        }))}>
                                    <Trash2 size={14} />
                                </button>
                            </div>
                        ))}
                        {!(settings.custom_buttons && settings.custom_buttons.length >= 8) && (
                            <button className="btn-secondary text-sm"
                                    onClick={() => setSettings((s) => ({
                                        ...s,
                                        custom_buttons: [...(s.custom_buttons || []), { name: '', url: 'https://', enabled: true }],
                                    }))}>
                                <Plus size={14} /> {t('bot.addBtn')}
                            </button>
                        )}
                    </div>
                )}

                {editCard === 'basic' && (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <Field label="Bot Token" hint={t('bot.fBotTokenHint')}>
                            <input className="input font-mono" value={settings.bot_token ?? ''}
                                   onChange={(e) => setSettings({ ...settings, bot_token: e.target.value })} />
                        </Field>
                        <Field label={t('bot.fCurrency')}>
                            <select className="input" value={settings.currency ?? 'RUB'}
                                    onChange={(e) => setSettings({ ...settings, currency: e.target.value })}>
                                <option value="RUB">{t('bot.curRub')}</option>
                                <option value="USD">{t('bot.curUsd')}</option>
                                <option value="USDT">{t('bot.curUsdt')}</option>
                            </select>
                        </Field>
                        <Field label={t('bot.fWelcome')} hint={t('bot.fWelcomeHint')}>
                            <textarea className="input min-h-[100px]" value={settings.welcome_text ?? ''}
                                      onChange={(e) => setSettings({ ...settings, welcome_text: e.target.value })} />
                        </Field>
                        <Field label={t('bot.fStatusUrl')}
                               hint={t('bot.fStatusUrlHint')}>
                            <input className="input font-mono" placeholder={t('bot.statusUrlPh')}
                                   value={settings.status_url ?? ''}
                                   onChange={(e) => setSettings({ ...settings, status_url: e.target.value })} />
                        </Field>
                        <div className="space-y-3 md:col-span-2">
                            <Toggle label={t('bot.tBotOn')} checked={!!settings.enabled}
                                    onChange={(v) => setSettings({ ...settings, enabled: v })} />
                            <Toggle label={t('bot.tNotify')} checked={!!settings.notify_admin}
                                    onChange={(v) => setSettings({ ...settings, notify_admin: v })} />
                        </div>
                    </div>
                )}

                {editCard === 'sub' && (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <Field label={t('bot.fChannel')} hint={t('bot.fChannelHint')}>
                            <input className="input font-mono" placeholder="@my_proxy_channel"
                                   value={settings.channel_username ?? ''}
                                   onChange={(e) => setSettings({ ...settings, channel_username: e.target.value })} />
                        </Field>
                        <div className="flex items-end pb-2">
                            <Toggle label={t('bot.tChannelReq')}
                                    checked={!!settings.channel_required}
                                    onChange={(v) => setSettings({ ...settings, channel_required: v })} />
                        </div>
                        <p className="text-xs text-slate-400 md:col-span-2">
                            {t('bot.channelWarn')}
                        </p>
                    </div>
                )}

                {editCard === 'pay' && (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <Field label={t('bot.fCrypto')} hint={t('bot.fCryptoHint')}>
                            <input className="input font-mono" value={settings.cryptobot_token ?? ''}
                                   onChange={(e) => setSettings({ ...settings, cryptobot_token: e.target.value })} />
                        </Field>
                        <div />
                        <Field label={t('bot.fYkShop')}>
                            <input className="input font-mono" value={settings.yookassa_shop_id ?? ''}
                                   onChange={(e) => setSettings({ ...settings, yookassa_shop_id: e.target.value })} />
                        </Field>
                        <Field label={t('bot.fYkSecret')}>
                            <input className="input font-mono" type="password" value={settings.yookassa_secret_key ?? ''}
                                   onChange={(e) => setSettings({ ...settings, yookassa_secret_key: e.target.value })} />
                        </Field>
                        <Field label={t('bot.fPayCard')} hint={t('bot.fPayCardHint')}>
                            <input className="input font-mono" value={settings.pay_card ?? ''}
                                   onChange={(e) => setSettings({ ...settings, pay_card: e.target.value })} />
                        </Field>
                        <Field label={t('bot.fPayPhone')}>
                            <input className="input font-mono" value={settings.pay_phone ?? ''}
                                   onChange={(e) => setSettings({ ...settings, pay_phone: e.target.value })} />
                        </Field>
                        <Field label={t('bot.fPayBank')}>
                            <input className="input" value={settings.pay_bank ?? ''}
                                   onChange={(e) => setSettings({ ...settings, pay_bank: e.target.value })} />
                        </Field>
                        <Field label={t('bot.fPayInstr')} hint={t('bot.fPayInstrHint')} className="md:col-span-2">
                            <textarea className="input min-h-[70px]" value={settings.payment_instructions ?? ''}
                                      onChange={(e) => setSettings({ ...settings, payment_instructions: e.target.value })} />
                        </Field>
                        <div className="flex items-end pb-2">
                            <Toggle label={t('bot.tStars')}
                                    checked={!!settings.stars_enabled}
                                    onChange={(v) => setSettings({ ...settings, stars_enabled: v })} />
                        </div>
                        <div />
                        <Field label={t('bot.fStarsRub')} hint={t('bot.fStarsRubHint')}>
                            <input className="input" type="number" step="0.01" min="0.01" value={settings.stars_rate_rub ?? 2}
                                   onChange={(e) => setSettings({ ...settings, stars_rate_rub: Number(e.target.value) })} />
                        </Field>
                        <Field label={t('bot.fStarsUsd')} hint={t('bot.fStarsUsdHint')}>
                            <input className="input" type="number" step="0.001" min="0.001" value={settings.stars_rate_usd ?? 0.02}
                                   onChange={(e) => setSettings({ ...settings, stars_rate_usd: Number(e.target.value) })} />
                        </Field>
                        <p className="text-xs text-slate-400 md:col-span-2">
                            {t('bot.payWh1')} <code className="font-mono">{t('bot.whCryptoUrl')}</code>
                            {t('bot.payWh2')} <code className="font-mono">/api/payments/webhook/yookassa</code>.
                            {t('bot.payWh3')} <code className="font-mono">curl -I https://pay.crypt.bot</code> {t('bot.payWh4')}
                        </p>
                    </div>
                )}

                <div className="flex justify-end gap-2 mt-4">
                    <button className="btn-secondary" onClick={() => setEditCard(null)}>{t('common.cancel')}</button>
                    <button className="btn-primary"
                            onClick={async () => {
                                try {
                                    await saveSettings();
                                    setEditCard(null);
                                } catch { /* ошибка уже показана тостом */ }
                            }}>
                        <Save size={14} /> {t('common.save')}
                    </button>
                </div>
            </Modal>

            <Modal open={!!balanceModal} onClose={() => setBalanceModal(null)}
                   title={t('bot.balanceTitle', { id: balanceModal?.telegram_id })}>
                <Field label={t('bot.fAmount')} hint={t('bot.fAmountHint')}>
                    <input className="input" type="number" value={balanceAmount}
                           onChange={(e) => setBalanceAmount(e.target.value)} autoFocus />
                </Field>
                <div className="flex justify-end gap-2 mt-4">
                    <button className="btn-secondary" onClick={() => setBalanceModal(null)}>{t('common.cancel')}</button>
                    <button className="btn-primary" disabled={!balanceAmount}
                            onClick={async () => {
                                try {
                                    await post(`/bot/users/${balanceModal.telegram_id}/balance`, { amount: Number(balanceAmount) });
                                    toast.success(t('bot.balanceChanged'));
                                    setBalanceModal(null);
                                    load();
                                } catch (e) { toast.error(e.message); }
                            }}>
                        {t('bot.apply')}
                    </button>
                </div>
            </Modal>

            {/* Модал: написать пользователю через бота */}
            <Modal open={!!msgModal} onClose={() => setMsgModal(null)}
                   title={t('bot.msgTitle', { id: msgModal?.telegram_id })}>
                <Field label={t('bot.fMsgText')}>
                    <textarea className="input min-h-[100px]" value={msgText}
                              onChange={(e) => setMsgText(e.target.value)} autoFocus />
                </Field>
                <div className="flex justify-end gap-2 mt-4">
                    <button className="btn-secondary" onClick={() => setMsgModal(null)}>{t('common.cancel')}</button>
                    <button className="btn-primary" disabled={!msgText.trim()}
                            onClick={async () => {
                                try {
                                    await post(`/bot/users/${msgModal.telegram_id}/message`, { text: msgText });
                                    toast.success(t('bot.msgSent'));
                                    setMsgModal(null);
                                } catch (e) { toast.error(e.message); }
                            }}>
                        {t('common.send')}
                    </button>
                </div>
            </Modal>

            {tab === 'settings' && <>
            <div className="flex flex-wrap gap-2 mb-1" role="tablist" aria-label={t('bot.tabsAria')}>
                <span className="text-sm text-slate-500">{t('bot.settingsHint')}</span>
            </div>
            {/* Кастомные кнопки в боте: сводка + модалка */}
            <Card title={t('bot.buttonsTitle')}
                  subtitle={t('bot.buttonsSub')}
                  actions={
                      <button className="btn-ghost !min-h-0 !p-2" title={t('bot.editButtons')}
                              onClick={() => setEditCard('buttons')}>
                          <Pencil size={16} />
                      </button>
                  }>
                {!settings ? <Skeleton className="h-20" /> : (settings.custom_buttons || []).length === 0 ? (
                    <p className="text-sm text-slate-500 py-2">{t('bot.buttonsEmpty')}</p>
                ) : (
                    <div className="space-y-2">
                        {(settings.custom_buttons || []).map((b, i) => (
                            <div key={i} className="flex flex-wrap items-center gap-2 p-2 rounded-lg bg-slate-50 dark:bg-slate-800/50">
                                <span className="font-medium text-sm">{b.name || t('bot.noName')}</span>
                                <span className="font-mono text-xs text-slate-400 break-all">{b.url}</span>
                                <span className={b.enabled !== false ? 'badge-green' : 'badge-red'}>
                                    {b.enabled !== false ? t('common.on') : t('common.off')}
                                </span>
                            </div>
                        ))}
                    </div>
                )}
            </Card>

            {/* Основные настройки: сводка + модалка */}
            <Card title={t('bot.basicTitle')} actions={
                <button className="btn-ghost !min-h-0 !p-2" title={t('common.edit')}
                        onClick={() => setEditCard('basic')}>
                    <Pencil size={16} />
                </button>
            }>
                <div>
                    {settingRow('Bot Token', settings.bot_token || t('bot.notSet'))}
                    {settingRow(t('bot.rowCurrency'), curName(settings.currency) || settings.currency)}
                    {settingRow(t('bot.rowWelcome'), settings.welcome_text ? `${String(settings.welcome_text).slice(0, 60)}…` : t('bot.builtin'))}
                    {settingRow(t('bot.rowStatusUrl'), settings.status_url || t('bot.none'))}
                    {/* Статус бота вынесен в шапку страницы переключателем, здесь
                        он только повторялся и путал с состоянием процесса. */}
                    {settingRow(t('bot.rowNotify'), settings.notify_admin ? t('bot.yes') : t('bot.no'))}
                </div>
            </Card>

            {/* Обязательная подписка на канал: сводка + модалка */}
            <Card title={t('bot.subTitle')}
                  subtitle={t('bot.subSub')}
                  actions={
                      <button className="btn-ghost !min-h-0 !p-2" title={t('common.edit')}
                              onClick={() => setEditCard('sub')}>
                          <Pencil size={16} />
                      </button>
                  }>
                <div>
                    {settingRow(t('bot.rowChannel'), settings.channel_username || t('bot.notSet'))}
                    {settingRow(t('bot.rowChannelReq'), settings.channel_required ? t('bot.yes') : t('bot.no'))}
                </div>
            </Card>

            {/* Платёжные системы: сводка + модалка */}
            <Card title={t('bot.payTitle')}
                  subtitle={t('bot.paySub')}
                  actions={
                      <button className="btn-ghost !min-h-0 !p-2" title={t('common.edit')}
                              onClick={() => setEditCard('pay')}>
                          <Pencil size={16} />
                      </button>
                  }>
                <div>
                    {settingRow(t('bot.rowCrypto'), settings.cryptobot_token ? t('bot.configured') : t('bot.notConfigured'))}
                    {settingRow(t('bot.rowYk'), (settings.yookassa_shop_id && settings.yookassa_secret_key) ? t('bot.configuredF') : t('bot.notConfiguredF'))}
                    {settingRow(t('bot.rowPayCard'), settings.pay_card || t('bot.notSetF'))}
                    {settingRow(t('bot.rowStars'), settings.stars_enabled
                        ? t('bot.starsOn', { rub: settings.stars_rate_rub ?? 2, usd: settings.stars_rate_usd ?? 0.02 })
                        : t('bot.starsOff'))}
                </div>
            </Card>

            </>}
            {tab === 'tariffs' && <>
            {/* Тарифы: компактный список + модалка редактирования */}
            <Card title={t('bot.tariffsTitle')} actions={
                <button className="btn-secondary !min-h-0 !px-3 !py-1.5 text-sm"
                        onClick={() => setTariffModal({ name: '', days: 30, price: 100, protocols: 'both', max_ips: null, quota_gb: null, enabled: 1 })}>
                    <Plus size={14} /> {t('common.add')}
                </button>
            }>
                <div className="space-y-2">
                    {tariffs.map((tar) => {
                        const cur = settings.currency ?? 'RUB';
                        const sign = cur === 'RUB' ? '₽' : cur === 'USD' ? '$' : cur === 'USDT' ? '₮' : cur;
                        const protoLabel = tar.protocols === 'web' ? t('bot.protoWeb')
                            : tar.protocols === 'mtproto' ? t('bot.protoMtproto') : t('bot.protoBothLabel');
                        const limits = `${tar.max_ips ? t('bot.limitsIp', { n: tar.max_ips }) : t('bot.limitsIpInf')} · ${tar.quota_gb ? t('bot.limitsGb', { n: tar.quota_gb }) : t('bot.limitsGbInf')}`;
                        const accent = !tar.enabled ? 'border-slate-600'
                            : tar.protocols === 'web' ? 'border-sky-500'
                            : tar.protocols === 'mtproto' ? 'border-violet-500' : 'border-emerald-500';
                        return (
                            <div key={tar.id ?? tar.name}
                                 className={`flex flex-wrap items-center gap-3 p-3 rounded-xl border-l-4 ${accent} bg-slate-50 dark:bg-slate-800/50 ${tar.enabled ? '' : 'opacity-60'}`}>
                                <div className="flex-1 min-w-[180px]">
                                    <div className="font-medium">{tar.name || t('bot.noName')}</div>
                                    <div className="text-xs text-slate-400">
                                        {t('bot.daysN', { n: tar.days })} · <b className="text-slate-700 dark:text-slate-200">{tar.price} {sign}</b> · {protoLabel} · {limits}
                                    </div>
                                </div>
                                <Toggle label={t('common.on')} checked={!!tar.enabled}
                                        onChange={(v) => toggleTariff(tar, v)} />
                                <div className="flex gap-1">
                                    <button className="btn-ghost !min-h-0 !p-2" title={t('bot.editTariff')}
                                            onClick={() => setTariffModal({ ...tar })}>
                                        <Pencil size={16} />
                                    </button>
                                    {tar.id && (
                                        <button className="btn-ghost !min-h-0 !p-2 text-red-500" title={t('common.delete')}
                                                onClick={() => deleteTariff(tar.id)}>
                                            <Trash2 size={16} />
                                        </button>
                                    )}
                                </div>
                            </div>
                        );
                    })}
                    {tariffs.length === 0 && <p className="text-sm text-slate-500 text-center py-4">{t('bot.tariffsEmpty')}</p>}
                </div>
            </Card>

            </>}
            {/* Модал: создание/редактирование тарифа */}
            <Modal open={!!tariffModal} onClose={() => setTariffModal(null)}
                   title={tariffModal?.id ? t('bot.editTariffTitle') : t('bot.newTariff')}>
                {tariffModal && (() => {
                    const cur = settings.currency ?? 'RUB';
                    const sign = cur === 'RUB' ? '₽' : cur === 'USD' ? '$' : cur === 'USDT' ? '₮' : cur;
                    const protoLabel = tariffModal.protocols === 'web' ? 'Web Proxy'
                        : tariffModal.protocols === 'mtproto' ? 'MTProto' : 'Web Proxy + MTProto';
                    const upd = (patch) => setTariffModal((m) => ({ ...m, ...patch }));
                    return (
                        <>
                            <div className="grid grid-cols-2 gap-3">
                                <Field label={t('bot.fTName')} hint={t('bot.fTNameHint')} className="col-span-2">
                                    <input className="input" value={tariffModal.name ?? ''}
                                           onChange={(e) => upd({ name: e.target.value })} />
                                </Field>
                                <Field label={t('bot.fTDays')}>
                                    <input className="input" type="number" min="1" value={tariffModal.days ?? 30}
                                           onChange={(e) => upd({ days: Number(e.target.value) })} />
                                </Field>
                                <Field label={t('bot.fTPrice', { sign })}>
                                    <input className="input" type="number" min="0" value={tariffModal.price ?? 0}
                                           onChange={(e) => upd({ price: Number(e.target.value) })} />
                                </Field>
                                <Field label={t('bot.fTProto')}>
                                    <select className="input" value={tariffModal.protocols ?? 'both'}
                                            onChange={(e) => upd({ protocols: e.target.value })}>
                                        <option value="both">{t('bot.protoBothShort')}</option>
                                        <option value="web">Web Proxy</option>
                                        <option value="mtproto">MTProto</option>
                                    </select>
                                </Field>
                                <Field label={t('bot.fTMaxIp')} hint={t('bot.infHint')}>
                                    <input className="input" type="number" min="1" value={tariffModal.max_ips ?? ''}
                                           onChange={(e) => upd({ max_ips: e.target.value === '' ? null : Number(e.target.value) })} />
                                </Field>
                                <Field label={t('bot.fTQuota')} hint={t('bot.infHint')}>
                                    <input className="input" type="number" min="0" value={tariffModal.quota_gb ?? ''}
                                           onChange={(e) => upd({ quota_gb: e.target.value === '' ? null : Number(e.target.value) })} />
                                </Field>
                                <div className="flex items-end pb-1">
                                    <Toggle label={t('bot.tEnabled')} checked={!!tariffModal.enabled}
                                            onChange={(v) => upd({ enabled: v ? 1 : 0 })} />
                                </div>
                            </div>
                            <p className="text-xs text-slate-400 mt-3">
                                {t('bot.previewSees')} <b className="text-slate-700 dark:text-slate-200">{tariffModal.name || '—'} — {t('bot.daysN', { n: tariffModal.days })} — {tariffModal.price} {sign}</b> · {protoLabel}
                            </p>
                            <div className="flex justify-end gap-2 mt-4">
                                <button className="btn-secondary" onClick={() => setTariffModal(null)}>{t('common.cancel')}</button>
                                <button className="btn-primary"
                                        onClick={async () => {
                                            try {
                                                await saveTariff(tariffModal);
                                                setTariffModal(null);
                                            } catch { /* ошибка уже показана тостом */ }
                                        }}>
                                    <Save size={14} /> {t('common.save')}
                                </button>
                            </div>
                        </>
                    );
                })()}
            </Modal>
        </div>
    );
}
