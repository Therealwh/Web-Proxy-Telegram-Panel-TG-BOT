// Каркас приложения: боковое меню, шапка, маршрутизация
import React, { useEffect, useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import {
    LayoutDashboard, Users, ScrollText, Settings, QrCode, Globe,
    KeyRound, Bot, RefreshCw, Code2, Moon, Sun, LogOut, Menu, X,
} from 'lucide-react';
import { useAuthStore, useThemeStore } from '../store';
import { post } from '../api';
import { Toasts } from './ui';

// Пункты меню
const NAV = [
    { to: '/', icon: LayoutDashboard, label: 'Дашборд' },
    { to: '/clients', icon: Users, label: 'Клиенты' },
    { to: '/logs', icon: ScrollText, label: 'Живые логи' },
    { to: '/qr', icon: QrCode, label: 'QR-коды' },
    { to: '/website', icon: Globe, label: 'Сайт-заглушка' },
    { to: '/bot', icon: Bot, label: 'Telegram бот' },
    { to: '/api-keys', icon: KeyRound, label: 'API-ключи' },
    { to: '/developers', icon: Code2, label: 'Разработчикам' },
    { to: '/updates', icon: RefreshCw, label: 'Обновления' },
    { to: '/settings', icon: Settings, label: 'Настройки' },
];

export default function Layout() {
    const { login, clearAuth } = useAuthStore();
    const { theme, toggleTheme } = useThemeStore();
    const [menuOpen, setMenuOpen] = useState(false);
    const [version, setVersion] = useState('');
    const navigate = useNavigate();

    // Версия панели из API (всегда актуальная)
    useEffect(() => {
        fetch('/api/health').then((r) => r.json()).then((d) => setVersion(d.version || '')).catch(() => {});
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
                            {label}
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
                    <button className="lg:hidden btn-ghost !min-h-0 !p-2" onClick={() => setMenuOpen(!menuOpen)} aria-label="Меню">
                        {menuOpen ? <X size={20} /> : <Menu size={20} />}
                    </button>
                    <div className="flex-1" />
                    <button onClick={toggleTheme} className="btn-ghost !min-h-0 !p-2" aria-label="Сменить тему">
                        {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
                    </button>
                    <span className="text-sm text-slate-500 dark:text-slate-400 hidden sm:block">{login}</span>
                    <button onClick={logout} className="btn-ghost !min-h-0 !p-2" aria-label="Выйти">
                        <LogOut size={18} />
                    </button>
                </header>
                <main className="flex-1 p-4 lg:p-6 max-w-[1400px] w-full mx-auto">
                    <Outlet />
                </main>
                <footer className="px-6 py-4 text-center text-xs text-slate-400 dark:text-slate-500 space-y-1">
                    <div>© 2026 TGGATE | Версия {version || '...'} | Работает на Telemt</div>
                    <div className="flex items-center justify-center gap-4">
                        <a href="https://t.me/tggatetopsupport" target="_blank" rel="noreferrer"
                           className="hover:text-primary transition-colors">🛟 Поддержка @tggatetopsupport</a>
                        <a href="https://t.me/wtfpoxy" target="_blank" rel="noreferrer"
                           className="hover:text-primary transition-colors">📢 Канал @wtfpoxy</a>
                    </div>
                </footer>
            </div>
            <Toasts />
        </div>
    );
}
