// Документация для разработчиков: примеры использования публичного API
import React from 'react';
import { Code2 } from 'lucide-react';
import { useT } from '../i18n';
import { Card, PageHeader } from '../components/ui';

function CodeBlock({ title, code }) {
    return (
        <div>
            <h4 className="text-sm font-medium mb-2">{title}</h4>
            <pre className="rounded-lg bg-slate-100 dark:bg-slate-800 p-4 text-xs font-mono overflow-x-auto">{code}</pre>
        </div>
    );
}

export default function Developers() {
    const t = useT();
    const PY_EXAMPLE = t('dev.pyEx');
    const JS_EXAMPLE = t('dev.jsEx');
    const CURL_EXAMPLE = t('dev.curlEx');
    return (
        <div className="space-y-4">
            <PageHeader icon={<Code2 size={20} />} title={t('dev.title')}
                        subtitle={t('dev.subtitle')} />

            <Card title={t('dev.apiTitle')}>
                <p className="text-sm text-slate-500 dark:text-slate-400 mb-4">
                    {t('dev.apiP1')} <code className="font-mono text-xs">/panel-api/v1/*</code> {t('dev.apiP2')}{' '}
                    <code className="font-mono text-xs">{t('dev.authHeader')}</code>.
                    {t('dev.apiP3')}{' '}
                    <a href="/api/docs" target="_blank" rel="noreferrer" className="text-primary underline">/api/docs</a> (Swagger UI).
                </p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
                    {[
                        ['GET', '/panel-api/v1/clients', t('dev.epClients')],
                        ['POST', '/panel-api/v1/clients', t('dev.epCreate')],
                        ['PATCH', '/panel-api/v1/clients/{id}', t('dev.epUpdate')],
                        ['DELETE', '/panel-api/v1/clients/{id}', t('dev.epDelete')],
                        ['GET', '/panel-api/v1/clients/{id}/links', t('dev.epLinks')],
                        ['GET', '/panel-api/v1/clients/{id}/qr', t('dev.epQr')],
                        ['GET', '/panel-api/v1/clients/{id}/connections', t('dev.epConns')],
                        ['GET', '/panel-api/v1/stats', t('dev.epStats')],
                        ['GET', '/panel-api/v1/tariffs', t('dev.epTariffs')],
                        ['POST', '/panel-api/v1/extend/{id}', t('dev.epExtend')],
                    ].map(([m, p, d]) => (
                        <div key={p + m} className="flex items-center gap-2">
                            <span className={`badge ${m === 'GET' ? 'badge-blue' : m === 'POST' ? 'badge-green' : m === 'DELETE' ? 'badge-red' : 'badge-yellow'}`}>{m}</span>
                            <code className="font-mono text-xs">{p}</code>
                            <span className="text-xs text-slate-500">{d}</span>
                        </div>
                    ))}
                </div>
            </Card>

            <Card title={t('dev.whTitle')}>
                <p className="text-sm text-slate-500 dark:text-slate-400">
                    {t('dev.whText')} <code className="font-mono text-xs">client.created</code>,{' '}
                    <code className="font-mono text-xs">client.expired</code>,{' '}
                    <code className="font-mono text-xs">client.blocked</code>,{' '}
                    <code className="font-mono text-xs">payment.success</code>,{' '}
                    <code className="font-mono text-xs">quota.exceeded</code>.
                    {t('dev.whSigned')} <code className="font-mono text-xs">X-TGGATE-Signature</code>.
                </p>
            </Card>

            <Card title={t('dev.exTitle')}>
                <div className="space-y-6">
                    <CodeBlock title="cURL" code={CURL_EXAMPLE} />
                    <CodeBlock title="🐍 Python (aiogram)" code={PY_EXAMPLE} />
                    <CodeBlock title="🟨 Node.js" code={JS_EXAMPLE} />
                </div>
            </Card>
        </div>
    );
}
