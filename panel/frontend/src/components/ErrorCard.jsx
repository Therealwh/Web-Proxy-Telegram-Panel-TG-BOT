// Карточка ошибки рендера: показывается ErrorBoundary, когда страница упала.
import React from 'react';
import { AlertTriangle, RotateCcw, LayoutDashboard } from 'lucide-react';
import { useT } from '../i18n';

export default function ErrorCard({ error, onReset }) {
    const t = useT();
    return (
        <div className="flex items-center justify-center py-16 px-4">
            <div className="card max-w-lg w-full">
                <div className="flex items-start gap-3">
                    <div className="w-10 h-10 rounded-xl bg-red-500/10 text-red-500 grid place-items-center shrink-0">
                        <AlertTriangle size={20} />
                    </div>
                    <div className="min-w-0">
                        <h2 className="text-lg font-semibold">{t('error.title')}</h2>
                        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">{t('error.hint')}</p>
                    </div>
                </div>

                <div className="mt-4 flex flex-wrap gap-2">
                    <button className="btn-primary" onClick={onReset}>
                        <RotateCcw size={16} /> {t('error.retry')}
                    </button>
                    <a className="btn-secondary" href="/">
                        <LayoutDashboard size={16} /> {t('error.toDashboard')}
                    </a>
                </div>

                {error?.message && (
                    <details className="mt-4">
                        <summary className="text-xs text-slate-400 cursor-pointer select-none">
                            {t('error.details')}
                        </summary>
                        <pre className="mt-2 p-3 rounded-lg bg-slate-100 dark:bg-slate-800 text-[11px] leading-relaxed overflow-auto max-h-48 whitespace-pre-wrap break-words">
                            {String(error.message)}
                            {error.stack ? `\n\n${error.stack}` : ''}
                        </pre>
                    </details>
                )}
            </div>
        </div>
    );
}