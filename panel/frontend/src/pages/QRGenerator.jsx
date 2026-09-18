// Страница QR-кодов: выбор клиента, типы QR, скачивание, статистика сканов
import React, { useEffect, useState } from 'react';
import { Download, Send, RefreshCw } from 'lucide-react';
import { get, post } from '../api';
import { toast } from '../store';
import { Card, Field, Skeleton } from '../components/ui';

export default function QRGenerator() {
    const [clients, setClients] = useState(null);
    const [clientId, setClientId] = useState('');
    const [color, setColor] = useState('#000000');
    const [bg, setBg] = useState('#ffffff');
    const [size, setSize] = useState(512);
    const [stats, setStats] = useState(null);

    useEffect(() => {
        get('/clients?limit=200').then((d) => setClients(d.clients)).catch((e) => toast.error(e.message));
    }, []);

    useEffect(() => {
        if (clientId) {
            get(`/qr/client/${clientId}/stats`).then(setStats).catch(() => setStats(null));
        }
    }, [clientId]);

    const client = clients?.find((c) => String(c.id) === String(clientId));

    const qrUrl = (type, format) =>
        `/api/qr/client/${clientId}/${type}.${format}?token=${sessionStorage.getItem('tggate_token')}&color=${encodeURIComponent(color)}&bg=${encodeURIComponent(bg)}&size=${size}`;

    const sendToTelegram = async () => {
        try {
            await post(`/qr/client/${clientId}/send`);
            toast.success('QR-коды отправлены клиенту в Telegram');
        } catch (e) {
            toast.error(e.message);
        }
    };

    return (
        <div className="space-y-4">
            <h1 className="text-2xl font-bold">QR-коды подключения</h1>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                <Card title="Параметры" className="lg:col-span-1">
                    <div className="space-y-4">
                        <Field label="Клиент">
                            {!clients ? <Skeleton className="h-10" /> : (
                                <select className="input" value={clientId} onChange={(e) => setClientId(e.target.value)}>
                                    <option value="">— выберите —</option>
                                    {clients.map((c) => <option key={c.id} value={c.id}>{c.username}</option>)}
                                </select>
                            )}
                        </Field>
                        <div className="grid grid-cols-2 gap-3">
                            <Field label="Цвет кода">
                                <input type="color" className="input !p-1 h-10" value={color} onChange={(e) => setColor(e.target.value)} />
                            </Field>
                            <Field label="Цвет фона">
                                <input type="color" className="input !p-1 h-10" value={bg} onChange={(e) => setBg(e.target.value)} />
                            </Field>
                        </div>
                        <Field label="Размер">
                            <select className="input" value={size} onChange={(e) => setSize(Number(e.target.value))}>
                                {[256, 512, 1024, 2048].map((s) => <option key={s} value={s}>{s}px</option>)}
                            </select>
                        </Field>
                        {client && (
                            <button className="btn-secondary w-full" onClick={sendToTelegram}>
                                <Send size={16} /> Отправить клиенту в Telegram
                            </button>
                        )}
                    </div>
                </Card>

                <Card title="Предпросмотр" className="lg:col-span-2">
                    {!client ? (
                        <p className="text-center text-slate-500 py-12">Выберите клиента слева</p>
                    ) : (
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                            {client.links.web && (
                                <div className="text-center">
                                    <h4 className="font-medium mb-3">🌐 Web Proxy</h4>
                                    <img src={qrUrl('web', 'png')} alt="QR Web" className="mx-auto rounded-lg w-44 h-44 border border-slate-200 dark:border-slate-700" />
                                    <div className="flex gap-2 mt-3 justify-center">
                                        <a className="btn-secondary !min-h-0 !px-3 !py-1.5 text-xs" href={qrUrl('web', 'png')} download><Download size={14} /> PNG</a>
                                        <a className="btn-secondary !min-h-0 !px-3 !py-1.5 text-xs" href={qrUrl('web', 'svg')} download><Download size={14} /> SVG</a>
                                    </div>
                                </div>
                            )}
                            {client.links.mtproto && (
                                <div className="text-center">
                                    <h4 className="font-medium mb-3">🔌 MTProto</h4>
                                    <img src={qrUrl('mtproto', 'png')} alt="QR MTProto" className="mx-auto rounded-lg w-44 h-44 border border-slate-200 dark:border-slate-700" />
                                    <div className="flex gap-2 mt-3 justify-center">
                                        <a className="btn-secondary !min-h-0 !px-3 !py-1.5 text-xs" href={qrUrl('mtproto', 'png')} download><Download size={14} /> PNG</a>
                                        <a className="btn-secondary !min-h-0 !px-3 !py-1.5 text-xs" href={qrUrl('mtproto', 'svg')} download><Download size={14} /> SVG</a>
                                    </div>
                                </div>
                            )}
                        </div>
                    )}
                    {stats && (
                        <p className="text-xs text-slate-400 mt-4 text-center">
                            Сканирований: {stats.total} (Web: {stats.web}, MTProto: {stats.mtproto})
                        </p>
                    )}
                </Card>
            </div>
        </div>
    );
}
