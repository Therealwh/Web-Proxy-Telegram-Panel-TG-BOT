// Тикеты поддержки: список обращений + диалог с клиентом
import React, { useEffect, useRef, useState } from 'react';
import { MessageSquare, RefreshCcw, Send, Check, ChevronLeft, Search, Ban } from 'lucide-react';
import { get, post } from '../api';
import { toast, useLangStore } from '../store';
import { useT } from '../i18n';
import { Card, PageHeader, Skeleton, Avatar, StatusBadge, formatDate } from '../components/ui';

function statusBadge(st, t) {
    if (st === 'open') return <span className="badge-yellow">{t('tickets.stWaiting')}</span>;
    if (st === 'answered') return <span className="badge-blue">{t('tickets.stAnswered')}</span>;
    return <span className="badge-red">{t('tickets.stClosed')}</span>;
}

export default function Tickets() {
    const [list, setList] = useState(null);
    const [openId, setOpenId] = useState(null);
    const [dialog, setDialog] = useState(null); // {ticket, messages}
    const [reply, setReply] = useState('');
    const [sending, setSending] = useState(false);
    const [search, setSearch] = useState('');
    const [statusFilter, setStatusFilter] = useState('');
    const lang = useLangStore((s) => s.lang);
    const t = useT();
    const dialogEnd = useRef(null);

    const load = () => {
        const p = new URLSearchParams();
        if (search) p.set('search', search);
        if (statusFilter) p.set('status', statusFilter);
        get(`/tickets?${p}`).then((d) => setList(d.tickets)).catch(() => {});
    };
    useEffect(() => { load(); }, [search, statusFilter]);

    const openDialog = async (id) => {
        try {
            const d = await get(`/tickets/${id}/messages`);
            setOpenId(id);
            setDialog(d);
            setReply('');
            setTimeout(() => dialogEnd.current?.scrollIntoView({ behavior: 'smooth' }), 100);
        } catch (e) { toast.error(e.message); }
    };

    // Автообновление списка и открытого диалога (30 сек) — видно новые сообщения клиента
    useEffect(() => {
        const tm = setInterval(() => {
            load();
            if (openId) {
                get(`/tickets/${openId}/messages`).then((d) => {
                    setDialog((prev) => (prev && prev.ticket.id === openId ? d : prev));
                }).catch(() => {});
            }
        }, 30000);
        return () => clearInterval(tm);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [openId]);

    const send = async () => {
        if (!reply.trim() || !dialog) return;
        setSending(true);
        try {
            await post(`/tickets/${dialog.ticket.id}/reply`, { text: reply });
            toast.success(t('tickets.sent'));
            const d = await get(`/tickets/${dialog.ticket.id}/messages`);
            setDialog(d);
            setReply('');
            load();
            setTimeout(() => dialogEnd.current?.scrollIntoView({ behavior: 'smooth' }), 100);
        } catch (e) { toast.error(e.message); } finally { setSending(false); }
    };

    const closeTicket = async (id) => {
        if (!window.confirm(t('tickets.closeConfirm', { id }))) return;
        try {
            await post(`/tickets/${id}/close`);
            toast.success(t('tickets.closed'));
            if (openId === id) { setOpenId(null); setDialog(null); }
            load();
        } catch (e) { toast.error(e.message); }
    };

    const userName = (t) => t.username ? `@${t.username}` : ([t.first_name, t.last_name].filter(Boolean).join(' ') || `tg${t.telegram_id}`);

    return (
        <div className="space-y-4">
            <PageHeader icon={<MessageSquare size={20} />} title={t('tickets.title')}
                        subtitle={t('tickets.subtitle')}
                        actions={
                            <button className="btn-secondary !min-h-0 !px-3 !py-1.5 text-sm" onClick={load} aria-label={t('events.refresh')}>
                                <RefreshCcw size={14} />
                            </button>
                        } />

            <div className="grid lg:grid-cols-[380px_1fr] gap-4 items-start">
                {/* Список обращений */}
                <Card title={t('tickets.listTitle')} className="!p-0 overflow-hidden">
                    <div className="p-3 space-y-2 border-b border-slate-200 dark:border-slate-800">
                        <div className="relative">
                            <Search size={15} aria-hidden="true" className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                            <input type="search" className="input !pl-9" value={search}
                                   onChange={(e) => setSearch(e.target.value)}
                                   placeholder={t('tickets.searchPh')} aria-label={t('tickets.searchAria')}
                                   autoComplete="off" spellCheck={false} />
                        </div>
                        <div className="flex flex-wrap gap-1.5" role="group" aria-label={t('tickets.filterAria')}>
                            {[['', t('tickets.fAll')], ['open', t('tickets.stWaiting')], ['answered', t('tickets.stAnswered')], ['closed', t('tickets.fClosed')]].map(([id, label]) => (
                                <button key={id || 'all'} aria-pressed={statusFilter === id}
                                        className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-primary/60
                                            ${statusFilter === id ? 'bg-primary text-white' : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'}`}
                                        onClick={() => setStatusFilter(id)}>
                                    {label}
                                </button>
                            ))}
                        </div>
                    </div>
                    {!list ? (
                        <div className="space-y-2 p-3">{[...Array(4)].map((_, i) => <Skeleton key={i} className="h-14" />)}</div>
                    ) : list.length === 0 ? (
                        <p className="text-sm text-slate-500 py-8 text-center">{t('tickets.empty')}</p>
                    ) : (
                        <ul className="divide-y divide-slate-100 dark:divide-slate-800 max-h-[65vh] overflow-y-auto">
                            {list.map((tk) => (
                                <li key={tk.id}>
                                    <button className={`w-full text-left px-4 py-3 hover:bg-slate-50 dark:hover:bg-slate-800/60 transition-colors
                                            ${openId === tk.id ? 'bg-primary/5' : ''}`}
                                            onClick={() => openDialog(tk.id)}>
                                        <div className="flex items-center gap-2">
                                            <Avatar name={userName(tk)} className="w-7 h-7 text-[11px]" />
                                            <span className="text-xs font-mono text-slate-400">#{tk.id}</span>
                                            <span className="text-sm font-medium truncate min-w-0 flex-1">{userName(tk)}</span>
                                            {statusBadge(tk.status, t)}
                                        </div>
                                        <div className="text-xs text-slate-500 truncate min-w-0 mt-1">
                                            {tk.last_message || tk.subject || '—'}
                                        </div>
                                        <div className="text-[11px] text-slate-400 mt-0.5 tabular-nums">
                                            {formatDate(tk.updated_at, lang).split(',')[0]} · {t('tickets.msgsN', { n: tk.messages_count })}
                                        </div>
                                    </button>
                                </li>
                            ))}
                        </ul>
                    )}
                </Card>

                {/* Диалог */}
                {dialog && dialog.ticket ? (
                    <Card className="!p-0 overflow-hidden">
                        <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 border-b border-slate-200 dark:border-slate-800">
                            <div className="flex items-center gap-2 min-w-0">
                                <button className="btn-ghost !min-h-0 !p-1.5 lg:hidden" aria-label={t('tickets.back')}
                                        onClick={() => { setOpenId(null); setDialog(null); }}>
                                    <ChevronLeft size={16} />
                                </button>
                                <Avatar name={userName(dialog.ticket)} className="w-8 h-8 text-[11px]" />
                                <div className="min-w-0">
                                    <div className="text-sm font-semibold truncate">{userName(dialog.ticket)}</div>
                                    <div className="text-[11px] text-slate-400 font-mono">tg{dialog.ticket.telegram_id} · #{dialog.ticket.id}</div>
                                </div>
                            </div>
                            <div className="flex items-center gap-2">
                                {statusBadge(dialog.ticket.status, t)}
                                {dialog.ticket.status !== 'closed' && (
                                    <button className="btn-secondary !min-h-0 !px-2.5 !py-1.5 text-xs"
                                            onClick={() => closeTicket(dialog.ticket.id)}>
                                        <Ban size={13} /> {t('tickets.closeBtn')}
                                    </button>
                                )}
                            </div>
                        </div>

                        <div className="p-4 space-y-2.5 max-h-[55vh] overflow-y-auto bg-slate-50/50 dark:bg-slate-950/40">
                            {dialog.messages.map((m) => (
                                <div key={m.id} className={`flex ${m.sender === 'admin' ? 'justify-end' : 'justify-start'}`}>
                                    <div className={`max-w-[80%] rounded-2xl px-3.5 py-2 text-sm
                                            ${m.sender === 'admin'
                                                ? 'bg-primary text-white rounded-br-md'
                                                : 'bg-slate-100 dark:bg-slate-800 rounded-bl-md'}`}>
                                        <div className="whitespace-pre-wrap break-words">{m.text}</div>
                                        <div className={`text-[10px] mt-1 tabular-nums ${m.sender === 'admin' ? 'text-white/70' : 'text-slate-400'}`}>
                                            {formatDate(m.created_at, lang).split(',')[1] || formatDate(m.created_at, lang)}
                                        </div>
                                    </div>
                                </div>
                            ))}
                            <div ref={dialogEnd} />
                        </div>

                        {dialog.ticket.status !== 'closed' ? (
                            <div className="p-3 border-t border-slate-200 dark:border-slate-800">
                                <div className="flex gap-2">
                                    <textarea className="input min-h-[52px] flex-1" rows={1} value={reply}
                                              onChange={(e) => setReply(e.target.value)}
                                              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
                                              placeholder={t('tickets.replyPh')} aria-label={t('tickets.replyAria')} />
                                    <button className="btn-primary !px-3.5" disabled={sending || !reply.trim()}
                                            onClick={send} aria-label={t('tickets.sendAria')}>
                                        <Send size={16} />
                                    </button>
                                </div>
                                <p className="text-[11px] text-slate-400 mt-1.5">{t('tickets.replyNote')}</p>
                            </div>
                        ) : (
                            <div className="p-3 border-t border-slate-200 dark:border-slate-800 text-center text-xs text-slate-400">
                                {t('tickets.closedNote')}
                            </div>
                        )}
                    </Card>
                ) : (
                    <Card className="hidden lg:flex items-center justify-center min-h-[300px]">
                        <p className="text-sm text-slate-400">{t('tickets.selectHint')}</p>
                    </Card>
                )}
            </div>
        </div>
    );
}
