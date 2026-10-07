// Глобальное состояние панели (Zustand)
import { create } from 'zustand';

// --- Авторизация ---
export const useAuthStore = create((set) => ({
    accessToken: sessionStorage.getItem('tggate_token') || null,
    login: sessionStorage.getItem('tggate_login') || null,

    setAuth: (accessToken, login) => {
        sessionStorage.setItem('tggate_token', accessToken);
        sessionStorage.setItem('tggate_login', login);
        set({ accessToken, login });
    },
    clearAuth: () => {
        sessionStorage.removeItem('tggate_token');
        sessionStorage.removeItem('tggate_login');
        set({ accessToken: null, login: null });
    },
}));

// --- Тема оформления ---
const savedTheme = localStorage.getItem('tggate_theme') || 'dark';
document.documentElement.classList.toggle('dark', savedTheme === 'dark');

export const useThemeStore = create((set) => ({
    theme: savedTheme,
    toggleTheme: () =>
        set((state) => {
            const theme = state.theme === 'dark' ? 'light' : 'dark';
            localStorage.setItem('tggate_theme', theme);
            document.documentElement.classList.toggle('dark', theme === 'dark');
            return { theme };
        }),
}));

// --- Язык интерфейса ---
const savedLang = localStorage.getItem('tggate_lang') || 'ru';

export const useLangStore = create((set) => ({
    lang: ['ru', 'en'].includes(savedLang) ? savedLang : 'ru',
    setLang: (lang) => {
        const v = lang === 'en' ? 'en' : 'ru';
        localStorage.setItem('tggate_lang', v);
        set({ lang: v });
    },
}));

// --- Toast-уведомления ---
let toastId = 0;
export const useToastStore = create((set) => ({
    toasts: [],
    /** Показ уведомления. type: success | error | info; opts: { duration, onClick } */
    push: (type, message, opts = {}) => {
        const id = ++toastId;
        set((s) => ({ toasts: [...s.toasts, { id, type, message, onClick: opts.onClick }] }));
        setTimeout(() => {
            set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
        }, opts.duration || 4000);
    },
}));

/** Хелпер для тостов: type | message | opts */
export const toast = {
    success: (msg, opts) => useToastStore.getState().push('success', msg, opts),
    error: (msg, opts) => useToastStore.getState().push('error', msg, opts),
    info: (msg, opts) => useToastStore.getState().push('info', msg, opts),
};
