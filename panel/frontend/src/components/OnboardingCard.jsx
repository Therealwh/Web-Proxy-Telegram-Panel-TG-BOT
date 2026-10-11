// Карточка первоначальной настройки: показывает незавершённые шаги и исчезает,
// когда всё готово. Данные приходят одним запросом /api/onboarding.
import React, { useEffect, useState } from 'react';
import { CheckCircle2, CircleDashed, ArrowRight } from 'lucide-react';
import { get } from '../api';
import { useT } from '../i18n';
import { Card } from '../components/ui';

export default function OnboardingCard() {
    const [data, setData] = useState(null);
    const t = useT();

    useEffect(() => {
        get('/onboarding').then(setData).catch(() => {});
    }, []);

    // Пока идёт загрузка — не мигаем карточкой, а показываем её только когда
    // есть что показать: у полностью настроенной панели её быть не должно.
    if (!data || data.complete) return null;

    const pending = data.steps.filter((s) => !s.done);

    return (
        <Card className="border-amber-300/60 dark:border-amber-500/40">
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                    <h3 className="text-base font-semibold flex items-center gap-2">
                        <CircleDashed size={18} className="text-amber-500" />
                        {t('onboarding.title')}
                    </h3>
                    <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
                        {t('onboarding.subtitle', { done: data.done, total: data.total })}
                    </p>
                </div>
                <div className="flex -space-x-1.5">
                    {data.steps.map((s) => (
                        <span key={s.id}
                              title={t(`onboarding.step_${s.id}`)}
                              className={`w-2.5 h-2.5 rounded-full ring-2 ring-white dark:ring-slate-900
                                  ${s.done ? 'bg-emerald-500' : 'bg-amber-500'}`} />
                    ))}
                </div>
            </div>

            <ul className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-2">
                {pending.map((s) => (
                    <li key={s.id}>
                        <a href={`#${s.href}`}
                           className="flex items-center justify-between gap-3 rounded-lg px-3 py-2
                                      border border-slate-200 dark:border-slate-700
                                      hover:border-primary/60 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
                            <span className="text-sm">{t(`onboarding.step_${s.id}`)}</span>
                            <ArrowRight size={16} className="shrink-0 text-slate-400" />
                        </a>
                    </li>
                ))}
            </ul>

            {data.done > 0 && (
                <p className="mt-3 text-xs text-slate-400 flex items-center gap-1.5">
                    <CheckCircle2 size={13} className="text-emerald-500" />
                    {t('onboarding.doneHint', { n: data.total - data.done })}
                </p>
            )}
        </Card>
    );
}