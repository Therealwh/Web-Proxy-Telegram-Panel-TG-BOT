/**
 * @fileoverview Блокировка IP и подсетей администратором.
 *
 * В Telemt глобального списка запрещённых адресов нет — там есть только
 * access.user_source_deny, который действует на конкретного пользователя
 * и срабатывает уже после аутентификации. Поэтому запрет реализуется двумя
 * разными механизмами под задачу:
 *
 *   - порт MTProto — правило nftables: отсекает пакеты на порту движка,
 *     минуя сам движок вообще (экономим память и не тратим сессии);
 *   - веб-прокси — директивы `deny` в Nginx для блок-сайта прокси.
 *
 * Панель и SSH под блокировку не попадают: у панели свой location, у MTProto
 * свой порт. Это принципиально — иначе заблокированный IP заблокировал бы
 * ещё и возможность зайти в админку.
 * @module services/ipBlocklist
 */

const db = require('../db');
const config = require('../config');
const logger = require('../utils/logger');
const { parseCidr, checkScope, contains, addressCount } = require('../utils/cidr');

/** Все записи списка. */
function list() {
    return db.prepare(
        'SELECT id, cidr, reason, enabled, hits, last_hit_at, created_at FROM ip_blocklist ORDER BY id DESC'
    ).all().map((r) => ({ ...r, enabled: !!r.enabled }));
}

/**
 * Добавляет адрес или подсеть в список.
 * @param {string} raw - адрес или CIDR
 * @param {string} reason - комментарий администратора
 * @returns {{cidr: string, warning?: string, addresses: number}}
 */
function add(raw, reason = '') {
    const parsed = parseCidr(raw);
    if (!parsed.ok) {
        const err = new Error(parsed.error);
        err.status = 400;
        throw err;
    }
    const scope = checkScope(parsed);
    if (!scope.ok) {
        const err = new Error(scope.error);
        err.status = 400;
        throw err;
    }
    // Каноническая запись: 10.1.2.3/8 и 10.0.0.0/8 — одна и та же подсеть,
    // иначе в правилах появились бы дубли.
    db.prepare('INSERT OR IGNORE INTO ip_blocklist (cidr, reason) VALUES (?, ?)')
        .run(parsed.cidr, String(reason || '').slice(0, 300));
    return { cidr: parsed.cidr, warning: scope.warning, addresses: addressCount(parsed) };
}

/** Удаляет запись по id. */
function remove(id) {
    return db.prepare('DELETE FROM ip_blocklist WHERE id = ?').run(Number(id)).changes > 0;
}

/** Включает или выключает правило. */
function setEnabled(id, enabled) {
    return db.prepare('UPDATE ip_blocklist SET enabled = ? WHERE id = ?')
        .run(enabled ? 1 : 0, Number(id)).changes > 0;
}

/** Активные правила в виде структуры для применения. */
function active() {
    const rows = db.prepare('SELECT id, cidr, reason FROM ip_blocklist WHERE enabled = 1').all();
    return rows.map((r) => {
        const p = parseCidr(r.cidr);
        return { id: r.id, cidr: r.cidr, reason: r.reason, family: p.family };
    }).filter((r) => r.family);
}

/** Проверяет, не заблокирован ли адрес (для показа в логах и статистике). */
function isBlocked(ip) {
    if (!ip) return false;
    for (const rule of active()) {
        const p = parseCidr(rule.cidr);
        if (p.ok && contains(p, ip)) return rule.cidr;
    }
    return false;
}

/**
 * Разбивает правила по семействам.
 * nftables принимает IPv4 и IPv6 в разных наборах, а Nginx — в одной карте,
 * поэтому список возвращается двумя частями.
 */
function forApply() {
    const rules = active();
    return {
        ipv4: rules.filter((r) => r.family === 4).map((r) => r.cidr),
        ipv6: rules.filter((r) => r.family === 6).map((r) => r.cidr),
    };
}

/** Применяет список через root-хелпер. */
async function sync() {
    // Список передаём файлом: правила могут быть длинными, а через тело
    // запроса в хелпер протаскивать списки адресов не нужно.
    const lists = forApply();
    const body = [...lists.ipv4, ...lists.ipv6].join('\n') + '\n';
    if (!writeListFile(body)) {
        return { ok: false, error: 'Не удалось записать файл списка на сервер' };
    }
    if (!config.helperUrl || !config.helperSecret) {
        return { ok: false, error: 'Хелпер не настроен — примените вручную: bash /opt/tggate/scripts/ip-blocklist.sh' };
    }
    try {
        const res = await fetch(`${config.helperUrl}/run`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ secret: config.helperSecret, key: 'ip-blocklist' }),
            signal: AbortSignal.timeout(15000),
        });
        if (!res.ok) return { ok: false, error: `Хелпер ответил HTTP ${res.status}` };
        logger.info('Список блокировки отправлен на сервер', {
            ipv4: lists.ipv4.length, ipv6: lists.ipv6.length,
        });
        return { ok: true };
    } catch (err) {
        logger.error('Не удалось применить список блокировки', { error: err.message });
        return { ok: false, error: err.message };
    }
}

/**
 * Кладёт список в файл, доступный скрипту на сервере.
 * Хелпер работает от tggate, а правила применяет root-скрипт — поэтому файл
 * пишется в каталог данных панели, куда у хелпера есть доступ.
 * @param {string} content - список подсетей, по одной в строке
 * @returns {boolean} удалось ли записать
 */
function writeListFile(content) {
    try {
        const fs = require('fs');
        const path = require('path');
        const dir = config.dataDir;
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, 'blocklist.txt'), content, 'utf8');
        return true;
    } catch (err) {
        logger.error('Не удалось записать файл списка блокировки', { error: err.message });
        return false;
    }
}

module.exports = { list, add, remove, setEnabled, active, isBlocked, forApply, sync };