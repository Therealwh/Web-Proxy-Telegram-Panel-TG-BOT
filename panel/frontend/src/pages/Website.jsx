// Управление сайтом-заглушкой: файлы, редактор, шаблоны, предпросмотр
import React, { useEffect, useState } from 'react';
import { Save, Upload, Trash2, FileText, Eye, Globe } from 'lucide-react';
import { get, post, put, del } from '../api';
import { toast } from '../store';
import { useT } from '../i18n';
import { Card, Modal, Skeleton, PageHeader } from '../components/ui';

export default function Website() {
    const [files, setFiles] = useState(null);
    const [current, setCurrent] = useState(null); // { name, content }
    const [templates, setTemplates] = useState([]);
    const [preview, setPreview] = useState(false);
    const [saving, setSaving] = useState(false);
    const t = useT();

    const load = () => {
        get('/website/files').then((d) => setFiles(d.files)).catch((e) => toast.error(e.message));
        get('/website/templates').then((d) => setTemplates(d.templates)).catch(() => {});
    };
    useEffect(() => { load(); }, [$1]);

    const openFile = async (name) => {
        try {
            const d = await get(`/website/files/${encodeURIComponent(name)}`);
            setCurrent({ name, content: d.content });
        } catch (e) {
            toast.error(e.message);
        }
    };

    const saveFile = async () => {
        setSaving(true);
        try {
            await put(`/website/files/${encodeURIComponent(current.name)}`, { content: current.content });
            toast.success(t('website.savedFile'));
            load();
        } catch (e) {
            toast.error(e.message);
        } finally {
            setSaving(false);
        }
    };

    const uploadFile = async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const formData = new FormData();
        formData.append('file', file);
        try {
            const res = await fetch('/api/website/upload', {
                method: 'POST',
                headers: {
                    'X-Requested-With': 'XMLHttpRequest',
                    Authorization: `Bearer ${sessionStorage.getItem('tggate_token')}`,
                },
                body: formData,
            });
            if (!res.ok) throw new Error((await res.json()).error || t('website.uploadFailed'));
            toast.success(t('website.uploaded'));
            load();
        } catch (err) {
            toast.error(err.message);
        }
        e.target.value = '';
    };

    const deleteFile = async (name) => {
        if (!confirm(t('website.confirmDelFile', { name }))) return;
        try {
            await del(`/website/files/${encodeURIComponent(name)}`);
            toast.success(t('website.removedFile'));
            if (current?.name === name) setCurrent(null);
            load();
        } catch (e) {
            toast.error(e.message);
        }
    };

    const applyTemplate = async (name) => {
        if (!confirm(t('website.confirmTpl', { name }))) return;
        try {
            await post('/website/apply-template', { template: name });
            toast.success(t('website.tplApplied'));
            load();
        } catch (e) {
            toast.error(e.message);
        }
    };

    return (
        <div className="space-y-4">
            <PageHeader icon={<Globe size={20} />} title={t('website.title')}
                        subtitle={t('website.subtitle')}
                        actions={<>
                            <a href={`${location.protocol}//${location.host}/`} target="_blank" rel="noreferrer" className="btn-secondary"><Eye size={16} /> {t('website.openSite')}</a>
                            <label className="btn-secondary cursor-pointer">
                                <Upload size={16} /> {t('website.upload')}
                                <input type="file" className="hidden" onChange={uploadFile} />
                            </label>
                        </>} />

            {/* Шаблоны */}
            <Card title={t('website.tplTitle')} subtitle={t('website.tplSub')}>
                <div className="flex flex-wrap gap-2">
                    {templates.map((tpl) => (
                        <button key={tpl.id} className="btn-secondary" onClick={() => applyTemplate(tpl.id)}>
                            {tpl.name}
                        </button>
                    ))}
                </div>
            </Card>

            <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
                {/* Список файлов */}
                <Card title={t('website.filesTitle')} className="lg:col-span-1">
                    {!files ? <Skeleton className="h-40" /> : files.length === 0 ? (
                        <p className="text-sm text-slate-500">{t('website.filesEmpty')}</p>
                    ) : (
                        <ul className="space-y-1">
                            {files.map((f) => (
                                <li key={f.name}
                                    className={`flex items-center justify-between gap-2 px-2 py-1.5 rounded-lg text-sm cursor-pointer
                                        hover:bg-slate-100 dark:hover:bg-slate-800
                                        ${current?.name === f.name ? 'bg-primary/10 text-primary' : ''}`}
                                    onClick={() => openFile(f.name)}>
                                    <span className="flex items-center gap-2 truncate">
                                        <FileText size={14} /> {f.name}
                                    </span>
                                    <button className="text-red-400 hover:text-red-500 shrink-0"
                                            onClick={(e) => { e.stopPropagation(); deleteFile(f.name); }}>
                                        <Trash2 size={14} />
                                    </button>
                                </li>
                            ))}
                        </ul>
                    )}
                </Card>

                {/* Редактор */}
                <Card className="lg:col-span-3"
                      title={current ? t('website.editorFor', { name: current.name }) : t('website.editor')}
                      actions={current && (
                          <button className="btn-primary !min-h-0 !px-3 !py-1.5 text-sm" onClick={saveFile} disabled={saving}>
                              <Save size={14} /> {saving ? t('common.saving') : t('common.save')}
                          </button>
                      )}>
                    {!current ? (
                        <p className="text-sm text-slate-500 py-8 text-center">{t('website.pickFile')}</p>
                    ) : (
                        <textarea
                            className="input font-mono text-xs !leading-relaxed min-h-[420px] resize-y"
                            value={current.content}
                            onChange={(e) => setCurrent({ ...current, content: e.target.value })}
                            spellCheck={false}
                        />
                    )}
                </Card>
            </div>
        </div>
    );
}
