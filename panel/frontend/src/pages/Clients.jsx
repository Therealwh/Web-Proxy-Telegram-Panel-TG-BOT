// Управление клиентами: таблица, поиск, создание/редактирование, действия
import React, { useEffect, useMemo, useState } from 'react';
import { Plus, Search, Copy, QrCode, Power, Trash2, Pencil, CalendarPlus, KeyRound, Eraser, Download } from 'lucide-react';
import { get, post, patch, del } from '../api';
import { toast } from '../store';
import { Card, StatusBadge, ProgressBar, Modal, Field, Toggle, formatBytes, formatDate, Skeleton } from '../components/ui';

// Пустая форма клиента
const EMPTY_FORM = {
    username: '', quota_gb: '', expires_at: '', max_ips: '',
    rate_down_mbps: '', rate_up_mbps: '', ad_tag: '',
    web_enabled: true, mtproto_enabled: true, note: '',
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
    };
}

/** Копирование текста в буфер с уведомлением */
async function copyText(text) {
    try {
        await navigator.clipboard.writeText(text);
        toast.success('Скопировано в буфер обмена');
    } catch {
        toast.error('Не удалось скопировать');
    }
}

export default function Clients() {
    const [clients, setClients] = useState(null);
    const [search, setSearch] = useState('');
    const [statusFilter, setStatusFilter] = useState('');
    const [modal, setModal] = useState(null); // null | 'create' | client-объект
    const [qrClient, setQrClient] = useState(null);
    const [connClient, setConnClient] = useState(null); // просмотр подключений клиента
    const [activeMap, setActiveMap] = useState({}); // username -> подключения[]
    const [form, setForm] = useState(EMPTY_FORM);
    const [saving, setSaving] = useState(false);

    const load = () => {
        const params = new URLSearchParams();
        if (search) params.set('search', search);
        if (statusFilter) params.set('status', statusFilter);
        get(`/clients?${params}`).then((d) => setClients(d.clients)).catch((e) => toast.error(e.message));
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
        const t = setInterval(loadActive, 5000);
        return () => clearInterval(t);
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
        });
        setModal(c);
    };

    const save = async () => {
        setSaving(true);
        try {
            if (modal === 'create') {
                await post('/clients', formToPayload(form));
                toast.success('Клиент создан');
            } else {
                const payload = formToPayload(form);
                delete payload.username; // логин менять нельзя
                await patch(`/clients/${modal.id}`, payload);
                toast.success('Клиент обновлён');
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
            toast.success('Готово');
            load();
        } catch (e) {
            toast.error(e.message);
        }
    };

    const remove = async (client) => {
        if (!confirm(`Удалить клиента ${client.username}? Действие необратимо.`)) return;
        try {
            await del(`/clients/${client.id}`);
            toast.success('Клиент удалён');
            load();
        } catch (e) {
            toast.error(e.message);
        }
    };

    const extend = async (client) => {
        const days = prompt(`На сколько дней продлить доступ для ${client.username}?`, '30');
        if (!days) return;
        try {
            await post(`/clients/${client.id}/extend`, { days: parseInt(days, 10) });
            toast.success('Доступ продлён');
            load();
        } catch (e) {
            toast.error(e.message);
        }
    };

    return (
        <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <h1 className="text-2xl font-bold">Клиенты</h1>
                <div className="flex gap-2">
                    <a href={`/api/clients/export/csv?token=${sessionStorage.getItem('tggate_token')}`} className="btn-secondary" download>
                        <Download size={16} /> Экспорт CSV
                    </a>
                    <button onClick={openCreate} className="btn-primary">
                        <Plus size={16} /> Создать клиента
                    </button>
                </div>
            </div>

            {/* Поиск и фильтры */}
            <Card>
                <div className="flex flex-wrap gap-3">
                    <div className="relative flex-1 min-w-[220px]">
                        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                        <input
                            className="input !pl-9"
                            placeholder="Поиск по имени..."
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                        />
                    </div>
                    <select className="input !w-auto" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
                        <option value="">Все статусы</option>
                        <option value="active">Активные</option>
                        <option value="blocked">Заблокированные</option>
                        <option value="expired">Просроченные</option>
                    </select>
                </div>
            </Card>

            {/* Таблица */}
            <Card className="!p-0 overflow-x-auto">
                {!clients ? (
                    <div className="p-5 space-y-3">{[...Array(5)].map((_, i) => <Skeleton key={i} className="h-12" />)}</div>
                ) : clients.length === 0 ? (
                    <p className="p-8 text-center text-slate-500">Клиенты не найдены. Создайте первого!</p>
                ) : (
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="text-left text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-slate-700">
                                <th className="px-4 py-3 font-medium">Пользователь</th>
                                <th className="px-4 py-3 font-medium">Статус</th>
                                <th className="px-4 py-3 font-medium">IP сейчас</th>
                                <th className="px-4 py-3 font-medium">Трафик</th>
                                <th className="px-4 py-3 font-medium">Истекает</th>
                                <th className="px-4 py-3 font-medium">Протоколы</th>
                                <th className="px-4 py-3 font-medium text-right">Действия</th>
                            </tr>
                        </thead>
                        <tbody>
                            {clients.map((c) => {
                                const conns = activeMap[c.username] || [];
                                return (
                                <tr key={c.id} className="border-b border-slate-100 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
                                    <td className="px-4 py-3">
                                        <button className="font-medium hover:text-primary transition-colors text-left"
                                                onClick={() => setConnClient(c)}
                                                title="Показать подключения">
                                            {c.username}
                                        </button>
                                        {c.note && <div className="text-xs text-slate-400">{c.note}</div>}
                                    </td>
                                    <td className="px-4 py-3"><StatusBadge status={c.status} /></td>
                                    <td className="px-4 py-3">
                                        {conns.length > 0 ? (
                                            <button className="badge-green cursor-pointer" onClick={() => setConnClient(c)}
                                                    title="Кто подключён">
                                                🟢 {conns.length} IP
                                            </button>
                                        ) : (
                                            <span className="text-xs text-slate-400">офлайн</span>
                                        )}
                                    </td>
                                    <td className="px-4 py-3 min-w-[170px]">
                                        <div className="text-base font-bold leading-tight">{formatBytes(c.traffic_used)}{c.quota_bytes ? '' : ' / ∞'}</div>
                                        {c.quota_bytes ? (
                                            <>
                                                <div className="text-xs text-slate-500 mb-1">
                                                    из {formatBytes(c.quota_bytes)} · {c.quota_percent}%
                                                </div>
                                                <ProgressBar percent={c.quota_percent} />
                                            </>
                                        ) : (
                                            <div className="w-full h-1.5 rounded-full bg-gradient-to-r from-primary via-primary/60 to-transparent mt-1" />
                                        )}
                                    </td>
                                    <td className="px-4 py-3 text-slate-500">{c.expires_at ? formatDate(c.expires_at).split(',')[0] : '∞'}</td>
                                    <td className="px-4 py-3">
                                        <span className="text-xs">
                                            {c.web_enabled ? '🌐 Web' : ''}{c.web_enabled && c.mtproto_enabled ? ' + ' : ''}{c.mtproto_enabled ? '🔌 MTProto' : ''}
                                        </span>
                                    </td>
                                    <td className="px-4 py-3">
                                        <div className="flex justify-end gap-1">
                                            <button className="btn-ghost !min-h-0 !p-2" title="QR-коды" onClick={() => setQrClient(c)}><QrCode size={16} /></button>
                                            <button className="btn-ghost !min-h-0 !p-2" title="Редактировать" onClick={() => openEdit(c)}><Pencil size={16} /></button>
                                            <button className="btn-ghost !min-h-0 !p-2" title="Продлить" onClick={() => extend(c)}><CalendarPlus size={16} /></button>
                                            <button className="btn-ghost !min-h-0 !p-2" title={c.status === 'active' ? 'Выключить' : 'Включить'}
                                                onClick={() => doAction(c, 'toggle', c.status === 'active' ? `Выключить ${c.username}?` : null)}>
                                                <Power size={16} className={c.status === 'active' ? 'text-red-500' : 'text-emerald-500'} />
                                            </button>
                                            <button className="btn-ghost !min-h-0 !p-2" title="Новый секрет (перевыпуск ссылок)"
                                                onClick={() => doAction(c, 'rotate', `Перевыпустить ссылки для ${c.username}? Старые перестанут работать.`)}>
                                                <KeyRound size={16} />
                                            </button>
                                            <button className="btn-ghost !min-h-0 !p-2" title="Сбросить трафик" onClick={() => doAction(c, 'reset-quota')}><Eraser size={16} /></button>
                                            <button className="btn-ghost !min-h-0 !p-2 text-red-500" title="Удалить" onClick={() => remove(c)}><Trash2 size={16} /></button>
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
                   title={modal === 'create' ? 'Новый клиент' : `Редактирование: ${modal?.username}`}>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <Field label="👤 Имя пользователя" hint="Латиница, цифры, _ . -">
                        <input className="input" value={form.username} disabled={modal !== 'create'}
                               onChange={(e) => setForm({ ...form, username: e.target.value })} />
                    </Field>
                    <Field label="📊 Квота трафика, ГБ" hint="Пусто = безлимит">
                        <input className="input" type="number" min="0" step="0.1" value={form.quota_gb}
                               onChange={(e) => setForm({ ...form, quota_gb: e.target.value })} />
                    </Field>
                    <Field label="📅 Дата истечения доступа" hint="Пусто = бессрочно">
                        <input className="input" type="date" value={form.expires_at}
                               onChange={(e) => setForm({ ...form, expires_at: e.target.value })} />
                    </Field>
                    <Field label="🌐 Макс. уникальных IP" hint="Ограничение одновременных подключений">
                        <input className="input" type="number" min="1" max="100" value={form.max_ips}
                               onChange={(e) => setForm({ ...form, max_ips: e.target.value })} />
                    </Field>
                    <Field label="⬇️ Скорость скачивания, Мбит/с" hint="0 или пусто = без ограничений">
                        <input className="input" type="number" min="0" value={form.rate_down_mbps}
                               onChange={(e) => setForm({ ...form, rate_down_mbps: e.target.value })} />
                    </Field>
                    <Field label="⬆️ Скорость загрузки, Мбит/с" hint="0 или пусто = без ограничений">
                        <input className="input" type="number" min="0" value={form.rate_up_mbps}
                               onChange={(e) => setForm({ ...form, rate_up_mbps: e.target.value })} />
                    </Field>
                    <Field label="📢 Ad Tag" hint="32 hex-символа из @MTProxybot" className="sm:col-span-2">
                        <input className="input font-mono" value={form.ad_tag} maxLength={32}
                               onChange={(e) => setForm({ ...form, ad_tag: e.target.value })} />
                    </Field>
                    <Field label="📝 Заметка" hint="Видна только вам">
                        <input className="input" value={form.note}
                               onChange={(e) => setForm({ ...form, note: e.target.value })} />
                    </Field>
                    <div className="flex items-center gap-6">
                        <Toggle checked={form.web_enabled} onChange={(v) => setForm({ ...form, web_enabled: v })} label="🌐 Web Proxy" />
                        <Toggle checked={form.mtproto_enabled} onChange={(v) => setForm({ ...form, mtproto_enabled: v })} label="🔌 MTProto" />
                    </div>
                </div>
                <div className="flex justify-end gap-2 mt-6">
                    <button className="btn-secondary" onClick={() => setModal(null)}>Отмена</button>
                    <button className="btn-primary" onClick={save} disabled={saving || !form.username.trim()}>
                        {saving ? 'Сохранение...' : 'Сохранить'}
                    </button>
                </div>
            </Modal>

            {/* Модал QR-кодов */}
            <Modal open={!!qrClient} onClose={() => setQrClient(null)} title={`QR-коды: ${qrClient?.username}`} wide>
                {qrClient && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                        {qrClient.links.web && (
                            <div className="text-center">
                                <h4 className="font-medium mb-3">🌐 Web Proxy</h4>
                                <img src={`/api/qr/client/${qrClient.id}/web.png?token=${sessionStorage.getItem('tggate_token')}`} alt="QR Web Proxy"
                                     className="mx-auto rounded-lg border border-slate-200 dark:border-slate-700 w-48 h-48" />
                                <button className="btn-secondary mt-3 w-full" onClick={() => copyText(qrClient.links.web)}>
                                    <Copy size={14} /> Копировать ссылку
                                </button>
                            </div>
                        )}
                        {qrClient.links.mtproto && (
                            <div className="text-center">
                                <h4 className="font-medium mb-3">🔌 MTProto</h4>
                                <img src={`/api/qr/client/${qrClient.id}/mtproto.png?token=${sessionStorage.getItem('tggate_token')}`} alt="QR MTProto"
                                     className="mx-auto rounded-lg border border-slate-200 dark:border-slate-700 w-48 h-48" />
                                <button className="btn-secondary mt-3 w-full" onClick={() => copyText(qrClient.links.mtproto)}>
                                    <Copy size={14} /> Копировать ссылку
                                </button>
                            </div>
                        )}
                    </div>
                )}
            </Modal>
            {/* Модал подключений клиента: кто онлайн, IP, страна */}
            <Modal open={!!connClient} onClose={() => setConnClient(null)}
                   title={`Подключения: ${connClient?.username}`}>
                {connClient && (activeMap[connClient.username] || []).length === 0 ? (
                    <p className="text-sm text-slate-500 py-6 text-center">
                        Сейчас нет активных подключений
                    </p>
                ) : connClient && (
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="text-left text-slate-500 border-b border-slate-200 dark:border-slate-700">
                                <th className="py-2 pr-4 font-medium">IP-адрес</th>
                                <th className="py-2 pr-4 font-medium">Страна</th>
                                <th className="py-2 font-medium">Протокол</th>
                            </tr>
                        </thead>
                        <tbody>
                            {(activeMap[connClient.username] || []).map((c, i) => (
                                <tr key={`${c.ip}-${i}`} className="border-b border-slate-100 dark:border-slate-800">
                                    <td className="py-2 pr-4 font-mono text-xs">{c.ip}</td>
                                    <td className="py-2 pr-4">{c.country}</td>
                                    <td className="py-2">{c.protocol === 'web' ? '🌐 Web' : '🔌 MTProto'}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}
                <p className="text-xs text-slate-400 mt-4">Обновляется автоматически каждые 5 секунд — модал можно оставить открытым</p>
            </Modal>
        </div>
    );
}
