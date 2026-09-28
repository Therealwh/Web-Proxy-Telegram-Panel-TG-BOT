// Настройки панели с категориями
import React, { useEffect, useRef, useState } from 'react';
import { Save } from 'lucide-react';
import { get, post, put } from '../api';
import { toast } from '../store';
import { Card, Field, Toggle, Skeleton } from '../components/ui';

// Описание категорий и их полей (подписи на русском)
const CATEGORIES = [
    {
        id: 'network', icon: '🌐', title: 'Сеть и протоколы',
        fields: [
            { key: 'mask_domain', label: 'Домен маскировки Fake-TLS', hint: 'Смена сделает старые MTProto-ссылки недействительными!' },
            { key: 'ad_tag_global', label: 'Глобальный Ad Tag', hint: '32 hex-символа из @MTProxybot' },
            { key: 'web_proxy_enabled', label: 'Web Proxy включён', type: 'toggle' },
            { key: 'mtproto_enabled', label: 'MTProto включён (порт 8443)', type: 'toggle' },
        ],
    },
    {
        id: 'notify', icon: '🔔', title: 'Уведомления',
        fields: [
            { key: 'tg_bot_token', label: 'Токен Telegram-бота администратора', hint: 'Получите у @BotFather' },
            { key: 'tg_admin_chat_id', label: 'Chat ID администратора', hint: 'Узнайте у @userinfobot' },
            { key: 'notify_disk', label: 'Мало места на диске', type: 'toggle' },
            { key: 'notify_services', label: 'Падение сервисов', type: 'toggle' },
            { key: 'notify_new_client', label: 'Новый клиент', type: 'toggle' },
            { key: 'notify_quota', label: 'Превышение квоты', type: 'toggle' },
        ],
    },
    {
        id: 'appearance', icon: '🎨', title: 'Внешний вид',
        fields: [
            { key: 'brand_name', label: 'Название в шапке' },
            { key: 'theme', label: 'Тема по умолчанию', type: 'select', options: [['dark', 'Тёмная'], ['light', 'Светлая']] },
            { key: 'language', label: 'Язык интерфейса', type: 'select', options: [['ru', 'Русский'], ['en', 'English']] },
        ],
    },
    {
        id: 'backup', icon: '📊', title: 'Резервные копии',
        fields: [
            { key: 'backup_auto', label: 'Ежедневные автобэкапы', type: 'toggle' },
            { key: 'backup_keep_days', label: 'Хранить бэкапов, дней', type: 'number' },
        ],
    },
];

export default function Settings() {
    const [settings, setSettings] = useState(null);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        get('/settings').then((d) => setSettings(d.settings)).catch((e) => toast.error(e.message));
    }, []);

    const setValue = (key, value) => setSettings((s) => ({ ...s, [key]: value }));

    const save = async () => {
        setSaving(true);
        try {
            await put('/settings', settings);
            toast.success('Настройки сохранены');
        } catch (e) {
            toast.error(e.message);
        } finally {
            setSaving(false);
        }
    };

    if (!settings) return <div className="space-y-4">{[...Array(3)].map((_, i) => <Skeleton key={i} className="h-48" />)}</div>;

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <h1 className="text-2xl font-bold">Настройки</h1>
                <button className="btn-primary" onClick={save} disabled={saving}>
                    <Save size={16} /> {saving ? 'Сохранение...' : 'Сохранить'}
                </button>
            </div>

            {/* Смена домена без переустановки */}
            <DomainCard />

            {CATEGORIES.map((cat) => (
                <Card key={cat.id} title={`${cat.icon} ${cat.title}`}>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {cat.fields.map((f) => {
                            if (f.type === 'toggle') {
                                return (
                                    <Toggle key={f.key} label={f.label}
                                            checked={!!settings[f.key]}
                                            onChange={(v) => setValue(f.key, v)} />
                                );
                            }
                            if (f.type === 'select') {
                                return (
                                    <Field key={f.key} label={f.label} hint={f.hint}>
                                        <select className="input" value={settings[f.key] ?? ''}
                                                onChange={(e) => setValue(f.key, e.target.value)}>
                                            {f.options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                                        </select>
                                    </Field>
                                );
                            }
                            return (
                                <Field key={f.key} label={f.label} hint={f.hint}>
                                    <input className="input"
                                           type={f.type === 'number' ? 'number' : 'text'}
                                           value={settings[f.key] ?? ''}
                                           onChange={(e) => setValue(f.key, f.type === 'number' ? Number(e.target.value) : e.target.value)} />
                                </Field>
                            );
                        })}
                    </div>
                </Card>
            ))}

            {/* Резервное копирование: экспорт/импорт всех данных */}
            <BackupCard />
        </div>
    );
}

/** Карточка бэкапа: скачать все данные / восстановить из файла */
function BackupCard() {
    const [restoring, setRestoring] = useState(false);
    const fileRef = useRef(null);

    const download = () => {
        const token = sessionStorage.getItem('tggate_token');
        const a = document.createElement('a');
        a.href = `/api/backup/export?token=${encodeURIComponent(token || '')}`;
        a.download = '';
        document.body.appendChild(a);
        a.click();
        a.remove();
        toast.success('Бэкап скачивается...');
    };

    const restore = async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        if (!confirm(`Восстановить из ${file.name}? ВСЕ текущие данные панели будут заменены данными из бэкапа!`)) {
            e.target.value = '';
            return;
        }
        setRestoring(true);
        try {
            const text = await file.text();
            const res = await fetch('/api/backup/restore', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Requested-With': 'XMLHttpRequest',
                    Authorization: `Bearer ${sessionStorage.getItem('tggate_token')}`,
                },
                body: text,
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data.error || `Ошибка ${res.status}`);
            toast.success('Бэкап восстановлен! Обновите страницу (F5).');
        } catch (err) {
            toast.error(`Ошибка восстановления: ${err.message}`);
        } finally {
            setRestoring(false);
            if (fileRef.current) fileRef.current.value = '';
        }
    };

    return (
        <Card title="💾 Резервное копирование"
              subtitle="Для переноса панели на другой сервер: скачайте бэкап здесь и восстановите его там">
            <div className="flex flex-wrap gap-2">
                <button className="btn-secondary" onClick={download}>
                    ⬇️ Скачать бэкап (все данные)
                </button>
                <label className="btn-secondary cursor-pointer">
                    ⬆️ Восстановить из файла
                    <input ref={fileRef} type="file" accept=".json,application/json"
                           className="hidden" onChange={restore} disabled={restoring} />
                </label>
                {restoring && <span className="text-sm text-slate-500 self-center">Восстановление...</span>}
            </div>
            <p className="text-xs text-slate-400 mt-3">
                В бэкап входят: администраторы, клиенты, тарифы, платежи, настройки (включая токены),
                промокоды, API-ключи, вебхуки, тикеты. Схема базы обновляется автоматически.
            </p>
        </Card>
    );
}

/** Карточка смены домена: новый домен через Helper без переустановки панели */
function DomainCard() {
    const [info, setInfo] = useState(null);
    const [newDomain, setNewDomain] = useState('');
    const [force, setForce] = useState(false);
    const [busy, setBusy] = useState(false);
    const [changed, setChanged] = useState(false);

    useEffect(() => {
        get('/settings/domain').then(setInfo).catch(() => {});
    }, []);

    const changeDomain = async () => {
        const d = newDomain.trim().toLowerCase();
        if (!confirm(`Сменить домен ${info?.domain} → ${d}?\n\nСтарые ссылки клиентов перестанут работать — после смены разошлите новые ссылки.`)) return;
        setBusy(true);
        try {
            await post('/settings/domain', { domain: d, force });
            toast.success('Смена домена запущена — панель перезапустится');
            setChanged(true);
            // Панель перезапустится: через 20 сек пробуем перезагрузить страницу
            setTimeout(() => window.location.reload(), 20000);
        } catch (e) {
            toast.error(e.message);
        } finally {
            setBusy(false);
        }
    };

    const notifyClients = async () => {
        if (!confirm('Разослать новые ссылки всем активным клиентам в боте?')) return;
        setBusy(true);
        try {
            const r = await post('/settings/domain/notify', {});
            toast.success(`Отправлено: ${r.sent} из ${r.total} (не доставлено: ${r.failed})`);
        } catch (e) {
            toast.error(e.message);
        } finally {
            setBusy(false);
        }
    };

    return (
        <Card title="🌐 Домен панели"
              subtitle={`Текущий: ${info?.domain ?? '...'}`}>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-end">
                <Field label="Новый домен"
                       hint="Сначала поменяйте A-запись домена на IP этого сервера (DNS обновится за 5–30 минут)">
                    <input className="input font-mono" placeholder="proxy2.example.com"
                           value={newDomain}
                           onChange={(e) => setNewDomain(e.target.value)} />
                </Field>
                <div className="space-y-3">
                    <Toggle label="Принудительно (даже если DNS не проверился)"
                            checked={force}
                            onChange={setForce} />
                    <button className="btn-primary w-full" disabled={busy || !newDomain.trim()} onClick={changeDomain}>
                        Сменить домен
                    </button>
                </div>
            </div>
            {changed && (
                <div className="mt-4 p-3 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800">
                    <p className="text-sm">
                        ⏳ Панель перезапускается с новым доменом. Обновите страницу через 30–60 секунд,
                        затем разошлите клиентам новые ссылки — старые перестанут работать.
                    </p>
                    <button className="btn-secondary mt-2 text-sm" disabled={busy} onClick={notifyClients}>
                        📣 Разослать новые ссылки активным клиентам
                    </button>
                </div>
            )}
        </Card>
    );
}
