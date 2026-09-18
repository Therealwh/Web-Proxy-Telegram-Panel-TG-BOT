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

// --- Toast-уведомления ---
let toastId = 0;
export const useToastStore = create((set) => ({
    toasts: [],
    /** Показать уведомление. type: success | error | info */
    push: (type, message) => {
        const id = ++toastId;
        set((s) => ({ toasts: [...s.toasts, { id, type, message }] }));
        setTimeout(() => {
            set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
        }, 4000);
    },
}));

/** Короткие хелперы для тостов */
export const toast = {
    success: (msg) => useToastStore.getState().push('success', msg),
    error: (msg) => useToastStore.getState().push('error', msg),
    info: (msg) => useToastStore.getState().push('info', msg),
};
