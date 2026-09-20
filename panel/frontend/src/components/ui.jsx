// Базовые UI-компоненты TGGATE (стилистика shadcn/ui на Tailwind)
import React from 'react';
import { useToastStore } from '../store';
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
    return (
        <span className="inline-flex items-center gap-2 text-sm">
            <span className={`w-2.5 h-2.5 rounded-full ${ok ? 'bg-emerald-500' : 'bg-red-500'} ${ok ? 'animate-pulse' : ''}`} />
            {label}
            <span className={ok ? 'text-emerald-500' : 'text-red-500'}>{ok ? 'работает' : 'остановлен'}</span>
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
    const map = {
        active: ['badge-green', 'Активен'],
        blocked: ['badge-red', 'Заблокирован'],
        expired: ['badge-yellow', 'Просрочен'],
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
                className={`relative w-11 h-6 rounded-full transition-colors duration-200
                    ${checked ? 'bg-primary' : 'bg-slate-300 dark:bg-slate-600'}`}
            >
                <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow
                    transition-transform duration-200 ${checked ? 'translate-x-5' : ''}`} />
            </button>
            {label && <span className="text-sm">{label}</span>}
        </label>
    );
}

/** Модальное окно */
export function Modal({ open, onClose, title, children, wide }) {
    if (!open) return null;
    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
             onClick={onClose} role="dialog" aria-modal="true">
            <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
            <div className={`relative card w-full ${wide ? 'max-w-3xl' : 'max-w-lg'} max-h-[90vh] overflow-y-auto`}
                 onClick={(e) => e.stopPropagation()}>
                <div className="flex items-center justify-between mb-4">
                    <h3 className="text-lg font-semibold">{title}</h3>
                    <button onClick={onClose} className="btn-ghost !min-h-0 !p-2" aria-label="Закрыть">✕</button>
                </div>
                {children}
            </div>
        </div>
    );
}

/** Контейнер toast-уведомлений */
export function Toasts() {
    const toasts = useToastStore((s) => s.toasts);
    const icons = {
        success: <CheckCircle size={18} className="text-emerald-500" />,
        error: <XCircle size={18} className="text-red-500" />,
        info: <Info size={18} className="text-blue-500" />,
    };
    return (
        <div className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2 max-w-sm">
            {toasts.map((t) => (
                <div key={t.id}
                     className="card !p-3 flex items-center gap-2 shadow-lg animate-[slideIn_0.2s_ease-out]">
                    {icons[t.type]}
                    <span className="text-sm">{t.message}</span>
                </div>
            ))}
        </div>
    );
}

/** Форматирование байтов в читаемый вид */
export function formatBytes(bytes) {
    if (bytes == null) return '—';
    if (bytes === 0) return '0 Б';
    const units = ['Б', 'КБ', 'МБ', 'ГБ', 'ТБ'];
    const i = Math.min(units.length - 1, Math.floor(Math.log2(bytes) / 10));
    return `${(bytes / 1024 ** i).toFixed(i > 0 ? 1 : 0)} ${units[i]}`;
}

/** Форматирование даты */
export function formatDate(iso) {
    if (!iso) return '—';
    return new Date(iso).toLocaleString('ru-RU', {
        day: '2-digit', month: '2-digit', year: 'numeric',
        hour: '2-digit', minute: '2-digit',
    });
}
