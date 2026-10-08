// Каркас приложения: боковое меню, шапка, маршрутизация
import React, { useEffect, useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import {
    LayoutDashboard, Users, BarChart3, ScrollText, Settings, QrCode, Globe,
    KeyRound, Bot, RefreshCw, Code2, Moon, Sun, LogOut, Menu, X, Activity, Shield,
} from 'lucide-react';
import { useAuthStore, useThemeStore, useLangStore } from '../store';
import { get, post, put } from '../api';
import { toast } from '../store';
import { Toasts } from './ui';
import { useT } from '../i18n';

// Пункты меню
const NAV = [
    { to: '/', icon: LayoutDashboard, label: 'nav.dashboard' },
    { to: '/clients', icon: Users, label: 'nav.clients' },
    { to: '/sales', icon: BarChart3, label: 'nav.sales' },
    { to: '/logs', icon: ScrollText, label: 'nav.logs' },
    { to: '/qr', icon: QrCode, label: 'nav.qr' },
    { to: '/website', icon: Globe, label: 'nav.website' },
    { to: '/bot', icon: Bot, label: 'nav.bot' },
    { to: '/api-keys', icon: KeyRound, label: 'nav.apikeys' },
    { to: '/developers', icon: Code2, label: 'nav.developers' },
    { to: '/updates', icon: RefreshCw, label: 'nav.updates' },
    { to: '/engine', icon: Activity, label: 'nav.engine' },
    { to: '/zapret2', icon: Shield, label: 'nav.zapret2' },
    { to: '/settings', icon: Settings, label: 'nav.settings' },
];

/** Переключатель языка RU/EN (сохраняет и в настройки панели) */
function LangSwitch() {
    const lang = useLangStore((s) => s.lang);
    const setLang = (v) => {
        useLangStore.getState().setLang(v);
        put('/settings', { language: v }).catch(() => {});
    };
    return (
        <div className="flex rounded-lg overflow-hidden border border-slate-200 dark:border-slate-700 text-xs font-medium">
            {['ru', 'en'].map((l) => (
                <button key={l}
                        onClick={() => setLang(l)}
                        className={`px-2 py-1.5 uppercase transition-colors ${lang === l ? 'bg-primary text-white' : 'text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800'}`}>
                    {l === 'ru' ? 'RU' : 'EN'}
                </button>
            ))}
        </div>
    );
}

/** Строка версии в подвале (переводится) */
function FooterLine({ version }) {
    const t = useT();
    return <div>{t('layout.footer', { version: version || '...' })}</div>;
}

export default function Layout() {
    const { login, clearAuth } = useAuthStore();
    const { theme, toggleTheme } = useThemeStore();
    const t = useT();
    const [menuOpen, setMenuOpen] = useState(false);
    const [version, setVersion] = useState('');
    const [badges, setBadges] = useState({ online: 0, pending: 0, updates: false });
    const navigate = useNavigate();

    // Язык по умолчанию — из настроек панели (если не выбран вручную)
    useEffect(() => {
        if (!localStorage.getItem('tggate_lang')) {
            get('/settings').then((d) => {
                const srv = d.settings?.language;
                if (srv === 'en' || srv === 'ru') useLangStore.getState().setLang(srv);
            }).catch(() => {});
        }
    }, []);

    // Версия панели из API (всегда актуальная)
    useEffect(() => {
        fetch('/api/health').then((r) => r.json()).then((d) => setVersion(d.version || '')).catch(() => {});
    }, []);

    // Бейджи меню: онлайн, ожидающие платежи, доступные обновления
    useEffect(() => {
        const newer = (latest, current) => {
            if (!latest || !current) return false;
            const p = (s) => String(s).replace(/^v/, '').split('.').map((n) => parseInt(n, 10) || 0);
            const a = p(latest), b = p(current);
            for (let i = 0; i < 3; i++) {
                if ((a[i] || 0) > (b[i] || 0)) return true;
                if ((a[i] || 0) < (b[i] || 0)) return false;
            }
            return false;
        };
        const tick = () => {
            get('/stats/active').then((d) => setBadges((s) => ({ ...s, online: (d.connections || []).length }))).catch(() => {});
            get('/payments').then((d) => setBadges((s) => ({
                ...s, pending: (d.payments || []).filter((p) => p.status === 'pending').length,
            }))).catch(() => {});
            get('/updates/status').then((s) => setBadges((b) => ({
                ...b,
                updates: newer(s.panel?.latest, s.panel?.current) || newer(s.telemt?.latest, s.telemt?.current),
            }))).catch(() => {});
        };
        tick();
        const timer = setInterval(tick, 120000);
        return () => clearInterval(timer);
    }, []);

    // Уведомление о доступных обновлениях при входе в панель
    useEffect(() => {
        const newer = (latest, current) => {
            if (!latest || !current) return false;
            const p = (s) => String(s).replace(/^v/, '').split('.').map((n) => parseInt(n, 10) || 0);
            for (let i = 0; i < 3; i++) {
                if ((p(latest)[i] || 0) > (p(current)[i] || 0)) return true;
                if ((p(latest)[i] || 0) < (p(current)[i] || 0)) return false;
            }
            return false;
        };
        get('/updates/status').then((s) => {
            const parts = [];
            if (newer(s.panel?.latest, s.panel?.current)) {
                parts.push(t('layout.updatePanel', { latest: s.panel.latest, current: s.panel.current }));
            }
            if (newer(s.telemt?.latest, s.telemt?.current)) {
                parts.push(t('layout.updateTelemt', { latest: s.telemt.latest, current: s.telemt.current }));
            }
            if (parts.length) {
                toast.info(t('layout.updateAvailable', { parts: parts.join(' · ') }), {
                    duration: 10000,
                    onClick: () => navigate('/updates'),
                });
            }
        }).catch(() => {});
    }, []);

    const logout = async () => {
        try { await post('/auth/logout'); } catch { /* игнорируем */ }
        clearAuth();
        navigate('/login');
    };

    return (
        <div className="min-h-screen flex">
            {/* Боковое меню */}
            <aside className={`
                fixed lg:static inset-y-0 left-0 z-40 w-64 shrink-0
                bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-slate-800
                transform transition-transform duration-200
                ${menuOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}
            `}>
                <div className="flex items-center gap-3 px-5 h-16 border-b border-slate-200 dark:border-slate-800">
                    <div className="w-9 h-9 rounded-xl bg-primary flex items-center justify-center text-white font-bold text-lg">
                        T
                    </div>
                    <div>
                        <div className="font-bold leading-tight">TGGATE</div>
                        <div className="text-xs text-slate-500 dark:text-slate-400">Telegram Gate</div>
                    </div>
                </div>
                <nav className="p-3 space-y-1">
                    {NAV.map(({ to, icon: Icon, label }) => (
                        <NavLink
                            key={to}
                            to={to}
                            end={to === '/'}
                            onClick={() => setMenuOpen(false)}
                            className={({ isActive }) => `
                                flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium
                                transition-all duration-200 min-h-[44px]
                                ${isActive
                                    ? 'bg-primary/10 text-primary dark:bg-primary/20'
                                    : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'}
                            `}
                        >
                            <Icon size={18} />
                            <span className="flex-1">{t(label)}</span>
                            {to === '/logs' && badges.online > 0 && (
                                <span className="badge-green !px-1.5" title={t('layout.onlineNow')}>{badges.online}</span>
                            )}
                            {to === '/sales' && badges.pending > 0 && (
                                <span className="badge-yellow !px-1.5" title={t('layout.pendingPayments')}>{badges.pending}</span>
                            )}
                            {to === '/updates' && badges.updates && (
                                <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" title={t('layout.updateAvailableShort')} />
                            )}
                        </NavLink>
                    ))}
                </nav>
            </aside>

            {/* Затемнение при открытом меню на мобильных */}
            {menuOpen && (
                <div className="fixed inset-0 z-30 bg-black/50 lg:hidden" onClick={() => setMenuOpen(false)} />
            )}

            {/* Основная область */}
            <div className="flex-1 flex flex-col min-w-0">
                <header className="h-16 flex items-center justify-between gap-4 px-4 lg:px-6
                    bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 sticky top-0 z-20">
                    <button className="lg:hidden btn-ghost !min-h-0 !p-2" onClick={() => setMenuOpen(!menuOpen)} aria-label={t('layout.menu')}>
                        {menuOpen ? <X size={20} /> : <Menu size={20} />}
                    </button>
                    <div className="flex-1" />
                    <LangSwitch />
                    <button onClick={toggleTheme} className="btn-ghost !min-h-0 !p-2" aria-label={t('layout.theme')}>
                        {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
                    </button>
                    <span className="text-sm text-slate-500 dark:text-slate-400 hidden sm:block">{login}</span>
                    <button onClick={logout} className="btn-ghost !min-h-0 !p-2" aria-label={t('layout.logout')}>
                        <LogOut size={18} />
                    </button>
                </header>
                <main className="flex-1 p-4 lg:p-6 max-w-[1400px] w-full mx-auto">
                    <Outlet />
                </main>
                <footer className="px-6 py-4 text-center text-xs text-slate-400 dark:text-slate-500 space-y-1">
                    <FooterLine version={version} />
                    <div className="flex items-center justify-center gap-4">
                        <a href="https://t.me/tggatetopsupport" target="_blank" rel="noreferrer"
                           className="hover:text-primary transition-colors">{t('layout.support')}</a>
                        <a href="https://t.me/wtfpoxy" target="_blank" rel="noreferrer"
                           className="hover:text-primary transition-colors">{t('layout.channel')}</a>
                    </div>
                </footer>
            </div>
            <Toasts />
        </div>
    );
}
