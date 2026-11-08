/**
 * @fileoverview Управление узлами (локациями) мульти-сервера: CRUD,
 * проверка здоровья. Токен узла — секрет: никогда не возвращается целиком.
 * @module routes/nodes
 */

const express = require('express');
const { z } = require('zod');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const { httpError } = require('../middleware/errorHandler');
const audit = require('../middleware/audit');
const nodes = require('../services/nodes');
const { getAll } = require('./settings');

const router = express.Router();

const DOMAIN_RE = /^[a-z0-9.-]+\.[a-z]{2,}$/i;
const URL_RE = /^https?:\/\/[a-z0-9.:-]+$/i;

/** Маскируем токен узла: виден только хвост. */
function maskToken(token) {
    return token ? `••••••${String(token).slice(-4)}` : null;
}

function rowToApi(n) {
    const count = nodes.clientCount(n.id);
    const health = n.last_health ? JSON.parse(n.last_health) : null;
    return { ...n, api_token: maskToken(n.api_token), clients: count, health };
}

// --- Список узлов + локальный движок ---
router.get('/', requireAuth, async (req, res, next) => {
    try {
        const list = nodes.listNodes().map(rowToApi);
        // Локальный движок главной панели — всегда узел №0
        let localHealth = null;
        try {
            localHealth = { ok: true, latency_ms: 0, checked_at: new Date().toISOString() };
            await require('../services/telemtApi').getHealth();
        } catch {
            localHealth = { ok: false, error: 'Локальный Telemt не отвечает', checked_at: new Date().toISOString() };
        }
        res.json({
            nodes: list,
            local: { id: null, name: 'Основной (этот сервер)', domain: getAll().mtproto_domain || null, clients: nodes.clientCount(null), health: localHealth, enabled: 1 },
        });
    } catch (err) { next(err); }
});

const nodeSchema = z.object({
    name: z.string().min(1).max(48),
    emoji: z.string().max(8).nullable().optional(),
    domain: z.string().regex(DOMAIN_RE, 'Домен: вида proxy.example.com'),
    mask_domain: z.string().regex(DOMAIN_RE, 'Домен маскировки: вида www.example.com').nullable().optional(),
    control_url: z.string().regex(URL_RE, 'URL: вида http://1.2.3.4:9091'),
    api_token: z.string().min(8).max(256),
    mtproto_port: z.number().int().min(1).max(65535).nullable().optional(),
    max_clients: z.number().int().min(1).max(1000000).nullable().optional(),
    enabled: z.boolean().optional(),
});

function normalize(data) {
    const d = { ...data };
    for (const k of ['emoji', 'mask_domain', 'mtproto_port', 'max_clients']) {
        if (d[k] === undefined || d[k] === '') d[k] = null;
    }
    d.enabled = d.enabled === false ? 0 : 1;
    return d;
}

// --- Добавить узел ---
router.post('/', requireAuth, audit(db), async (req, res, next) => {
    try {
        const data = normalize(nodeSchema.parse(req.body));
        const info = db.prepare(
            `INSERT INTO nodes (name, emoji, domain, mask_domain, control_url, api_token, mtproto_port, max_clients, enabled)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(data.name, data.emoji || '🌍', data.domain, data.mask_domain, data.control_url,
              data.api_token, data.mtproto_port, data.max_clients, data.enabled);
        nodes.invalidateCache(info.lastInsertRowid);
        const health = await nodes.checkAndStoreHealth(info.lastInsertRowid).catch(() => null);
        res.status(201).json({ ok: true, id: info.lastInsertRowid, health });
    } catch (err) { next(err); }
});

// --- Изменить узел ---
router.patch('/:id', requireAuth, audit(db), async (req, res, next) => {
    try {
        const node = nodes.getNode(Number(req.params.id));
        if (!node) throw httpError(404, 'Узел не найден');
        const data = nodeSchema.partial().parse(req.body);
        // enabled меняется ТОЛЬКО когда пришёл в запросе (иначе частичный
        // PATCH имени молча включал бы выключенный узел)
        if (data.enabled !== undefined) data.enabled = data.enabled ? 1 : 0;
        else delete data.enabled;
        if (data.enabled === 0) {
            const active = nodes.clientCount(node.id);
            if (active > 0) {
                throw httpError(400, `На узле ${active} активных клиентов — сначала смените им локацию`);
            }
        }
        if (data.domain !== undefined) data.domain = String(data.domain).toLowerCase();
        if (data.mask_domain !== undefined && data.mask_domain !== null) data.mask_domain = String(data.mask_domain).toLowerCase();

        // Токен с маской «••••» не перезаписываем
        if (typeof data.api_token === 'string' && data.api_token.startsWith('••••')) delete data.api_token;

        const fields = Object.keys(data);
        if (fields.length) {
            db.prepare(
                `UPDATE nodes SET ${fields.map((f) => `${f} = ?`).join(', ')} WHERE id = ?`
            ).run(...fields.map((f) => data[f]), node.id);
        }
        nodes.invalidateCache(node.id);
        const health = await nodes.checkAndStoreHealth(node.id).catch(() => null);
        res.json({ ok: true, health });
    } catch (err) { next(err); }
});

// --- Удалить узел: только когда на нём нет клиентов (иначе ссылки
//     клиентов молча переключились бы на домен, где их нет) ---
router.delete('/:id', requireAuth, audit(db), async (req, res, next) => {
    try {
        const node = nodes.getNode(Number(req.params.id));
        if (!node) throw httpError(404, 'Узел не найден');
        const total = nodes.clientCount(node.id);
        if (total > 0) {
            throw httpError(400, `На узле ${total} клиентов — сначала перенесите их на другую локацию`);
        }
        db.prepare('DELETE FROM nodes WHERE id = ?').run(node.id);
        nodes.invalidateCache(node.id);
        res.json({ ok: true, clients_moved_back: 0 });
    } catch (err) { next(err); }
});

// --- Проверить здоровье узла ---
router.post('/:id/health', requireAuth, async (req, res, next) => {
    try {
        const health = await nodes.checkAndStoreHealth(Number(req.params.id));
        if (!health) throw httpError(404, 'Узел не найден');
        res.json({ ok: true, health });
    } catch (err) { next(err); }
});

module.exports = router;
