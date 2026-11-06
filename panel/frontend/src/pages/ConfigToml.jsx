// Страница «Конфиг Telemt (TOML)»: просмотр и правка сырого конфига с перезапуском движка
import React, { useEffect, useState } from 'react';
import { FileText, RotateCw, Save } from 'lucide-react';
import { get, post } from '../api';
import { toast } from '../store';
import { Skeleton, PageHeader } from '../components/ui';

export default function ConfigToml() {
    const [content, setContent] = useState('');
    const [original, setOriginal] = useState('');
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState(null);
    const [saving, setSaving] = useState(false);

    /** Загрузка конфига из файла */
    const load = async (force = false) => {
        if (!force && content !== original
            && !window.confirm('В textarea есть несохранённые правки. Перезагрузить из файла и потерять их?')) {
            return;
        }
        setLoading(true);
        try {
            const d = await get('/engine/config-toml');
            setContent(d.content || '');
            setOriginal(d.content || '');
            setLoadError(null);
        } catch (e) {
            setLoadError(e.message);
            toast.error(e.message);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { load(true); }, []);

    /** Сохранение с бэкапом и перезапуском Telemt (на стороне панели) */
    const save = async () => {
        if (!window.confirm('Перезаписать конфиг и перезапустить Telemt? При сбое панель автоматически откатит изменения.')) return;
        setSaving(true);
        try {
            const resp = await post('/engine/config-toml', { content });
            if (resp && resp.ok === false) throw new Error(resp.error || 'Telemt отклонил конфиг');
            setOriginal(content);
            toast.success('Сохранено, Telemt перезапущен');
        } catch (e) {
            toast.error(e.message);
        } finally {
            setSaving(false);
        }
    };

    const dirty = content !== original;

    return (
        <div className="space-y-4">
            <PageHeader icon={<FileText size={20} />} title="📄 Конфиг Telemt (TOML)"
                        subtitle="Сырой конфиг движка. Сохранение перезапускает Telemt."
                        actions={dirty ? <span className="badge-yellow">есть несохранённые правки</span> : null} />

            <div className="card !p-4 border-amber-500/50 bg-amber-50 dark:bg-amber-500/10">
                <p className="text-sm text-amber-700 dark:text-amber-400">
                    ⚠️ Редактируйте осторожно: ошибки в конфиге ломают прокси. Перед сохранением панель
                    автоматически делает бэкап и при сбое Telemt откатывает изменения.
                </p>
            </div>

            <div className="card">
                <div className="flex flex-wrap items-center gap-2 mb-4">
                    <button className="btn-ghost" disabled={saving} onClick={() => load()}>
                        <RotateCw size={16} className="inline mr-1.5 -mt-0.5" />Перезагрузить из файла
                    </button>
                    <button className="btn-primary" disabled={saving || loading} onClick={save}>
                        <Save size={16} className="inline mr-1.5 -mt-0.5" />{saving ? 'Сохранение…' : 'Сохранить и перезапустить Telemt'}
                    </button>
                </div>

                {loading && !loadError ? (
                    <Skeleton className="h-[500px] w-full" />
                ) : loadError ? (
                    <p className="text-sm text-red-500 py-4">{loadError}</p>
                ) : (
                    <textarea
                        className="w-full min-h-[500px] font-mono text-xs leading-relaxed p-4 rounded-lg resize-y
                            border border-slate-300 dark:border-slate-700
                            bg-slate-50 dark:bg-slate-950
                            text-slate-800 dark:text-slate-100
                            focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary
                            transition-colors"
                        spellCheck="false"
                        value={content}
                        onChange={(e) => setContent(e.target.value)}
                    />
                )}
            </div>
        </div>
    );
}
