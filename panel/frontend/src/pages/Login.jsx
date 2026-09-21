// Страница входа в панель
import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore, toast } from '../store';

export default function Login() {
    const [login, setLogin] = useState('');
    const [password, setPassword] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const setAuth = useAuthStore((s) => s.setAuth);
    const navigate = useNavigate();

    const submit = async (e) => {
        e.preventDefault();
        setError('');
        setLoading(true);
        try {
            const res = await fetch('/api/auth/login', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Requested-With': 'XMLHttpRequest',
                },
                body: JSON.stringify({ login, password }),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data.error || `Ошибка входа (${res.status})`);
            setAuth(data.accessToken, data.login);
            toast.success('Добро пожаловать!');
            navigate('/');
        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="min-h-screen flex items-center justify-center p-4
            bg-gradient-to-br from-slate-100 to-slate-200 dark:from-slate-950 dark:to-slate-900">
            <div className="card w-full max-w-md">
                <div className="text-center mb-8">
                    <div className="w-16 h-16 rounded-2xl bg-primary mx-auto flex items-center justify-center
                        text-white font-bold text-3xl mb-4 shadow-lg shadow-primary/30">
                        T
                    </div>
                    <h1 className="text-2xl font-bold">TGGATE</h1>
                    <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
                        Telegram Gate — панель управления прокси
                    </p>
                </div>

                <form onSubmit={submit} className="space-y-4">
                    <label className="block">
                        <span className="block text-sm font-medium mb-1.5">Логин</span>
                        <input
                            className="input"
                            value={login}
                            onChange={(e) => setLogin(e.target.value)}
                            autoComplete="username"
                            autoFocus
                            required
                        />
                    </label>
                    <label className="block">
                        <span className="block text-sm font-medium mb-1.5">Пароль</span>
                        <input
                            className="input"
                            type="password"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            autoComplete="current-password"
                            required
                        />
                    </label>

                    {error && (
                        <div className="rounded-lg bg-red-50 dark:bg-red-500/10 border border-red-200
                            dark:border-red-500/30 text-red-600 dark:text-red-400 text-sm px-3 py-2">
                            {error}
                        </div>
                    )}

                    <button type="submit" className="btn-primary w-full" disabled={loading}>
                        {loading ? 'Вход...' : 'Войти в панель'}
                    </button>
                </form>
            </div>
        </div>
    );
}
