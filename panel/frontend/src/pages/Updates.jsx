// Страница обновлений: версии списком, выбор цели, настройки автопроверки
import React, { useEffect, useState } from 'react';
import { RefreshCw, Download, ShieldCheck, ChevronDown } from 'lucide-react';
import { get, post, put } from '../api';
import { toast } from '../store';
import { Card, Field, Skeleton, formatDate } from '../components/ui';

/** Карточка компонента с выбором версии из списка релизов */
function UpdateCard({ title, current, latest, releases, loading, busy, onUpdate }) {
    const [showList, setShowList] = useState(false);
    const [selected, setSelected] = useState('');

    // По умолчанию — последняя доступная
    useEffect(() => { setSelected(''); }, [releases]);

    const chosen = selected || latest || '';

    return (
        <Card title={title}>
            <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                    <span className="text-slate-500">Текущая версия</span>
                    <span className="font-mono">{current || '—'}</span>
                </div>
                <div className="flex justify-between">
                    <span className="text-slate-500">Последняя доступная</span>
                    <span className="font-mono">
                        {latest || '—'} {latest && current && latest !== current ? '✅' : ''}
                    </span>
                </div>
            </div>

            {/* Выбор версии из списка релизов */}
            <div className="mt-3">
                <button type="button" className="btn-ghost !min-h-0 !py-1.5 text-xs w-full justify-between"
                        onClick={() => setShowList(!showList)}>
                    <span>{chosen ? `Установить: ${chosen}` : 'Выбрать версию'}</span>
                    <ChevronDown size={14} className={`transition-transform ${showList ? 'rotate-180' : ''}`} />
                </button>
                {showList && (
                    <div className="mt-1 max-h-48 overflow-y-auto rounded-lg border border-slate-200 dark:border-slate-700">
                        {loading ? (
                            <p className="p-3 text-xs text-slate-500 text-center">Загрузка...</p>
                        ) : releases.length === 0 ? (
                            <p className="p-3 text-xs text-slate-500 text-center">Список недоступен</p>
                        ) : (
                            releases.map((r) => (
                                <button key={r.tag} type="button"
                                        className={`w-full text-left px-3 py-2 text-xs font-mono flex justify-between gap-2
                                            hover:bg-slate-100 dark:hover:bg-slate-800
                                            ${r.tag === chosen ? 'bg-primary/10 text-primary' : ''}`}
                                        onClick={() => { setSelected(r.raw || r.tag); setShowList(false); }}>
                                    <span>{r.tag}{r.prerelease ? ' (beta)' : ''}</span>
                                    {r.date && <span className="text-slate-400">{new Date(r.date).toLocaleDateString('ru-RU')}</span>}
                                </button>
                            ))
                        )}
                    </div>
                )}
            </div>

            <button className="btn-primary w-full mt-3" disabled={busy !== '' || !chosen}
                    onClick={() => onUpdate(chosen)}>
                <Download size={16} /> {busy ? 'Обновление...' : `Обновить${chosen ? ` до ${chosen}` : ''}`}
            </button>
        </Card>
    );
}

export default function Updates() {
    const [status, setStatus] = useState(null);
    const [history, setHistory] = useState([]);
    const [releases, setReleases] = useState({ panel: [], telemt: [] });
    const [busy, setBusy] = useState('');
    const [relLoading, setRelLoading] = useState(false);

    const load = () => {
        get('/updates/status').then(setStatus).catch((e) => toast.error(e.message));
        get('/updates/history').then((d) => setHistory(d.history)).catch(() => {});
    };
    useEffect(load, []);

    const loadReleases = () => {
        setRelLoading(true);
        Promise.all([
            get('/updates/available?component=panel'),
            get('/updates/available?component=telemt'),
        ]).then(([p, t]) => {
            setReleases({ panel: p.releases, telemt: t.releases });
        }).catch(() => {}).finally(() => setRelLoading(false));
    };
    useEffect(loadReleases, []);

    const run = async (action, version, label) => {
        setBusy(action);
        try {
            await post(`/updates/${action}`, version ? { version } : {});
            toast.success(label);
            load();
        } catch (e) {
            toast.error(e.message);
        } finally {
            setBusy('');
        }
    };

    const saveSettings = async () => {
        try {
            await put('/updates/settings', {
                auto_check: status.settings.auto_check,
                frequency: status.settings.frequency,
                channel: status.settings.channel,
                auto_install: status.settings.auto_install,
            });
            toast.success('Настройки обновлений сохранены');
        } catch (e) {
            toast.error(e.message);
        }
    };

    if (!status) return <div className="space-y-4">{[...Array(3)].map((_, i) => <Skeleton key={i} className="h-40" />)}</div>;

    const setS = (k, v) => setStatus((s) => ({ ...s, settings: { ...s.settings, [k]: v } }));

    return (
        <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <h1 className="text-2xl font-bold">Обновления системы</h1>
                <button className="btn-secondary" disabled={busy !== ''}
                        onClick={() => run('check', null, 'Проверка запущена')}>
                    <RefreshCw size={16} /> Проверить сейчас
                </button>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                <UpdateCard
                    title="Панель управления"
                    current={status.panel.current} latest={status.panel.latest}
                    releases={releases.panel} loading={relLoading} busy={busy}
                    onUpdate={(v) => run('panel', v, `Обновление панели до ${v} запущено`)} />

                <UpdateCard
                    title="Telemt (прокси)"
                    current={status.telemt.current} latest={status.telemt.latest}
                    releases={releases.telemt} loading={relLoading} busy={busy}
                    onUpdate={(v) => run('telemt', v, `Обновление Telemt до ${v} запущено`)} />

                {/* SSL */}
                <Card title="SSL-сертификат">
                    {status.ssl?.expires ? (
                        <div className="text-center py-2">
                            <ShieldCheck size={28} className="mx-auto text-emerald-500 mb-2" />
                            <div className="text-sm text-slate-500">Действует до</div>
                            <div className="font-mono">{formatDate(status.ssl.expires).split(',')[0]}</div>
                            <div className={`text-sm mt-1 ${status.ssl.daysLeft < 14 ? 'text-red-500' : 'text-emerald-500'}`}>
                                осталось {status.ssl.daysLeft} дн.
                            </div>
                            <div className="text-xs text-slate-400 mt-2">Автопродление Caddy включено</div>
                        </div>
                    ) : (
                        <p className="text-sm text-slate-500 py-4 text-center">Нет данных о сертификате</p>
                    )}
                </Card>
            </div>

            {/* Настройки автопроверки */}
            <Card title="⚙️ Настройки автопроверки" actions={
                <button className="btn-primary !min-h-0 !px-3 !py-1.5 text-sm" onClick={saveSettings}>Сохранить</button>
            }>
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                    <Field label="Автопроверка">
                        <select className="input" value={String(status.settings.auto_check)}
                                onChange={(e) => setS('auto_check', e.target.value === 'true')}>
                            <option value="true">Включена</option>
                            <option value="false">Выключена</option>
                        </select>
                    </Field>
                    <Field label="Частота">
                        <select className="input" value={status.settings.frequency}
                                onChange={(e) => setS('frequency', e.target.value)}>
                            <option value="hourly">Раз в час</option>
                            <option value="daily">Раз в сутки</option>
                            <option value="weekly">Раз в неделю</option>
                            <option value="monthly">Раз в месяц</option>
                        </select>
                    </Field>
                    <Field label="Канал обновлений">
                        <select className="input" value={status.settings.channel}
                                onChange={(e) => setS('channel', e.target.value)}>
                            <option value="stable">stable</option>
                            <option value="beta">beta</option>
                            <option value="latest">latest</option>
                        </select>
                    </Field>
                    <Field label="Режим">
                        <select className="input" value={String(status.settings.auto_install)}
                                onChange={(e) => setS('auto_install', e.target.value === 'true')}>
                            <option value="false">Только уведомлять</option>
                            <option value="true">Автоустановка</option>
                        </select>
                    </Field>
                </div>
                <div className="mt-4 text-sm text-slate-500">
                    Последняя проверка: {status.last_check ? formatDate(status.last_check) : '—'}
                </div>
            </Card>

            {/* История обновлений */}
            <Card title="История обновлений">
                {history.length === 0 ? (
                    <p className="text-sm text-slate-500">Обновлений ещё не было</p>
                ) : (
                    <ul className="space-y-2 text-sm">
                        {history.map((h) => (
                            <li key={h.id}>
                                <details className="group">
                                    <summary className="flex items-center gap-3 cursor-pointer list-none">
                                        <span className={h.status === 'success' ? 'badge-green' : 'badge-red'}>
                                            {h.status === 'success' ? '✅' : '❌'} {h.component}
                                        </span>
                                        <span className="font-mono">{h.to_version || 'latest'}</span>
                                        <span className="text-slate-400">{formatDate(h.created_at)}</span>
                                        {h.status !== 'success' && h.log && (
                                            <span className="text-xs text-red-400">(нажмите — показать лог)</span>
                                        )}
                                    </summary>
                                    {h.log && (
                                        <pre className="mt-2 rounded-lg bg-slate-100 dark:bg-slate-800 p-3 text-xs font-mono overflow-x-auto max-h-60 overflow-y-auto whitespace-pre-wrap">{h.log}</pre>
                                    )}
                                </details>
                            </li>
                        ))}
                    </ul>
                )}
            </Card>
        </div>
    );
}
