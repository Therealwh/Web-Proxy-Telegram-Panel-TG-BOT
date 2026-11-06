/**
 * @fileoverview Диагностика сервера, тюнинг лимитов движка Telemt и
 * TOML-редактор конфига. Изменяющие операции идут через Control API Telemt
 * (валидация до применения — панель физически не может отправить конфиг,
 * который Telemt отвергнет) и через root-хелпер (запись файла + рестарт
 * + автоматический откат при сбое). Профили пользователей и прочие настройки
 * не затрагиваются: патч мержится с текущим конфигом, меняются только лимиты.
 * @module routes/engineTuning
 */

const express = require('express');
const os = require('os');
const fs = require('fs');
const http = require('http');
const { z } = require('zod');
const si = require('systeminformation');
const config = require('../config');
const telemt = require('../services/telemtApi');
const engineLimits = require('../services/engineLimits');
const { requireAuth } = require('../middleware/auth');
const { recommendLimits, verifyLimits, LIMIT_LABELS } = require('../utils/engineTuning');
const logger = require('../utils/logger');

const router = express.Router();
const DRAFT_PATH = '/var/lib/tggate/telemt-editor-draft.toml';

/** Поля web.limits с границами: щедрые, но отсекающие мусор/опечатки.
 *  Полная валидация — формулами verifyLimits (как у Telemt). */
const LIMITS_SCHEMA = z.object({
    max_profiles: z.coerce.number().int().min(1).max(100000),
    max_sessions_global: z.coerce.number().int().min(16).max(65536),
    max_sessions_per_ip: z.coerce.number().int().min(1).max(4096),
    max_http_connections: z.coerce.number().int().min(256).max(65536),
    max_streams_per_session: z.coerce.number().int().min(16).max(65535),
    max_streams_global: z.coerce.number().int().min(256).max(262144),
    max_bootstraps_global: z.coerce.number().int().min(64).max(65536),
    max_bootstraps_per_ip: z.coerce.number().int().min(1).max(4096),
    max_http_overload_connections: z.coerce.number().int().min(16).max(65536),
    control_bytes_global: z.coerce.number().int().min(16 * 1024 ** 2).max(4 * 1024 ** 3),
    control_bytes_per_session: z.coerce.number().int().min(107200).max(16 * 1024 ** 2),
    pending_items_global: z.coerce.number().int().min(4096).max(16777216),
    pending_items_per_session: z.coerce.number().int().min(4096).max(1048576),
    pending_items_per_lane: z.coerce.number().int().min(64).max(1048576),
    pending_bytes_global: z.coerce.number().int().min(64 * 1024 ** 2).max(4 * 1024 ** 3),
    pending_bytes_per_session: z.coerce.number().int().min(1024 ** 2).max(1024 ** 3),
    pending_bytes_per_lane: z.coerce.number().int().min(8192).max(64 * 1024 ** 2),
    websocket_bytes_global: z.coerce.number().int().min(16 * 1024 ** 2).max(4 * 1024 ** 3),
    max_tombstones_per_session: z.coerce.number().int().min(1).max(4096),
    max_header_bytes: z.coerce.number().int().min(8192).max(65536),
    max_body_bytes: z.coerce.number().int().min(8192).max(50 * 1024 ** 2),
    max_frame_payload_bytes: z.coerce.number().int().min(8192).max(4 * 1024 ** 2),
    carrier_batch_bytes: z.coerce.number().int().min(8192).max(50 * 1024 ** 2),
    max_body_bytes_global: z.coerce.number().int().min(16 * 1024 ** 2).max(1024 ** 3),
    max_static_bytes: z.coerce.number().int().min(1024 ** 2).max(1024 ** 3),
    max_static_file_bytes: z.coerce.number().int().min(65536).max(1024 ** 2),
    max_static_files: z.coerce.number().int().min(16).max(65536),
    max_vhosts: z.coerce.number().int().min(1).max(1024),
    max_carrier_learning_entries: z.coerce.number().int().min(64).max(65536),
    http_connection_capacity_action: z.enum(['drop', 'wait', 'respond']),
    memory_envelope_bytes: z.coerce.number().int().min(256 * 1024 ** 2).max(4 * 1024 ** 3),
});

/** Вызов root-хелпера (тот же контракт, что в routes/updates.js). */
function helperRun(key, version) {
    return new Promise((resolve) => {
        if (!config.helperUrl || !config.helperSecret) {
            return resolve({
                ok: false,
                error: 'Хелпер не настроен. Выполните на сервере от root: bash /opt/tggate/scripts/install-helper.sh && systemctl restart tggate-panel',
            });
        }
        const payload = JSON.stringify({ secret: config.helperSecret, key, ...(version !== undefined ? { version } : {}) });
        const port = new URL(config.helperUrl).port || 443;
        const req = http.request({
            host: '127.0.0.1',
            port,
            path: '/run',
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
            timeout: 120000,
        }, (res) => {
            let data = '';
            res.on('data', (c) => { data += c; });
            res.on('end', () => {
                try { resolve(JSON.parse(data)); }
                catch { resolve({ ok: res.statusCode === 200, log: data }); }
            });
        });
        req.on('error', (e) => resolve({ ok: false, error: e.message }));
        req.on('timeout', () => { req.destroy(); resolve({ ok: false, error: 'таймаут хелпера' }); });
        req.write(payload);
        req.end();
    });
}

// ---------------------------------------------------------------------------
// GET /api/engine/tuning — диагностика + текущие лимиты + рекомендации
// ---------------------------------------------------------------------------
router.get('/tuning', requireAuth, async (req, res, next) => {
    try {
        const [mem, cpuInfo, disks, engine, cfg] = await Promise.all([
            si.mem(),
            si.cpu(),
            si.fsSize().catch(() => []),
            engineLimits.getStatus(),
            telemt.getConfig().catch(() => null),
        ]);
        const disk = disks.find((d) => d.mount === '/') || disks[0] || null;
        const limits = cfg?.web?.limits || {};
        const maxConnections = cfg?.server?.max_connections ?? null;
        const recommended = recommendLimits(mem.total);

        res.json({
            hardware: {
                cores: os.cpus().length,
                cpuModel: (os.cpus()[0]?.model || '').trim(),
                ramTotal: mem.total,
                ramUsed: mem.total - mem.available,
                ramFree: mem.free,
                diskTotal: disk?.size ?? null,
                diskUsed: disk?.used ?? null,
                diskPercent: disk && disk.size ? Math.round((disk.used / disk.size) * 100) : null,
                uptimeSeconds: Math.round(os.uptime()),
            },
            service: engine,
            current: { max_connections: maxConnections, limits },
            recommended,
            envelope: limits.memory_envelope_bytes ?? null,
            memoryMax: engine.memoryMax,
            labels: LIMIT_LABELS,
        });
    } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// POST /api/engine/tuning — применить лимиты (полный web.limits одним патчем
// + max_connections) и перезапустить движок. Профили пользователей и прочие
// настройки не затрагиваются: патч мержится с текущим конфигом.
// ---------------------------------------------------------------------------
const TuningBody = z.object({
    limits: z.record(z.string(), z.unknown()).default({}),
    max_connections: z.coerce.number().int().min(0).max(1000000).default(0),
});

router.post('/tuning', requireAuth, async (req, res, next) => {
    try {
        const parsedBody = TuningBody.safeParse(req.body);
        if (!parsedBody.success) {
            return res.status(400).json({ ok: false, error: 'Некорректные значения лимитов' });
        }

        const cfg = await telemt.getConfig().catch(() => null);
        if (!cfg?.web?.limits) {
            return res.status(502).json({ ok: false, error: 'Telemt недоступен: не удалось прочитать текущие лимиты' });
        }

        const envelope = recommendLimits(os.totalmem()).envelope;
        const merged = { ...cfg.web.limits, ...parsedBody.data.limits, memory_envelope_bytes: envelope };

        const verifyError = verifyLimits(merged);
        if (verifyError) {
            return res.status(400).json({ ok: false, error: `Telemt отклонит такой конфиг: ${verifyError}` });
        }

        await telemt.patchConfig({ web: { limits: merged }, server: { max_connections: merged.max_connections } });

        // web.limits — restart-only поля: перезапуск движка через root-хелпер
        await helperRun('restart-telemt');
        await new Promise((r) => setTimeout(r, 3000));

        let verified = null;
        let serviceActive = false;
        try {
            const after = await telemt.getConfig();
            verified = after?.web?.limits || null;
            serviceActive = (await engineLimits.getStatus()).active === true;
        } catch { /* верификация недоступна — вернём применённое */ }

        logger.info('Лимиты Telemt применены через страницу тюнинга', {
            sessions: merged.max_sessions_global,
            restarted: true,
            serviceActive,
        });

        res.json({
            ok: !!verified && serviceActive,
            applied: { limits: merged, max_connections: merged.max_connections },
            verified: verified || null,
            serviceActive,
            restarted: true,
            ...(serviceActive ? {} : { error: 'Telemt не поднялся после рестарта — проверьте journalctl -u telemt' }),
        });
    } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// TOML-редактор: чтение через хелпер, сохранение — черновик в /var/lib/tggate
// + root-хелпер применяет с бэкапом, рестартом и автооткатом при сбое.
// ---------------------------------------------------------------------------
router.get('/config-toml', requireAuth, async (req, res, next) => {
    try {
        const r = await helperRun('telemt-config-read');
        if (!r.ok) {
            return res.status(502).json({ ok: false, error: r.error || 'Хелпер не смог прочитать конфиг' });
        }
        res.json({ ok: true, content: String(r.content || '') });
    } catch (err) { next(err); }
});

const TomlBody = z.object({ content: z.string().min(10).max(1024 * 1024) });

router.post('/config-toml', requireAuth, async (req, res, next) => {
    try {
        const parsedBody = TomlBody.safeParse(req.body);
        if (!parsedBody.success) {
            return res.status(400).json({ ok: false, error: 'Некорректное содержимое конфига' });
        }
        const content = parsedBody.data.content;
        if (!content.includes('[server]')) {
            return res.status(400).json({ ok: false, error: 'В конфиге отсутствует секция [server] — сохранение отклонено' });
        }
        // Черновик пишет панель (tggate) — у неё есть права на /var/lib/tggate
        fs.writeFileSync(DRAFT_PATH, content, { encoding: 'utf-8', mode: 0o600 });
        const r = await helperRun('telemt-config-apply', DRAFT_PATH);
        const logText = String(r.log || '');
        const ok = r.ok === true && /OK:/.test(logText);
        logger.info('TOML-редактор: применение конфига Telemt', { ok, log: logText.slice(0, 500) });
        res.json({ ok, log: logText, ...(ok ? {} : { error: logText || 'Хелпер не смог применить конфиг' }) });
    } catch (err) { next(err); }
});

module.exports = router;
