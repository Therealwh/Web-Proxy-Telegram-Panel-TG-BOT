// Страница QR-кодов: выбор клиента, типы QR, скачивание, статистика сканов
import React, { useEffect, useState } from 'react';
import { Download, Send, QrCode } from 'lucide-react';
import { get, post } from '../api';
import { toast } from '../store';
import { useT } from '../i18n';
import { Card, Field, Skeleton, PageHeader } from '../components/ui';

export default function QRGenerator() {
    const [clients, setClients] = useState(null);
    const [clientId, setClientId] = useState('');
    const [color, setColor] = useState('#000000');
    const [bg, setBg] = useState('#ffffff');
    const [size, setSize] = useState(512);
    const [stats, setStats] = useState(null);
    const t = useT();

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
            toast.success(t('qr.sentTg'));
        } catch (e) {
            toast.error(e.message);
        }
    };

    return (
        <div className="space-y-4">
            <PageHeader icon={<QrCode size={20} />} title={t('qr.title')}
                        subtitle={t('qr.subtitle')} />

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                <Card title={t('qr.params')} className="lg:col-span-1">
                    <div className="space-y-4">
                        <Field label={t('qr.fClient')}>
                            {!clients ? <Skeleton className="h-10" /> : (
                                <select className="input" value={clientId} onChange={(e) => setClientId(e.target.value)}>
                                    <option value="">{t('qr.choose')}</option>
                                    {clients.map((c) => <option key={c.id} value={c.id}>{c.username}</option>)}
                                </select>
                            )}
                        </Field>
                        <div className="grid grid-cols-2 gap-3">
                            <Field label={t('qr.fColor')}>
                                <input type="color" className="input !p-1 h-10" value={color} onChange={(e) => setColor(e.target.value)} />
                            </Field>
                            <Field label={t('qr.fBg')}>
                                <input type="color" className="input !p-1 h-10" value={bg} onChange={(e) => setBg(e.target.value)} />
                            </Field>
                        </div>
                        <Field label={t('qr.fSize')}>
                            <select className="input" value={size} onChange={(e) => setSize(Number(e.target.value))}>
                                {[256, 512, 1024, 2048].map((s) => <option key={s} value={s}>{s}px</option>)}
                            </select>
                        </Field>
                        {client && (
                            <button className="btn-secondary w-full" onClick={sendToTelegram}>
                                <Send size={16} /> {t('qr.sendTg')}
                            </button>
                        )}
                    </div>
                </Card>

                <Card title={t('qr.preview')} className="lg:col-span-2">
                    {!client ? (
                        <p className="text-center text-slate-500 py-12">{t('qr.pickLeft')}</p>
                    ) : (
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                            {client.links.web && (
                                <div className="text-center">
                                    <h4 className="font-medium mb-3">{t('qr.qrWeb')}</h4>
                                    <img src={qrUrl('web', 'png')} alt="QR Web" className="mx-auto rounded-lg w-44 h-44 border border-slate-200 dark:border-slate-700" />
                                    <div className="flex gap-2 mt-3 justify-center">
                                        <a className="btn-secondary !min-h-0 !px-3 !py-1.5 text-xs" href={qrUrl('web', 'png')} download><Download size={14} /> PNG</a>
                                        <a className="btn-secondary !min-h-0 !px-3 !py-1.5 text-xs" href={qrUrl('web', 'svg')} download><Download size={14} /> SVG</a>
                                    </div>
                                </div>
                            )}
                            {client.links.mtproto && (
                                <div className="text-center">
                                    <h4 className="font-medium mb-3">{t('qr.qrMtproto')}</h4>
                                    <img src={qrUrl('mtproto', 'png')} alt="QR MTProto" className="mx-auto rounded-lg w-44 h-44 border border-slate-200 dark:border-slate-700" />
                                    <div className="flex gap-2 mt-3 justify-center">
                                        <a className="btn-secondary !min-h-0 !px-3 !py-1.5 text-xs" href={qrUrl('mtproto', 'png')} download><Download size={14} /> PNG</a>
                                        <a className="btn-secondary !min-h-0 !px-3 !py-1.5 text-xs" href={qrUrl('mtproto', 'svg')} download><Download size={14} /> SVG</a>
                                    </div>
                                </div>
                            )}
                            {client.qr_token && (
                                <div className="sm:col-span-2 text-center mt-2">
                                    <a href={`/qr/${client.qr_token}`} target="_blank" rel="noreferrer"
                                       className="text-sm text-primary underline">
                                        {t('qr.publicPage')}
                                    </a>
                                    <p className="text-xs text-slate-400 mt-1">
                                        {t('qr.publicHint')}{location.origin}/qr/{client.qr_token}
                                    </p>
                                </div>
                            )}
                        </div>
                    )}
                    {stats && (
                        <p className="text-xs text-slate-400 mt-4 text-center">
                            {t('qr.scans', { total: stats.total, web: stats.web, mtproto: stats.mtproto })}
                        </p>
                    )}
                </Card>
            </div>
        </div>
    );
}
