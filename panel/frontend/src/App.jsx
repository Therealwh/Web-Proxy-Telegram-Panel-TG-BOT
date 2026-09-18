// Маршрутизация приложения
import React, { Suspense, lazy } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuthStore } from './store';
import Layout from './components/Layout';
import Login from './pages/Login';
import { Skeleton } from './components/ui';

// Ленивая загрузка страниц (code splitting)
const Dashboard = lazy(() => import('./pages/Dashboard'));
const Clients = lazy(() => import('./pages/Clients'));
const Logs = lazy(() => import('./pages/Logs'));
const Settings = lazy(() => import('./pages/Settings'));
const QRGenerator = lazy(() => import('./pages/QRGenerator'));
const Website = lazy(() => import('./pages/Website'));
const Bot = lazy(() => import('./pages/Bot'));
const ApiKeys = lazy(() => import('./pages/ApiKeys'));
const Developers = lazy(() => import('./pages/Developers'));
const Updates = lazy(() => import('./pages/Updates'));

/** Обертка: пускает только авторизованных */
function Protected({ children }) {
    const accessToken = useAuthStore((s) => s.accessToken);
    if (!accessToken) return <Navigate to="/login" replace />;
    return children;
}

const PageLoader = (
    <div className="space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-40 w-full" />
    </div>
);

export default function App() {
    return (
        <Routes>
            <Route path="/login" element={<Login />} />
            <Route element={<Protected><Layout /></Protected>}>
                <Route index element={<Suspense fallback={PageLoader}><Dashboard /></Suspense>} />
                <Route path="clients" element={<Suspense fallback={PageLoader}><Clients /></Suspense>} />
                <Route path="logs" element={<Suspense fallback={PageLoader}><Logs /></Suspense>} />
                <Route path="qr" element={<Suspense fallback={PageLoader}><QRGenerator /></Suspense>} />
                <Route path="website" element={<Suspense fallback={PageLoader}><Website /></Suspense>} />
                <Route path="bot" element={<Suspense fallback={PageLoader}><Bot /></Suspense>} />
                <Route path="api-keys" element={<Suspense fallback={PageLoader}><ApiKeys /></Suspense>} />
                <Route path="developers" element={<Suspense fallback={PageLoader}><Developers /></Suspense>} />
                <Route path="updates" element={<Suspense fallback={PageLoader}><Updates /></Suspense>} />
                <Route path="settings" element={<Suspense fallback={PageLoader}><Settings /></Suspense>} />
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
    );
}
