// Страница «Движок и лимиты»: железо сервера, память Telemt, таблица лимитов с рекомендациями
import React, { useEffect, useState } from 'react';
import { Activity, Sparkles, Save } from 'lucide-react';
import { get, post } from '../api';
import { toast } from '../store';
import { Card, Skeleton, PageHeader, ProgressBar } from '../components/ui';

const GB = 1073741824;

/** Байты → ГБ с одним знаком */
const gb = (bytes) => (bytes == null ? '—' : `${(bytes / GB).toFixed(1)} ГБ`);

/** Uptime-секунды → «2 д 3 ч 15 мин» */
const uptime = (s) => {
    if (s == null) return '—';
    const d = Math.floor(s / 86400);
    const h = Math.floor((s % 86400) / 3600);
    const m = Math.floor((s % 3600) / 60);
    return `${d ? `${d} д ` : ''}${h ? `${h} ч ` : ''}${m} мин`.trim() || 'меньше минуты';
};

/** Лимиты: человеческое имя + ключ. isText — строковое поле (не число). */
const LIMITS = [
    { key: 'max_profiles', label: 'Макс. профилей' },
    { key: 'max_sessions_global', label: 'Макс. сессий (глобально)' },
    { key: 'max_http_connections', label: 'Макс. HTTP-соединений' },
    { key: 'max_streams_global', label: 'Макс. потоков (глобально)' },
    { key: 'max_bootstraps_global', label: 'Макс. bootstrap-соединений' },
    { key: 'max_http_overload_connections', label: 'Макс. соединений при перегрузке HTTP' },
    { key: 'control_bytes_global', label: 'Байты control-канала (глобально)' },
    { key: 'pending_items_global', label: 'Элементов в очереди ожидания' },
    { key: 'pending_bytes_global', label: 'Байты очереди ожидания' },
    { key: 'websocket_bytes_global', label: 'Байты WebSocket' },
    { key: 'max_tombstones_per_session', label: 'Tombstone на сессию' },
    { key: 'max_header_bytes', label: 'Байт заголовков HTTP' },
    { key: 'max_body_bytes', label: 'Байт тела запроса' },
    { key: 'max_frame_payload_bytes', label: 'Байт полезной нагрузки кадра' },
    { key: 'carrier_batch_bytes', label: 'Байт батча carrier' },
    { key: 'max_body_bytes_global', label: 'Суммарно байт тел запросов' },
    { key: 'http_connection_capacity_action', label: 'Действие при исчерпании HTTP-ёмкости', isText: true },
];

/** Форма редактирования: все значения — строки полей ввода */
const buildForm = (d) => {
    const f = { max_connections: String(d?.current?.max_connections ?? 0) };
    for (const { key } of LIMITS) f[key] = String(d?.current?.limits?.[key] ?? '');
    return f;
};

export default function Tuning() {
    const [data, setData] = useState(null);
    const [loadError, setLoadError] = useState(null);
    const [form, setForm] = useState({});
    const [saving, setSaving] = useState(false);

    const load = (silent = false) => {
        get('/engine/tuning')
            .then((d) => {
                setData(d);
                setLoadError(null);
                if (!silent) setForm(buildForm(d));
            })
            .catch((e) => {
                if (!silent) setLoadError(e.message);
                if (!silent) toast.error(e.message);
            });
    };

    useEffect(() => { load(); }, []);

    // Фоновое обновление телеметрии (форму редактирования не трогаем)
    useEffect(() => {
        const timer = setInterval(() => { get('/engine/tuning').then(setData).catch(() => {}); }, 30000);
        return () => clearInterval(timer);
    }, []);

    if (!data) {
        return (
            <div className="space-y-4">
                <Skeleton className="h-16" />
                {loadError && <Card><p className="text-sm text-red-500">{loadError}</p></Card>}
                {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-40" />)}
            </div>
        );
    }

    const hw = data.hardware || {};
    const svc = data.service || {};
    const setField = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

    /** Заполнить все поля рекомендованными значениями */
    const applyRecommended = () => {
        const rec = data.recommended || {};
        const f = { max_connections: String(rec.max_connections ?? 0) };
        for (const { key } of LIMITS) f[key] = String(rec.limits?.[key] ?? '');
        setForm(f);
        toast.info('Рекомендованные значения подставлены — проверьте и сохраните');
    };

    /** POST лимитов с перезапуском Telemt */
    const save = async () => {
        setSaving(true);
        try {
            const limits = {};
            for (const { key, isText } of LIMITS) {
                const raw = form[key] ?? '';
                limits[key] = isText ? String(raw).trim() : Math.round(Number(raw) || 0);
            }
            const body = { limits, max_connections: Math.round(Number(form.max_connections) || 0) };
            const resp = await post('/engine/tuning', body);
            if (resp && resp.ok === false) throw new Error(resp.error || 'Telemt отклонил конфиг');
            toast.success('Применено и проверено');
            load();
        } catch (e) {
            toast.error(e.message);
        } finally {
            setSaving(false);
        }
    };

    const ramPercent = hw.ramTotal ? ((hw.ramUsed || 0) / hw.ramTotal) * 100 : 0;

    return (
        <div className="space-y-4">
            <PageHeader icon={<Activity size={20} />} title="⚙️ Движок и диагностика"
                        subtitle="Состояние сервера, память Telemt и лимиты движка" />

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <Card title="🖥 Сервер">
                    <div className="flex flex-wrap items-baseline justify-between gap-2 py-1.5 border-b border-slate-100 dark:border-slate-800/60">
                        <span className="text-sm text-slate-500 dark:text-slate-400">CPU</span>
                        <span className="text-sm font-medium text-right break-all">
                            {hw.cores ?? '—'} ядер
                            {hw.cpuModel && <span className="block text-[11px] text-slate-400">{hw.cpuModel}</span>}
                        </span>
                    </div>
                    <div className="py-1.5 border-b border-slate-100 dark:border-slate-800/60">
                        <div className="flex flex-wrap items-baseline justify-between gap-2">
                            <span className="text-sm text-slate-500 dark:text-slate-400">RAM</span>
                            <span className="text-sm font-medium">{gb(hw.ramUsed)} / {gb(hw.ramTotal)}</span>
                        </div>
                        <ProgressBar percent={ramPercent} className="mt-1.5" />
                        <span className="block text-[11px] text-slate-400 mt-1">свободно: {gb(hw.ramFree)}</span>
                    </div>
                    <div className="py-1.5 border-b border-slate-100 dark:border-slate-800/60">
                        <div className="flex flex-wrap items-baseline justify-between gap-2">
                            <span className="text-sm text-slate-500 dark:text-slate-400">Диск</span>
                            <span className="text-sm font-medium">{hw.diskPercent != null ? `${hw.diskPercent}%` : '—'}</span>
                        </div>
                        <ProgressBar percent={hw.diskPercent} className="mt-1.5" />
                        <span className="block text-[11px] text-slate-400 mt-1">занято {gb(hw.diskUsed)} из {gb(hw.diskTotal)}</span>
                    </div>
                    <div className="flex flex-wrap items-baseline justify-between gap-2 py-1.5">
                        <span className="text-sm text-slate-500 dark:text-slate-400">Uptime</span>
                        <span className="text-sm font-medium">{uptime(hw.uptimeSeconds)}</span>
                    </div>
                </Card>

                <Card title="🩺 Telemt">
                    <div className="flex flex-wrap items-baseline justify-between gap-2 py-1.5 border-b border-slate-100 dark:border-slate-800/60">
                        <span className="text-sm text-slate-500 dark:text-slate-400">Статус</span>
                        {svc.active
                            ? <span className="badge-green">работает</span>
                            : <span className="badge-red">остановлен</span>}
                    </div>
                    <div className="py-1.5 border-b border-slate-100 dark:border-slate-800/60">
                        <div className="flex flex-wrap items-baseline justify-between gap-2">
                            <span className="text-sm text-slate-500 dark:text-slate-400">Память движка</span>
                            <span className="text-sm font-medium">{gb(svc.memoryCurrent)} / {gb(data.memoryMax)}</span>
                        </div>
                        <ProgressBar percent={svc.usagePercent} className="mt-1.5" />
                    </div>
                    <div className="flex flex-wrap items-baseline justify-between gap-2 py-1.5 border-b border-slate-100 dark:border-slate-800/60">
                        <span className="text-sm text-slate-500 dark:text-slate-400">Envelope</span>
                        <span className="text-sm font-medium">{gb(data.envelope)}</span>
                    </div>
                    <div className="flex flex-wrap items-baseline justify-between gap-2 py-1.5">
                        <span className="text-sm text-slate-500 dark:text-slate-400">Потолок памяти (memoryMax)</span>
                        <span className="text-sm font-medium">{gb(data.memoryMax)}</span>
                    </div>
                </Card>
            </div>

            <Card title="🎛 Лимиты Telemt"
                  subtitle="Текущие значения движка. Жёлтая строка — отличается от рекомендованного."
                  actions={(
                      <>
                          <button className="btn-ghost" onClick={applyRecommended}>
                              <Sparkles size={16} className="inline mr-1.5 -mt-0.5" />Подставить рекомендованные
                          </button>
                          <button className="btn-primary" disabled={saving} onClick={save}>
                              <Save size={16} className="inline mr-1.5 -mt-0.5" />{saving ? 'Сохранение…' : 'Сохранить и перезапустить Telemt'}
                          </button>
                      </>
                  )}>
                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="text-left text-slate-500 border-b border-slate-200 dark:border-slate-700">
                                <th className="py-2 pr-4 font-medium">Лимит</th>
                                <th className="py-2 pr-4 font-medium">Значение</th>
                                <th className="py-2 font-medium">Сверка</th>
                            </tr>
                        </thead>
                        <tbody>
                            {/* max_connections — отдельное поле верхнего уровня */}
                            {(() => {
                                const rec = data.recommended?.max_connections;
                                const cur = data.current?.max_connections;
                                const differs = rec != null && String(cur) !== String(rec);
                                return (
                                    <tr className={`border-b border-slate-100 dark:border-slate-800 ${differs ? 'bg-amber-50/60 dark:bg-amber-500/5' : ''}`}>
                                        <td className="py-2 pr-4">Макс. соединений (0 = авто)</td>
                                        <td className="py-2 pr-4">
                                            <input className="input w-40" type="number" min="0" step="1"
                                                   value={form.max_connections ?? ''} onChange={setField('max_connections')} />
                                            <span className="block text-[11px] text-slate-400 mt-0.5">рекомендовано: {rec ?? '—'}</span>
                                        </td>
                                        <td className="py-2">
                                            {differs ? <span className="badge-yellow">отличается</span> : <span className="badge-green">ок</span>}
                                        </td>
                                    </tr>
                                );
                            })()}
                            {LIMITS.map(({ key, label, isText }) => {
                                const rec = data.recommended?.limits?.[key];
                                const cur = data.current?.limits?.[key];
                                const differs = rec != null && String(cur ?? '') !== String(rec);
                                return (
                                    <tr key={key} className={`border-b border-slate-100 dark:border-slate-800 last:border-0 ${differs ? 'bg-amber-50/60 dark:bg-amber-500/5' : ''}`}>
                                        <td className="py-2 pr-4">{label}</td>
                                        <td className="py-2 pr-4">
                                            {isText ? (
                                                <input className="input w-40" value={form[key] ?? ''} onChange={setField(key)} />
                                            ) : (
                                                <input className="input w-40" type="number" min="0" step="1"
                                                       value={form[key] ?? ''} onChange={setField(key)} />
                                            )}
                                            <span className="block text-[11px] text-slate-400 mt-0.5">рекомендовано: {rec ?? '—'}</span>
                                        </td>
                                        <td className="py-2">
                                            {differs ? <span className="badge-yellow">отличается</span> : <span className="badge-green">ок</span>}
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            </Card>
        </div>
    );
}
