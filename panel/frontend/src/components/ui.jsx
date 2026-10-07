// Базовые UI-компоненты TGGATE (стилистика shadcn/ui на Tailwind)
import React from 'react';
import { useToastStore } from '../store';
import { useT } from '../i18n';
import { CheckCircle, XCircle, Info } from 'lucide-react';

/** Карточка-контейнер */
export function Card({ title, subtitle, actions, children, className = '' }) {
    return (
        <div className={`card ${className}`}>
            {(title || actions) && (
                <div className="flex items-start justify-between mb-4">
                    <div>
                        {title && <h3 className="text-lg font-semibold">{title}</h3>}
                        {subtitle && <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">{subtitle}</p>}
                    </div>
                    {actions && <div className="flex gap-2">{actions}</div>}
                </div>
            )}
            {children}
        </div>
    );
}

/** Индикатор статуса сервиса */
export function StatusDot({ ok, label }) {
    const t = useT();
    return (
        <span className="inline-flex items-center gap-2 text-sm">
            <span className={`w-2.5 h-2.5 rounded-full ${ok ? 'bg-emerald-500' : 'bg-red-500'} ${ok ? 'animate-pulse' : ''}`} />
            {label}
            <span className={ok ? 'text-emerald-500' : 'text-red-500'}>{ok ? t('ui.svcWorks') : t('ui.svcDown')}</span>
        </span>
    );
}

/** Прогресс-бар (например, квота трафика) */
export function ProgressBar({ percent, className = '' }) {
    const p = Math.min(100, Math.max(0, percent ?? 0));
    const color = p >= 90 ? 'bg-red-500' : p >= 70 ? 'bg-amber-500' : 'bg-emerald-500';
    return (
        <div className={`w-full h-2 rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden ${className}`}>
            <div className={`h-full rounded-full transition-all duration-500 ${color}`} style={{ width: `${p}%` }} />
        </div>
    );
}

/** Бейдж статуса клиента */
export function StatusBadge({ status }) {
    const t = useT();
    const map = {
        active: ['badge-green', t('ui.stActive')],
        blocked: ['badge-red', t('ui.stBlocked')],
        expired: ['badge-yellow', t('ui.stExpired')],
    };
    const [cls, text] = map[status] || ['badge-blue', status];
    return <span className={cls}>{text}</span>;
}

/** Скелетон загрузки */
export function Skeleton({ className = '' }) {
    return <div className={`animate-pulse rounded-lg bg-slate-200 dark:bg-slate-800 ${className}`} />;
}

/** Поле ввода с подписью */
export function Field({ label, hint, error, children }) {
    return (
        <label className="block">
            <span className="block text-sm font-medium mb-1.5">{label}</span>
            {children}
            {hint && !error && <span className="block text-xs text-slate-500 mt-1">{hint}</span>}
            {error && <span className="block text-xs text-red-500 mt-1">{error}</span>}
        </label>
    );
}

/** Чекбокс-переключатель (toggle) */
export function Toggle({ checked, onChange, label }) {
    return (
        <label className="inline-flex items-center gap-3 cursor-pointer select-none">
            <button
                type="button"
                role="switch"
                aria-checked={checked}
                onClick={() => onChange(!checked)}
                className={`relative w-11 h-6 rounded-full transition-all duration-200
                    ${checked
                        ? 'bg-gradient-to-r from-primary to-primary-600 shadow-sm shadow-primary/40'
                        : 'bg-slate-300 dark:bg-slate-600 hover:bg-slate-400 dark:hover:bg-slate-500'}`}
            >
                <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow-md
                    transition-transform duration-200 ${checked ? 'translate-x-5' : ''}`} />
            </button>
            {label && <span className="text-sm">{label}</span>}
        </label>
    );
}

/** Заголовок страницы: иконка + название + подзаголовок + действия */
export function PageHeader({ icon, title, subtitle, actions }) {
    return (
        <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
                <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-primary to-primary-600 flex items-center justify-center text-white shadow-lg shadow-primary/25 shrink-0">
                    {icon}
                </div>
                <div>
                    <h1 className="text-2xl font-bold leading-tight">{title}</h1>
                    {subtitle && <p className="text-sm text-slate-500 dark:text-slate-400">{subtitle}</p>}
                </div>
            </div>
            {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </div>
    );
}

/** Аватар-инициалы (цвет стабилен для одного имени) */
const AVATAR_COLORS = ['bg-blue-500', 'bg-emerald-500', 'bg-violet-500', 'bg-amber-500', 'bg-rose-500', 'bg-cyan-500'];
export function Avatar({ name, className = 'w-8 h-8 text-xs' }) {
    const clean = String(name || '?').replace(/^@/, '');
    const ch = (clean.charAt(0) || '?').toUpperCase();
    let h = 0;
    for (const c of clean) h = (h * 31 + c.charCodeAt(0)) >>> 0;
    return (
        <div className={`${className} rounded-full ${AVATAR_COLORS[h % AVATAR_COLORS.length]} flex items-center justify-center text-white font-bold shrink-0`} aria-hidden>
            {ch}
        </div>
    );
}

/** Компактная пилюля протокола */
export function ProtoBadge({ protocol }) {
    return protocol === 'web'
        ? <span className="badge-blue whitespace-nowrap">🌐 Web</span>
        : <span className="badge-violet whitespace-nowrap">🔌 MTProto</span>;
}

/** Модальное окно (на телефоне — шторка снизу) */
export function Modal({ open, onClose, title, children, wide }) {
    const t = useT();
    if (!open) return null;
    return (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-4"
             onClick={onClose} role="dialog" aria-modal="true">
            <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
            <div className={`relative card w-full ${wide ? 'max-w-3xl' : 'max-w-lg'} !rounded-b-none sm:!rounded-b-2xl max-h-[92vh] overflow-y-auto`}
                 onClick={(e) => e.stopPropagation()}>
                <div className="flex items-center justify-between mb-4">
                    <h3 className="text-lg font-semibold">{title}</h3>
                    <button onClick={onClose} className="btn-ghost !min-h-0 !p-2" aria-label={t('common.close')}>✕</button>
                </div>
                {children}
            </div>
        </div>
    );
}

/** Контейнер toast-уведомлений */
export function Toasts() {
    const toasts = useToastStore((s) => s.toasts);
    const tr = useT();
    const icons = {
        success: <CheckCircle size={18} className="text-emerald-500" />,
        error: <XCircle size={18} className="text-red-500" />,
        info: <Info size={18} className="text-blue-500" />,
    };
    return (
        <div className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2 max-w-sm">
            {toasts.map((t) => (
                <div key={t.id}
                     className={`card !p-3 flex items-center gap-2 shadow-lg animate-[slideIn_0.2s_ease-out] ${t.onClick ? 'cursor-pointer hover:brightness-110' : ''}`}
                     onClick={t.onClick}
                     title={t.onClick ? tr('ui.toastGo') : undefined}>
                    {icons[t.type]}
                    <span className="text-sm">{t.message}</span>
                </div>
            ))}
        </div>
    );
}

/** Форматирование байтов в читаемый вид */
export function formatBytes(bytes, lang = 'ru') {
    if (bytes == null) return '—';
    if (bytes === 0) return lang === 'en' ? '0 B' : '0 Б';
    const units = lang === 'en' ? ['B', 'KB', 'MB', 'GB', 'TB'] : ['Б', 'КБ', 'МБ', 'ГБ', 'ТБ'];
    const i = Math.min(units.length - 1, Math.floor(Math.log2(bytes) / 10));
    return `${(bytes / 1024 ** i).toFixed(i > 0 ? 1 : 0)} ${units[i]}`;
}

/** Единая тема графиков (recharts): сетка, подписи, тултипы, палитра */
export const chartTheme = {
    gridColor: '#334155',
    gridOpacity: 0.3,
    tick: { fontSize: 11, fill: '#94a3b8' },
    tooltip: { background: '#1e293b', border: '1px solid #334155', borderRadius: 8, color: '#e2e8f0' },
    colors: {
        primary: '#0088cc', green: '#10b981', amber: '#f59e0b',
        red: '#ef4444', violet: '#8b5cf6', blue: '#3b82f6',
    },
};

/** Форматирование даты */
export function formatDate(iso, lang = 'ru') {
    if (!iso) return '—';
    return new Date(iso).toLocaleString(lang === 'en' ? 'en-GB' : 'ru-RU', {
        day: '2-digit', month: '2-digit', year: 'numeric',
        hour: '2-digit', minute: '2-digit',
    });
}

/** Определение устройства по User-Agent (web-сессии Telemt). У MTProto UA нет. */
export function deviceInfo(ua, lang = 'ru') {
    const other = lang === 'en' ? 'Other' : 'Др.';
    if (!ua) return { icon: '', label: '—' };
    const s = String(ua).toLowerCase();
    if (s.includes('iphone') || s.includes('ipad')) return { icon: '📱', label: 'iOS' };
    if (s.includes('android')) return { icon: '🤖', label: 'Android' };
    if (s.includes('mac os') || s.includes('macintosh')) return { icon: '🍎', label: 'macOS' };
    if (s.includes('windows')) return { icon: '🖥️', label: 'Windows' };
    if (s.includes('linux') || s.includes('x11')) return { icon: '🐧', label: 'Linux' };
    return { icon: '🌐', label: other };
}
