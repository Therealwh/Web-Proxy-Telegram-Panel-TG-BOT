/**
 * @fileoverview Узлы (локации) мульти-сервера: реестр, здоровье, выбор
 * клиента Telemt по узлу, перенос клиента между локациями.
 *
 * Клиент с node_id = NULL живёт на локальном движке главной панели —
 * это поведение по умолчанию, идентичное до-мульти-серверному.
 * @module services/nodes
 */

const db = require('../db');
const logger = require('../utils/logger');
const telemtApi = require('./telemtApi');

/** Кэш клиентов по узлам: создаётся один раз на узел, сбрасывается при правке. */
const apiCache = new Map();

/** Локальный движок главной панели. */
function localApi() {
    return telemtApi;
}

/** Клиент Telemt для узла (или локальный, если nodeId пустой). */
function getApiForNodeId(nodeId) {
    if (!nodeId) return localApi();
    if (apiCache.has(nodeId)) return apiCache.get(nodeId);
    const node = getNode(nodeId);
    if (!node) return localApi();
    const client = telemtApi.createTelemtClient({
        apiUrl: node.control_url,
        apiAuth: `Bearer ${node.api_token}`,
    });
    apiCache.set(nodeId, client);
    return client;
}

/** Клиент Telemt для конкретного клиента (по его node_id). */
function getApiForClient(client) {
    return getApiForNodeId(client?.node_id || null);
}

function invalidateCache(nodeId) {
    if (nodeId === undefined) apiCache.clear();
    else apiCache.delete(nodeId);
}

// ---------------------------------------------------------------------------
// Реестр
// ---------------------------------------------------------------------------

function getNode(nodeId) {
    return db.prepare('SELECT * FROM nodes WHERE id = ?').get(nodeId) || null;
}

function listNodes({ enabledOnly = false } = {}) {
    return db.prepare(
        `SELECT * FROM nodes ${enabledOnly ? 'WHERE enabled = 1' : ''} ORDER BY id`
    ).all();
}

/** Количество активных клиентов узла. */
function clientCount(nodeId) {
    return db.prepare(
        `SELECT COUNT(*) AS c FROM clients WHERE node_id ${nodeId ? '= ?' : 'IS NULL'} AND status = 'active'`
    ).get(...(nodeId ? [nodeId] : [])).c;
}

/** Здоровье узла: /v1/health + задержка. @returns {Promise<{ok, latency_ms, error?}>} */
async function probeHealth(node) {
    const api = getApiForNodeId(node.id);
    const started = Date.now();
    try {
        await api.getHealth();
        return { ok: true, latency_ms: Date.now() - started, checked_at: new Date().toISOString() };
    } catch (e) {
        return { ok: false, latency_ms: Date.now() - started, error: e.message, checked_at: new Date().toISOString() };
    }
}

async function checkAndStoreHealth(nodeId) {
    const node = getNode(nodeId);
    if (!node) return null;
    const health = await probeHealth(node);
    db.prepare('UPDATE nodes SET last_health = ? WHERE id = ?')
        .run(JSON.stringify(health), nodeId);
    return health;
}

/**
 * Локации, доступные для выдачи: локальный движок + включённые узлы,
 * отвечающие на health (узел с недавним красным health не предлагаем).
 * @returns {Promise<Array<{id: number|null, name: string, emoji: string, domain: string}>>}
 */
async function availableLocations() {
    const locations = [{ id: null, name: 'Основной', emoji: '🏠', domain: null }];
    for (const node of listNodes({ enabledOnly: true })) {
        if (node.max_clients && clientCount(node.id) >= node.max_clients) continue;
        const health = await probeHealth(node);
        db.prepare('UPDATE nodes SET last_health = ? WHERE id = ?').run(JSON.stringify(health), node.id);
        if (health.ok) {
            locations.push({
                id: node.id,
                name: node.name,
                emoji: node.emoji || '🌍',
                domain: node.domain,
            });
        } else {
            logger.warn('Узел недоступен — не предлагаю в локациях', { node: node.name, error: health.error });
        }
    }
    return locations;
}

/**
 * Перенос клиента на другой узел: тот же username/secret/срок/лимиты,
 * на исходном узле пользователь удаляется. Секрет сохраняется — у клиента
 * меняется только домен в ссылках.
 * @returns {Promise<object>} обновлённая запись клиента
 */
async function moveClient(client, targetNodeId) {
    const targetId = targetNodeId || null;
    if ((client.node_id || null) === targetId) return client;

    const sourceApi = getApiForNodeId(client.node_id || null);
    const targetApi = getApiForNodeId(targetId);
    const target = targetId ? getNode(targetId) : null;

    const user = await sourceApi.getUser(client.username).catch(() => null);
    if (!user) {
        // На исходном узле пользователя нет — просто переносим учётную запись
        db.prepare('UPDATE clients SET node_id = ? WHERE id = ?').run(targetId, client.id);
        invalidateCache(); // не кэш узла — данные клиента
        return db.prepare('SELECT * FROM clients WHERE id = ?').get(client.id);
    }

    // Создаём на целевом узле с ТЕМ ЖЕ секретом — ссылки меняют только домен
    await targetApi.createUser({
        username: client.username,
        secret: client.secret,
        expiration_rfc3339: client.expires_at || undefined,
        ...(client.quota_bytes ? { data_quota_bytes: client.quota_bytes } : {}),
        ...(client.max_ips ? { max_unique_ips: client.max_ips } : {}),
        ...(client.rate_down_bps ? { rate_limit_down_bps: client.rate_down_bps } : {}),
        ...(client.rate_up_bps ? { rate_limit_up_bps: client.rate_up_bps } : {}),
        enabled: client.status === 'active',
    });

    db.prepare('UPDATE clients SET node_id = ? WHERE id = ?').run(targetId, client.id);
    const updated = db.prepare('SELECT * FROM clients WHERE id = ?').get(client.id);

    // Удаляем со старого узла после успешного создания
    await sourceApi.deleteUser(client.username).catch((e) =>
        logger.warn('Перенос: не удалось удалить пользователя на исходном узле', {
            username: client.username, error: e.message,
        }));

    logger.info('Клиент перенесён на другой узел', {
        username: client.username,
        from: client.node_id || 'local',
        to: target?.name || 'local',
    });
    return updated;
}

module.exports = {
    getNode, listNodes, clientCount, getApiForNodeId, getApiForClient,
    invalidateCache, probeHealth, checkAndStoreHealth, availableLocations, moveClient,
};
