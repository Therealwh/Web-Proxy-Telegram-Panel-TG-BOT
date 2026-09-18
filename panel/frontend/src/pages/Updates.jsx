// Страница обновлений: панель, Telemt, SSL, настройки автопроверки
import React, { useEffect, useState } from 'react';
import { RefreshCw, Download, ShieldCheck } from 'lucide-react';
import { get, post, put } from '../api';
import { toast } from '../store';
import { Card, Field, Skeleton, formatDate } from '../components/ui';

export default function Updates() {
    const [status, setStatus] = useState(null);
    const [history, setHistory] = useState([]);
    const [busy, setBusy] = useState('');

    const load = () => {
        get('/updates/status').then(setStatus).catch((e) => toast.error(e.message));
        get('/updates/history').then((d) => setHistory(d.history)).catch(() => {});
    };
    useEffect(load, []);

    const run = async (action, label) => {
        setBusy(action);
        try {
            await post(`/updates/${action}`);
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
            <h1 className="text-2xl font-bold">Обновления системы</h1>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                {/* Панель */}
                <Card title="Панель управления">
                    <div className="space-y-2 text-sm">
                        <div className="flex justify-between"><span className="text-slate-500">Текущая версия</span><span className="font-mono">v{status.panel.current}</span></div>
                        <div className="flex justify-between">
                            <span className="text-slate-500">Последняя доступная</span>
                            <span className="font-mono">
                                {status.panel.latest || '—'} {status.panel.latest && status.panel.latest !== status.panel.current ? '✅' : ''}
                            </span>
                        </div>
                    </div>
                    <button className="btn-primary w-full mt-4" disabled={busy !== ''}
                            onClick={() => run('panel', 'Обновление панели запущено')}>
                        <Download size={16} /> {busy === 'panel' ? 'Обновление...' : 'Обновить панель'}
                    </button>
                </Card>

                {/* Telemt */}
                <Card title="Telemt (прокси)">
                    <div className="space-y-2 text-sm">
                        <div className="flex justify-between"><span className="text-slate-500">Текущая версия</span><span className="font-mono">{status.telemt.current || '—'}</span></div>
                        <div className="flex justify-between">
                            <span className="text-slate-500">Последняя доступная</span>
                            <span className="font-mono">
                                {status.telemt.latest || '—'} {status.telemt.latest && status.telemt.latest !== status.telemt.current ? '✅' : ''}
                            </span>
                        </div>
                    </div>
                    <button className="btn-primary w-full mt-4" disabled={busy !== ''}
                            onClick={() => run('telemt', 'Обновление Telemt запущено')}>
                        <Download size={16} /> {busy === 'telemt' ? 'Обновление...' : 'Обновить Telemt'}
                    </button>
                </Card>

                {/* SSL */}
                <Card title="SSL-сертификат">
                    {status.ssl?.expires ? (
                        <div className="text-center py-2">
                            <ShieldCheck size={28} className="mx-auto text-emerald-500 mb-2" />
                            <div className="text-sm text-slate-500">Действует до</div>
                            <div className="font-mono">{formatDate(status.ssl.expires).split(',')[0]}</div>
                            <div className="text-xs text-slate-400 mt-1">Автопродление включено</div>
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
                <div className="mt-4 flex items-center gap-3 text-sm text-slate-500">
                    <span>Последняя проверка: {status.last_check ? formatDate(status.last_check) : '—'}</span>
                    <button className="btn-secondary !min-h-0 !px-3 !py-1.5 text-sm" disabled={busy !== ''}
                            onClick={() => run('check', 'Проверка запущена')}>
                        <RefreshCw size={14} /> Проверить сейчас
                    </button>
                </div>
            </Card>

            {/* История обновлений */}
            <Card title="История обновлений">
                {history.length === 0 ? (
                    <p className="text-sm text-slate-500">Обновлений ещё не было</p>
                ) : (
                    <ul className="space-y-2 text-sm">
                        {history.map((h) => (
                            <li key={h.id} className="flex items-center gap-3">
                                <span className={h.status === 'success' ? 'badge-green' : 'badge-red'}>
                                    {h.status === 'success' ? '✅' : '❌'} {h.component}
                                </span>
                                <span className="font-mono">{h.from_version} → {h.to_version}</span>
                                <span className="text-slate-400">{formatDate(h.created_at)}</span>
                            </li>
                        ))}
                    </ul>
                )}
            </Card>
        </div>
    );
}
