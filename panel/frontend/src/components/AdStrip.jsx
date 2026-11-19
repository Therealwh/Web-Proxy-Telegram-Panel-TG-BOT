/**
 * Рекламный баннер в админ-панели (видит только администратор установки).
 *
 * Кампании приходят из центрального ads.json проекта (владелец продаёт
 * размещения — хостинги, сервисы). Если активных кампаний нет, показывается
 * встроенная заглушка «💼 Это место для вашей рекламы» со ссылкой владельцу
 * проекта в Telegram — она же продаёт слот другим владельцам панелей.
 *
 * Приватность: показы/клики считаются локально в БД установки, наружу
 * не передаются.
 */
import React, { useEffect, useState } from 'react';
import { get } from '../api';
import { useT } from '../i18n';

export default function AdStrip({ slot }) {
    const [ad, setAd] = useState(null);
    const [placeholder, setPlaceholder] = useState(false);
    const [loading, setLoading] = useState(true);
    const t = useT();

    useEffect(() => {
        let alive = true;
        get('/ads/panel')
            .then((d) => {
                if (!alive) return;
                if (d.ad) setAd(d.ad);
                else setPlaceholder(true);
                setLoading(false);
            })
            .catch(() => { if (alive) setLoading(false); });
        return () => { alive = false; };
    }, [slot]);

    if (loading) return null;

    const token = sessionStorage.getItem('tggate_token') || '';

    if (ad) {
        // Активная кампания: заголовок, текст, опциональная картинка,
        // пометка «Реклама» (+ erid, если указан) и переход через редиректор.
        const href = `/api/ads/go/${encodeURIComponent(ad.id)}?token=${encodeURIComponent(token)}`;
        return (
            <a href={href} target="_blank" rel="noopener noreferrer"
               className="block rounded-2xl border border-indigo-300/40 dark:border-indigo-500/30 bg-gradient-to-r from-indigo-500/5 via-slate-50 to-indigo-500/5 dark:from-indigo-500/10 dark:via-slate-900 dark:to-indigo-500/10 p-4 relative overflow-hidden hover:border-indigo-400/60 transition-colors">
                <span className="absolute top-2 right-2 text-[10px] uppercase tracking-wide text-slate-400 dark:text-slate-500">
                    {t('ads.sponsored')}{ad.erid ? ` · erid: ${ad.erid}` : ''}
                </span>
                <div className="flex items-center gap-4">
                    {ad.image && (
                        <img src={ad.image} alt="" className="h-16 w-auto rounded-lg shrink-0" loading="lazy" />
                    )}
                    <div className="min-w-0">
                        <div className="font-semibold text-slate-800 dark:text-slate-100 truncate">{ad.title}</div>
                        {ad.text && <div className="text-sm text-slate-600 dark:text-slate-300 line-clamp-2">{ad.text}</div>}
                    </div>
                </div>
            </a>
        );
    }

    // Заглушка: слот свободен — продажа размещения владельцем проекта
    return (
        <a href="https://t.me/tggatetopsupport" target="_blank" rel="noopener noreferrer"
           className="block rounded-2xl border border-dashed border-slate-300 dark:border-slate-600 p-4 relative hover:border-primary/60 hover:bg-primary/5 transition-colors group">
            <span className="absolute top-2 right-2 text-[10px] uppercase tracking-wide text-slate-400 dark:text-slate-500">
                {t('ads.sponsored')}
            </span>
            <div className="flex items-center gap-4">
                <span className="text-2xl shrink-0">💼</span>
                <div className="min-w-0">
                    <div className="font-semibold text-slate-700 dark:text-slate-200">{t('ads.placeholderTitle')}</div>
                    <div className="text-sm text-slate-500 dark:text-slate-400">{t('ads.placeholderText')}</div>
                </div>
            </div>
        </a>
    );
}
