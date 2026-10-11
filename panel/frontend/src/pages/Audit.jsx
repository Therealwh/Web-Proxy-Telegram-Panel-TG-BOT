// Журнал действий администраторов (audit_log)
import React, { useEffect, useState } from 'react';
import { ScrollText, Download, RefreshCw } from 'lucide-react';
import { get } from '../api';
import { toast, useLangStore } from '../store';
import { useT } from '../i18n';
import { Card, Skeleton, PageHeader, formatDate } from '../components/ui';

const PAGE_SIZE = 50;

export default function Audit() {
    const [data, setData] = useState(null);
    const [page, setPage] = useState(1);
    const [filters, setFilters] = useState({ admin: '', action: '', search: '' });
    const lang = useLangStore((s) => s.lang);
    const t = useT();

    useEffect(() => {
        const q = new URLSearchParams({ page: String(page), limit: String(PAGE_SIZE) });
        for (const [k, v] of Object.entries(filters)) if (v.trim()) q.set(k, v.trim());
        setData(null);
        get(`/audit?${q.toString()}`).then(setData).catch((e) => toast.error(e.message));
    }, [page, filters]);

    // Debounce на текстовом поиске, чтобы не дёргать API на каждую букву
    const [search, setSearch] = useState('');
    useEffect(() => {
        const timer = setTimeout(() => setFilters((f) => (f.search === search ? f : { ...f, search })), 300);
        return () => clearTimeout(timer);
    }, [search]);

    const exportCsv = () => {
        const q = new URLSearchParams();
        for (const [k, v] of Object.entries(filters)) if (v.trim()) q.set(k, v.trim());
        window.location.href = `/api/audit/export?${q.toString()}`;
    };

    const entries = data?.entries;
    const total = data?.total || 0;
    const admins = data?.admins || [];
    const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

    return (
        <div className="space-y-4">
            <PageHeader icon={<ScrollText size={20} />} title={t('audit.title')}
                        subtitle={t('audit.subtitle')}
                        actions={
                            <div className="flex gap-2">
                                <button className="btn-secondary" onClick={exportCsv}>
                                    <Download size={16} /> {t('audit.exportBtn')}
                                </button>
                                <button className="btn-secondary" onClick={() => setPage(1)}>
                                    <RefreshCw size={16} />
                                </button>
                            </div>
                        } />

            <Card>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <select className="input" value={filters.admin} onChange={(e) => { setPage(1); setFilters({ ...filters, admin: e.target.value }); }}>
                        <option value="">{t('audit.allAdmins')}</option>
                        {admins.map((a) => <option key={a} value={a}>{a}</option>)}
                    </select>
                    <select className="input" value={filters.action} onChange={(e) => { setPage(1); setFilters({ ...filters, action: e.target.value }); }}>
                        <option value="">{t('audit.allActions')}</option>
                        {['POST', 'PUT', 'PATCH', 'DELETE'].map((m) => (
                            <option key={m} value={m}>{t('audit.action', { m })}</option>
                        ))}
                    </select>
                    <input className="input" value={search} placeholder={t('audit.searchPlaceholder')}
                           onChange={(e) => setSearch(e.target.value)} />
                </div>
            </Card>

            <Card className="!p-0 overflow-x-auto">
                {!entries ? <div className="p-5"><Skeleton className="h-32" /></div> : entries.length === 0 ? (
                    <p className="p-8 text-center text-slate-500">{t('audit.empty')}</p>
                ) : (
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="text-left text-slate-500 border-b border-slate-200 dark:border-slate-700">
                                <th className="px-4 py-3 font-medium">{t('audit.thTime')}</th>
                                <th className="px-4 py-3 font-medium">{t('audit.thAdmin')}</th>
                                <th className="px-4 py-3 font-medium">{t('audit.thAction')}</th>
                                <th className="px-4 py-3 font-medium">{t('audit.thDetails')}</th>
                                <th className="px-4 py-3 font-medium">{t('audit.thIp')}</th>
                            </tr>
                        </thead>
                        <tbody>
                            {entries.map((e) => (
                                <tr key={e.id} className="border-b border-slate-100 dark:border-slate-800 align-top">
                                    <td className="px-4 py-3 text-slate-500 whitespace-nowrap">
                                        {formatDate(e.created_at, lang)}
                                    </td>
                                    <td className="px-4 py-3 font-medium">{e.admin}</td>
                                    <td className="px-4 py-3 font-mono text-xs">{e.action}</td>
                                    <td className="px-4 py-3">
                                        <code className="text-[11px] text-slate-500 break-all line-clamp-3">{e.details}</code>
                                    </td>
                                    <td className="px-4 py-3 font-mono text-xs text-slate-500">{e.ip}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}
            </Card>

            {total > PAGE_SIZE && (
                <div className="flex items-center justify-between text-sm text-slate-500">
                    <span>{t('audit.pagination', { page, pages, total })}</span>
                    <div className="flex gap-2">
                        <button className="btn-secondary" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>←</button>
                        <button className="btn-secondary" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>→</button>
                    </div>
                </div>
            )}
        </div>
    );
}