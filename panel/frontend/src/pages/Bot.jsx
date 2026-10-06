// Настройка Telegram-бота продаж: админка (пользователи, баланс), тарифы, платежки
import React, { useEffect, useState } from 'react';
import { Plus, Save, Trash2, Power, Wallet, MessageSquare, ChevronDown, Pencil, Bot as BotIcon } from 'lucide-react';
import { get, post, put, del } from '../api';
import { toast } from '../store';
import { Card, Field, Toggle, Skeleton, Modal, StatusBadge, formatDate, PageHeader } from '../components/ui';

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
    const [users, setUsers] = useState(null);
    const [balanceModal, setBalanceModal] = useState(null); // {tgId, name}
    const [balanceAmount, setBalanceAmount] = useState('');
    const [issueModal, setIssueModal] = useState(null);     // {telegram_id, days, protocols, max_ips, quota_gb}
    const [issueBusy, setIssueBusy] = useState(false);
    const [editCard, setEditCard] = useState(null);     // 'buttons' | 'basic' | 'sub' | 'pay' — модалка настроек
    const [tariffModal, setTariffModal] = useState(null);   // редактирование тарифа (null = закрыто)

    const toggleTariff = async (t, v) => {
        if (!t.id) return;
        try {
            await put(`/bot/tariffs/${t.id}`, { ...t, enabled: v ? 1 : 0 });
            load();
        } catch (e) { toast.error(e.message); }
    };
    const [msgModal, setMsgModal] = useState(null); // {tgId, name}
    const [msgText, setMsgText] = useState('');
    const [expanded, setExpanded] = useState(null); // раскрытый tgId

    const load = () => {
        get('/bot/status').then(setBotStatus).catch(() => setBotStatus({ running: false }));
        get('/bot/settings').then((d) => setSettings(d)).catch((e) => toast.error(e.message));
        get('/bot/tariffs').then((d) => setTariffs(d.tariffs)).catch(() => {});
        get('/bot/stats').then(setStats).catch(() => {});
        get('/bot/users').then((d) => setUsers(d.users)).catch(() => {});
    };
    useEffect(load, []);

    const saveSettings = async () => {
        try {
            await put('/bot/settings', settings);
            toast.success('Настройки бота сохранены');
            load();
        } catch (e) {
            toast.error(e.message);
        }
    };

    const saveTariff = async (t) => {
        // Нормализация: пустые строки → null (без лимита)
        const payload = {
            ...t,
            max_ips: t.max_ips === '' || t.max_ips == null ? null : Number(t.max_ips),
            quota_gb: t.quota_gb === '' || t.quota_gb == null ? null : Number(t.quota_gb),
        };
        try {
            if (payload.id) {
                await put(`/bot/tariffs/${payload.id}`, payload);
            } else {
                await post('/bot/tariffs', payload);
            }
            toast.success('Тариф сохранён');
            load();
        } catch (e) {
            toast.error(e.message);
        }
    };

    const deleteTariff = async (id) => {
        if (!confirm('Удалить тариф?')) return;
        try {
            await del(`/bot/tariffs/${id}`);
            load();
        } catch (e) {
            toast.error(e.message);
        }
    };

    if (!settings || !tariffs) return <div className="space-y-4">{[...Array(3)].map((_, i) => <Skeleton key={i} className="h-48" />)}</div>;

    return (
        <div className="space-y-6">
            <PageHeader icon={<BotIcon size={20} />} title="Telegram бот продаж"
                        subtitle="Тарифы, платежи, пользователи и статистика продаж"
                        actions={
                            <span className={botStatus?.running ? 'badge-green' : 'badge-red'}>
                                {botStatus?.running ? '✅ Бот запущен' : '❌ Бот остановлен'}
                            </span>
                        } />

            {/* Статистика продаж */}
            {stats && (
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                    <Card><div className="text-2xl font-bold">{stats.sales_total}</div><div className="text-sm text-slate-500">Продаж всего</div></Card>
                    <Card><div className="text-2xl font-bold">{stats.sales_month}</div><div className="text-sm text-slate-500">За месяц</div></Card>
                    <Card><div className="text-2xl font-bold">{stats.revenue_month} ₽</div><div className="text-sm text-slate-500">Доход за месяц</div></Card>
                    <Card className="flex flex-col justify-between">
                        <div>
                            <div className="text-2xl font-bold">{stats.revenue_total} ₽</div>
                            <div className="text-sm text-slate-500">Доход всего</div>
                        </div>
                        <button className="btn-danger !min-h-0 !px-2 !py-1.5 text-xs mt-2"
                                onClick={async () => {
                                    if (!confirm('Сбросить статистику продаж и дохода? История платежей будет удалена (клиенты останутся).')) return;
                                    try {
                                        await post('/bot/stats/reset');
                                        toast.success('Статистика сброшена');
                                        load();
                                    } catch (e) { toast.error(e.message); }
                                }}>
                                🧹 Сбросить продажи
                        </button>
                    </Card>
                </div>
            )}

            {/* ═══ Админка бота: пользователи Telegram ═══ */}
            <Card title="👥 Пользователи бота"
                  subtitle="Все пользователи бота (сгруппированы по Telegram)"
                  actions={
                      <button className="btn-secondary !min-h-0 !px-3 !py-1.5 text-sm" onClick={load}>
                          Обновить
                      </button>
                  }>
                {!users ? <Skeleton className="h-24" /> : users.length === 0 ? (
                    <p className="text-sm text-slate-500 py-4 text-center">Пользователей бота пока нет</p>
                ) : (
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="text-left text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-slate-700">
                                <th className="py-2 pr-4 font-medium">Telegram ID</th>
                                <th className="py-2 pr-4 font-medium">Прокси</th>
                                <th className="py-2 pr-4 font-medium">Баланс</th>
                                <th className="py-2 pr-4 font-medium text-right">Действия</th>
                            </tr>
                        </thead>
                        <tbody>
                            {users.map((u) => (
                                <React.Fragment key={u.telegram_id}>
                                    <tr className="border-b border-slate-100 dark:border-slate-800">
                                        <td className="py-2 pr-4">
                                            <div className="flex flex-wrap items-center gap-2">
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
                                        <td className="py-2 pr-4">
                                            <span className="badge-green">🟢 {u.active} актив.</span>{' '}
                                            <span className="text-xs text-slate-400">всего {u.proxies.length}</span>
                                        </td>
                                        <td className="py-2 pr-4 font-medium">{u.balance.toFixed(2)}</td>
                                        <td className="py-2 pr-4">
                                            <div className="flex justify-end gap-1">
                                                <button className="btn-secondary !min-h-0 !px-2 !py-1.5 text-xs"
                                                        title="Выдать прокси с настройками"
                                                        onClick={() => setIssueModal({ telegram_id: u.telegram_id, days: 30, protocols: 'both', max_ips: '', quota_gb: '' })}>
                                                    🌐 Выдать прокси
                                                </button>
                                                <button className="btn-secondary !min-h-0 !px-2 !py-1.5 text-xs"
                                                        title="Выдать баланс"
                                                        onClick={() => { setBalanceModal(u); setBalanceAmount(''); }}>
                                                    <Wallet size={14} /> Баланс
                                                </button>
                                                <button className="btn-secondary !min-h-0 !px-2 !py-1.5 text-xs"
                                                        title="Написать через бота"
                                                        onClick={() => { setMsgModal(u); setMsgText(''); }}>
                                                    <MessageSquare size={14} /> Написать
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                    {/* Раскрытый список прокси пользователя */}
                                    {expanded === u.telegram_id && (
                                        <tr className="border-b border-slate-100 dark:border-slate-800">
                                            <td colSpan={4} className="py-3 px-4 bg-slate-50 dark:bg-slate-800/50 rounded-lg">
                                                <table className="w-full text-xs">
                                                    <thead>
                                                        <tr className="text-left text-slate-400">
                                                            <th className="py-1 pr-4">Прокси</th>
                                                            <th className="py-1 pr-4">Статус</th>
                                                            <th className="py-1 pr-4">Действует до</th>
                                                            <th className="py-1">Баланс</th>
                                                        </tr>
                                                    </thead>
                                                    <tbody>
                                                        {u.proxies.map((p) => (
                                                            <tr key={p.id}>
                                                                <td className="py-1 pr-4 font-mono">{p.username}</td>
                                                                <td className="py-1 pr-4"><StatusBadge status={p.status} /></td>
                                                                <td className="py-1 pr-4">{p.expires_at ? formatDate(p.expires_at).split(',')[0] : '∞'}</td>
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
                )}
            </Card>

            {/* Модал: выдать/списать баланс */}
            {/* Модал: выдать прокси пользователю */}
            <Modal open={!!issueModal} onClose={() => setIssueModal(null)}
                   title={`Выдать прокси: ${issueModal?.telegram_id}`}>
                <div className="grid grid-cols-2 gap-3">
                    <Field label="Срок (дней)">
                        <input className="input" type="number" min="1" value={issueModal?.days ?? 30}
                               onChange={(e) => setIssueModal((m) => ({ ...m, days: e.target.value }))} />
                    </Field>
                    <Field label="Протоколы">
                        <select className="input" value={issueModal?.protocols ?? 'both'}
                                onChange={(e) => setIssueModal((m) => ({ ...m, protocols: e.target.value }))}>
                            <option value="both">Оба (Web + MTProto)</option>
                            <option value="web">Только Web Proxy</option>
                            <option value="mtproto">Только MTProto</option>
                        </select>
                    </Field>
                    <Field label="Макс. IP" hint="Пусто = без лимита">
                        <input className="input" type="number" min="1" placeholder="∞" value={issueModal?.max_ips ?? ''}
                               onChange={(e) => setIssueModal((m) => ({ ...m, max_ips: e.target.value }))} />
                    </Field>
                    <Field label="Трафик, ГБ" hint="Пусто = без лимита">
                        <input className="input" type="number" min="0" placeholder="∞" value={issueModal?.quota_gb ?? ''}
                               onChange={(e) => setIssueModal((m) => ({ ...m, quota_gb: e.target.value }))} />
                    </Field>
                </div>
                <p className="text-xs text-slate-400 mt-3">
                    Прокси создастся в Telemt и привяжется к telegram_id пользователя — он сразу получит
                    ссылки в боте. Выданный ранее баланс перенесётся на новый прокси.
                </p>
                <div className="flex justify-end gap-2 mt-4">
                    <button className="btn-secondary" onClick={() => setIssueModal(null)}>Отмена</button>
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
                                    toast.success(`Прокси ${r.username} выдан${r.notified ? ' — уведомлён' : ' (бот не смог написать)'}`);
                                    setIssueModal(null);
                                    load();
                                } catch (e) { toast.error(e.message); }
                                finally { setIssueBusy(false); }
                            }}>
                        🌐 Выдать прокси
                    </button>
                </div>
            </Modal>

            {/* Модал: настройки (кастомные кнопки / основные / подписка / платежи) */}
            <Modal open={!!editCard} onClose={() => setEditCard(null)} wide
                   title={editCard === 'buttons' ? '🔗 Кастомные кнопки в боте'
                       : editCard === 'basic' ? '🤖 Основные настройки'
                       : editCard === 'sub' ? '📢 Обязательная подписка на канал'
                       : '💳 Платёжные системы'}>
                {editCard === 'buttons' && (
                    <div className="space-y-2">
                        {(settings.custom_buttons || []).map((b, i) => (
                            <div key={i} className="flex flex-wrap items-center gap-2 p-2 rounded-lg bg-slate-50 dark:bg-slate-800/50">
                                <input className="input !w-44" placeholder="НАЗВАНИЕ КНОПКИ"
                                       value={b.name}
                                       onChange={(e) => setSettings((s) => ({
                                           ...s,
                                           custom_buttons: s.custom_buttons.map((x, j) => j === i ? { ...x, name: e.target.value } : x),
                                       }))} />
                                <input className="input flex-1 min-w-[200px] font-mono text-xs" placeholder="https://t.me/channel"
                                       value={b.url}
                                       onChange={(e) => setSettings((s) => ({
                                           ...s,
                                           custom_buttons: s.custom_buttons.map((x, j) => j === i ? { ...x, url: e.target.value } : x),
                                       }))} />
                                <Toggle label="Вкл" checked={b.enabled !== false}
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
                                <Plus size={14} /> Добавить кнопку
                            </button>
                        )}
                    </div>
                )}

                {editCard === 'basic' && (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <Field label="Bot Token" hint="Получите у @BotFather в Telegram">
                            <input className="input font-mono" value={settings.bot_token ?? ''}
                                   onChange={(e) => setSettings({ ...settings, bot_token: e.target.value })} />
                        </Field>
                        <Field label="Валюта цен">
                            <select className="input" value={settings.currency ?? 'RUB'}
                                    onChange={(e) => setSettings({ ...settings, currency: e.target.value })}>
                                <option value="RUB">₽ Рубли</option>
                                <option value="USD">$ Доллары</option>
                                <option value="USDT">₮ USDT</option>
                            </select>
                        </Field>
                        <Field label="Приветственное сообщение" hint="Переменные: {имя}, {ссылка}, {дата}. Пусто — встроенное красивое приветствие">
                            <textarea className="input min-h-[100px]" value={settings.welcome_text ?? ''}
                                      onChange={(e) => setSettings({ ...settings, welcome_text: e.target.value })} />
                        </Field>
                        <Field label="🟢 Ссылка на статус-страницу"
                               hint="Кнопка «Статус сервиса» в боте: меню тарифов, поддержка, сообщение после покупки. Пусто — кнопки нет">
                            <input className="input font-mono" placeholder="https://status.ваш-домен.com/status"
                                   value={settings.status_url ?? ''}
                                   onChange={(e) => setSettings({ ...settings, status_url: e.target.value })} />
                        </Field>
                        <div className="space-y-3 md:col-span-2">
                            <Toggle label="Бот включён" checked={!!settings.enabled}
                                    onChange={(v) => setSettings({ ...settings, enabled: v })} />
                            <Toggle label="Уведомлять админа о покупках" checked={!!settings.notify_admin}
                                    onChange={(v) => setSettings({ ...settings, notify_admin: v })} />
                        </div>
                    </div>
                )}

                {editCard === 'sub' && (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <Field label="Юзернейм канала" hint="Например: @my_proxy_channel (бот должен быть админом канала)">
                            <input className="input font-mono" placeholder="@my_proxy_channel"
                                   value={settings.channel_username ?? ''}
                                   onChange={(e) => setSettings({ ...settings, channel_username: e.target.value })} />
                        </Field>
                        <div className="flex items-end pb-2">
                            <Toggle label="Требовать подписку для пользования ботом"
                                    checked={!!settings.channel_required}
                                    onChange={(v) => setSettings({ ...settings, channel_required: v })} />
                        </div>
                        <p className="text-xs text-slate-400 md:col-span-2">
                            ⚠️ Добавьте бота администратором в канал, иначе проверка подписи работать не будет
                            (при недоступности канала проверка автоматически отключается).
                        </p>
                    </div>
                )}

                {editCard === 'pay' && (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <Field label="🪙 CryptoBot (CryptoCloud) — токен" hint="Из @CryptoBot → Crypto Pay → Create App">
                            <input className="input font-mono" value={settings.cryptobot_token ?? ''}
                                   onChange={(e) => setSettings({ ...settings, cryptobot_token: e.target.value })} />
                        </Field>
                        <div />
                        <Field label="🏦 ЮKassa — shopId">
                            <input className="input font-mono" value={settings.yookassa_shop_id ?? ''}
                                   onChange={(e) => setSettings({ ...settings, yookassa_shop_id: e.target.value })} />
                        </Field>
                        <Field label="🏦 ЮKassa — секретный ключ">
                            <input className="input font-mono" type="password" value={settings.yookassa_secret_key ?? ''}
                                   onChange={(e) => setSettings({ ...settings, yookassa_secret_key: e.target.value })} />
                        </Field>
                        <Field label="💳 Карта для ручной оплаты" hint="Показывается в боте при оплате напрямую">
                            <input className="input font-mono" value={settings.pay_card ?? ''}
                                   onChange={(e) => setSettings({ ...settings, pay_card: e.target.value })} />
                        </Field>
                        <Field label="📱 Телефон для СБП">
                            <input className="input font-mono" value={settings.pay_phone ?? ''}
                                   onChange={(e) => setSettings({ ...settings, pay_phone: e.target.value })} />
                        </Field>
                        <Field label="🏦 Название банка">
                            <input className="input" value={settings.pay_bank ?? ''}
                                   onChange={(e) => setSettings({ ...settings, pay_bank: e.target.value })} />
                        </Field>
                        <Field label="📝 Инструкция для ручной оплаты" hint="Показывается в боте, если ни одна платёжка не подключена (пусто — покажем карту/СБП)" className="md:col-span-2">
                            <textarea className="input min-h-[70px]" value={settings.payment_instructions ?? ''}
                                      onChange={(e) => setSettings({ ...settings, payment_instructions: e.target.value })} />
                        </Field>
                        <div className="flex items-end pb-2">
                            <Toggle label="⭐ Telegram Stars (оплата звёздами)"
                                    checked={!!settings.stars_enabled}
                                    onChange={(v) => setSettings({ ...settings, stars_enabled: v })} />
                        </div>
                        <div />
                        <Field label="⭐ Курс: 1 звезда = ₽" hint="Для тарифов в рублях. Звёзды = цена / курс, округление вверх">
                            <input className="input" type="number" step="0.01" min="0.01" value={settings.stars_rate_rub ?? 2}
                                   onChange={(e) => setSettings({ ...settings, stars_rate_rub: Number(e.target.value) })} />
                        </Field>
                        <Field label="⭐ Курс: 1 звезда = $" hint="Для тарифов в $ и USDT">
                            <input className="input" type="number" step="0.001" min="0.001" value={settings.stars_rate_usd ?? 0.02}
                                   onChange={(e) => setSettings({ ...settings, stars_rate_usd: Number(e.target.value) })} />
                        </Field>
                        <p className="text-xs text-slate-400 md:col-span-2">
                            Вебхук CryptoBot: <code className="font-mono">https://ваш-домен/api/payments/webhook/cryptobot</code>
                            (вставьте в @CryptoBot → Webhooks). ЮKassa → <code className="font-mono">/api/payments/webhook/yookassa</code>.
                            Если счёт не создаётся — проверьте с VPS: <code className="font-mono">curl -I https://pay.crypt.bot</code> (домен должен быть доступен).
                        </p>
                    </div>
                )}

                <div className="flex justify-end gap-2 mt-4">
                    <button className="btn-secondary" onClick={() => setEditCard(null)}>Отмена</button>
                    <button className="btn-primary"
                            onClick={async () => {
                                try {
                                    await saveSettings();
                                    setEditCard(null);
                                } catch { /* ошибка уже показана тостом */ }
                            }}>
                        <Save size={14} /> Сохранить
                    </button>
                </div>
            </Modal>

            <Modal open={!!balanceModal} onClose={() => setBalanceModal(null)}
                   title={`Баланс: ${balanceModal?.telegram_id}`}>
                <Field label="Сумма" hint="Положительная — начислить, отрицательная — списать">
                    <input className="input" type="number" value={balanceAmount}
                           onChange={(e) => setBalanceAmount(e.target.value)} autoFocus />
                </Field>
                <div className="flex justify-end gap-2 mt-4">
                    <button className="btn-secondary" onClick={() => setBalanceModal(null)}>Отмена</button>
                    <button className="btn-primary" disabled={!balanceAmount}
                            onClick={async () => {
                                try {
                                    await post(`/bot/users/${balanceModal.telegram_id}/balance`, { amount: Number(balanceAmount) });
                                    toast.success('Баланс изменён');
                                    setBalanceModal(null);
                                    load();
                                } catch (e) { toast.error(e.message); }
                            }}>
                        Применить
                    </button>
                </div>
            </Modal>

            {/* Модал: написать пользователю через бота */}
            <Modal open={!!msgModal} onClose={() => setMsgModal(null)}
                   title={`Сообщение: ${msgModal?.telegram_id}`}>
                <Field label="Текст (HTML разрешён)">
                    <textarea className="input min-h-[100px]" value={msgText}
                              onChange={(e) => setMsgText(e.target.value)} autoFocus />
                </Field>
                <div className="flex justify-end gap-2 mt-4">
                    <button className="btn-secondary" onClick={() => setMsgModal(null)}>Отмена</button>
                    <button className="btn-primary" disabled={!msgText.trim()}
                            onClick={async () => {
                                try {
                                    await post(`/bot/users/${msgModal.telegram_id}/message`, { text: msgText });
                                    toast.success('Отправлено через бота');
                                    setMsgModal(null);
                                } catch (e) { toast.error(e.message); }
                            }}>
                        Отправить
                    </button>
                </div>
            </Modal>

            {/* Кастомные кнопки в боте: сводка + модалка */}
            <Card title="🔗 Кастомные кнопки в боте"
                  subtitle="Появятся в меню тарифов — ссылки на каналы, ботов, сайты"
                  actions={
                      <button className="btn-ghost !min-h-0 !p-2" title="Изменить кнопки"
                              onClick={() => setEditCard('buttons')}>
                          <Pencil size={16} />
                      </button>
                  }>
                {!settings ? <Skeleton className="h-20" /> : (settings.custom_buttons || []).length === 0 ? (
                    <p className="text-sm text-slate-500 py-2">Кнопок нет — нажмите ✏️, чтобы добавить</p>
                ) : (
                    <div className="space-y-2">
                        {(settings.custom_buttons || []).map((b, i) => (
                            <div key={i} className="flex flex-wrap items-center gap-2 p-2 rounded-lg bg-slate-50 dark:bg-slate-800/50">
                                <span className="font-medium text-sm">{b.name || 'Без названия'}</span>
                                <span className="font-mono text-xs text-slate-400 break-all">{b.url}</span>
                                <span className={b.enabled !== false ? 'badge-green' : 'badge-red'}>
                                    {b.enabled !== false ? 'Вкл' : 'Выкл'}
                                </span>
                            </div>
                        ))}
                    </div>
                )}
            </Card>

            {/* Основные настройки: сводка + модалка */}
            <Card title="🤖 Основные настройки" actions={
                <button className="btn-ghost !min-h-0 !p-2" title="Изменить"
                        onClick={() => setEditCard('basic')}>
                    <Pencil size={16} />
                </button>
            }>
                <div>
                    {settingRow('Bot Token', settings.bot_token || 'не задан')}
                    {settingRow('Валюта цен', { RUB: '₽ Рубли', USD: '$ Доллары', USDT: '₮ USDT' }[settings.currency] || settings.currency)}
                    {settingRow('Приветствие', settings.welcome_text ? `${String(settings.welcome_text).slice(0, 60)}…` : 'встроенное')}
                    {settingRow('Ссылка на статус-страницу', settings.status_url || 'нет')}
                    {settingRow('Бот включён', settings.enabled ? '✅ Да' : '❌ Нет')}
                    {settingRow('Уведомления админу', settings.notify_admin ? '✅ Да' : '❌ Нет')}
                </div>
            </Card>

            {/* Обязательная подписка на канал: сводка + модалка */}
            <Card title="📢 Обязательная подписка на канал"
                  subtitle="Бот не будет работать, пока пользователь не подпишется на канал"
                  actions={
                      <button className="btn-ghost !min-h-0 !p-2" title="Изменить"
                              onClick={() => setEditCard('sub')}>
                          <Pencil size={16} />
                      </button>
                  }>
                <div>
                    {settingRow('Юзернейм канала', settings.channel_username || 'не задан')}
                    {settingRow('Требовать подписку', settings.channel_required ? '✅ Да' : '❌ Нет')}
                </div>
            </Card>

            {/* Платёжные системы: сводка + модалка */}
            <Card title="💳 Платёжные системы"
                  subtitle="Настройте одну из них — счёт будет создаваться автоматически, доступ выдаётся после оплаты"
                  actions={
                      <button className="btn-ghost !min-h-0 !p-2" title="Изменить"
                              onClick={() => setEditCard('pay')}>
                          <Pencil size={16} />
                      </button>
                  }>
                <div>
                    {settingRow('🪙 CryptoBot', settings.cryptobot_token ? 'настроен' : 'не настроен')}
                    {settingRow('🏦 ЮKassa', (settings.yookassa_shop_id && settings.yookassa_secret_key) ? 'настроена' : 'не настроена')}
                    {settingRow('🏦 Карта админа', settings.pay_card || 'не задана')}
                    {settingRow('⭐ Telegram Stars', settings.stars_enabled
                        ? `включены (${settings.stars_rate_rub ?? 2} ₽ / ${settings.stars_rate_usd ?? 0.02} $ за ⭐)`
                        : 'выключены')}
                </div>
            </Card>

            {/* Тарифы: компактный список + модалка редактирования */}
            <Card title="💰 Тарифы" actions={
                <button className="btn-secondary !min-h-0 !px-3 !py-1.5 text-sm"
                        onClick={() => setTariffModal({ name: '', days: 30, price: 100, protocols: 'both', max_ips: null, quota_gb: null, enabled: 1 })}>
                    <Plus size={14} /> Добавить
                </button>
            }>
                <div className="space-y-2">
                    {tariffs.map((t) => {
                        const cur = settings.currency ?? 'RUB';
                        const sign = cur === 'RUB' ? '₽' : cur === 'USD' ? '$' : cur === 'USDT' ? '₮' : cur;
                        const protoLabel = t.protocols === 'web' ? '🌐 Web Proxy'
                            : t.protocols === 'mtproto' ? '🔌 MTProto' : '🌐 Web + 🔌 MTProto';
                        const limits = `${t.max_ips ? `${t.max_ips} IP` : 'IP ∞'} · ${t.quota_gb ? `${t.quota_gb} ГБ` : 'трафик ∞'}`;
                        const accent = !t.enabled ? 'border-slate-600'
                            : t.protocols === 'web' ? 'border-sky-500'
                            : t.protocols === 'mtproto' ? 'border-violet-500' : 'border-emerald-500';
                        return (
                            <div key={t.id ?? t.name}
                                 className={`flex flex-wrap items-center gap-3 p-3 rounded-xl border-l-4 ${accent} bg-slate-50 dark:bg-slate-800/50 ${t.enabled ? '' : 'opacity-60'}`}>
                                <div className="flex-1 min-w-[180px]">
                                    <div className="font-medium">{t.name || 'Без названия'}</div>
                                    <div className="text-xs text-slate-400">
                                        {t.days} дн. · <b className="text-slate-700 dark:text-slate-200">{t.price} {sign}</b> · {protoLabel} · {limits}
                                    </div>
                                </div>
                                <Toggle label="Вкл" checked={!!t.enabled}
                                        onChange={(v) => toggleTariff(t, v)} />
                                <div className="flex gap-1">
                                    <button className="btn-ghost !min-h-0 !p-2" title="Редактировать"
                                            onClick={() => setTariffModal({ ...t })}>
                                        <Pencil size={16} />
                                    </button>
                                    {t.id && (
                                        <button className="btn-ghost !min-h-0 !p-2 text-red-500" title="Удалить"
                                                onClick={() => deleteTariff(t.id)}>
                                            <Trash2 size={16} />
                                        </button>
                                    )}
                                </div>
                            </div>
                        );
                    })}
                    {tariffs.length === 0 && <p className="text-sm text-slate-500 text-center py-4">Тарифов нет — добавьте первый</p>}
                </div>
            </Card>

            {/* Модал: создание/редактирование тарифа */}
            <Modal open={!!tariffModal} onClose={() => setTariffModal(null)}
                   title={tariffModal?.id ? 'Редактировать тариф' : 'Новый тариф'}>
                {tariffModal && (() => {
                    const cur = settings.currency ?? 'RUB';
                    const sign = cur === 'RUB' ? '₽' : cur === 'USD' ? '$' : cur === 'USDT' ? '₮' : cur;
                    const protoLabel = tariffModal.protocols === 'web' ? 'Web Proxy'
                        : tariffModal.protocols === 'mtproto' ? 'MTProto' : 'Web Proxy + MTProto';
                    const upd = (patch) => setTariffModal((m) => ({ ...m, ...patch }));
                    return (
                        <>
                            <div className="grid grid-cols-2 gap-3">
                                <Field label="Название" hint="Можно со смайлами 🚀💎🔥" className="col-span-2">
                                    <input className="input" value={tariffModal.name ?? ''}
                                           onChange={(e) => upd({ name: e.target.value })} />
                                </Field>
                                <Field label="Срок (дней)">
                                    <input className="input" type="number" min="1" value={tariffModal.days ?? 30}
                                           onChange={(e) => upd({ days: Number(e.target.value) })} />
                                </Field>
                                <Field label={`Цена, ${sign}`}>
                                    <input className="input" type="number" min="0" value={tariffModal.price ?? 0}
                                           onChange={(e) => upd({ price: Number(e.target.value) })} />
                                </Field>
                                <Field label="Протоколы">
                                    <select className="input" value={tariffModal.protocols ?? 'both'}
                                            onChange={(e) => upd({ protocols: e.target.value })}>
                                        <option value="both">Оба</option>
                                        <option value="web">Web Proxy</option>
                                        <option value="mtproto">MTProto</option>
                                    </select>
                                </Field>
                                <Field label="Макс. IP" hint="Пусто = ∞">
                                    <input className="input" type="number" min="1" value={tariffModal.max_ips ?? ''}
                                           onChange={(e) => upd({ max_ips: e.target.value === '' ? null : Number(e.target.value) })} />
                                </Field>
                                <Field label="Трафик, ГБ" hint="Пусто = ∞">
                                    <input className="input" type="number" min="0" value={tariffModal.quota_gb ?? ''}
                                           onChange={(e) => upd({ quota_gb: e.target.value === '' ? null : Number(e.target.value) })} />
                                </Field>
                                <div className="flex items-end pb-1">
                                    <Toggle label="Включён" checked={!!tariffModal.enabled}
                                            onChange={(v) => upd({ enabled: v ? 1 : 0 })} />
                                </div>
                            </div>
                            <p className="text-xs text-slate-400 mt-3">
                                👁 Клиент увидит: <b className="text-slate-700 dark:text-slate-200">{tariffModal.name || '—'} — {tariffModal.days} дн. — {tariffModal.price} {sign}</b> · {protoLabel}
                            </p>
                            <div className="flex justify-end gap-2 mt-4">
                                <button className="btn-secondary" onClick={() => setTariffModal(null)}>Отмена</button>
                                <button className="btn-primary"
                                        onClick={async () => {
                                            try {
                                                await saveTariff(tariffModal);
                                                setTariffModal(null);
                                            } catch { /* ошибка уже показана тостом */ }
                                        }}>
                                    <Save size={14} /> Сохранить
                                </button>
                            </div>
                        </>
                    );
                })()}
            </Modal>
        </div>
    );
}
