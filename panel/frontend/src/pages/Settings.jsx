// Настройки панели с категориями
import React, { useEffect, useState } from 'react';
import { Save } from 'lucide-react';
import { get, put } from '../api';
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
        id: 'security', icon: '🔒', title: 'Безопасность',
        fields: [
            { key: 'login_rate_limit', label: 'Лимит попыток входа (за 15 мин)', type: 'number' },
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
        </div>
    );
}
