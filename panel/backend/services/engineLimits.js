/**
 * @fileoverview Лимиты ресурсов движка Telemt (память и CPU).
 *
 * Без потолка памяти один неадекватный клиент способен съесть RAM, и
 * OOM-killer выберет жертву наугад — панель, nginx или caddy. MemoryMax
 * ограничивает процессы именно telemt: при достижении предела перезапускается
 * только движок, а панель остаётся доступной, чтобы это увидеть и починить.
 *
 * Лимиты применяются скриптом scripts/telemt-limits.sh, который сам считает их
 * от фактической памяти сервера и кладёт в systemd drop-in. Правка самого
 * telemt.service не годится: обновление движка её перезапишет, а drop-in
 * переживает обновления и работает на ранее установленных серверах.
 * @module services/engineLimits
 */

const { execFile } = require('child_process');
const config = require('../config');
const logger = require('../utils/logger');

/** Преобразует значение systemd (байты или "infinity") в байты. */
function parseBytes(value) {
    if (!value || value === 'infinity') return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
}

/**
 * Считает долю памяти движка от потолка в процентах.
 * Вынесено отдельно ради тестов: это единственное место, где легко
 * перепутать байты с мегабайтами и получить 0% или 10000%.
 * @param {number|null} current - текущее потребление в байтах
 * @param {number|null} max - потолок в байтах
 * @returns {number|null} процент или null, если данных нет
 */
function usagePercent(current, max) {
    if (max === null || max === undefined || max <= 0) return null;
    if (current === null || current === undefined) return null;
    return Math.round((current / max) * 100);
}

/** Читает применённые лимиты и текущее потребление из systemd. */
function getStatus() {
    return new Promise((resolve) => {
        execFile('systemctl', ['show', 'telemt', '-p', 'MemoryMax', '-p', 'MemoryHigh',
            '-p', 'MemoryCurrent', '-p', 'CPUQuotaPerSecUSec', '-p', 'ActiveState'],
        { timeout: 5000 }, (err, stdout) => {
            if (err) {
                resolve({ available: false, reason: 'systemctl недоступен', applied: false });
                return;
            }
            const props = {};
            for (const line of stdout.split('\n')) {
                const i = line.indexOf('=');
                if (i > 0) props[line.slice(0, i)] = line.slice(i + 1);
            }
            const memoryMax = parseBytes(props.MemoryMax);
            const memoryCurrent = parseBytes(props.MemoryCurrent);
            resolve({
                available: true,
                // MemoryMax=infinity означает, что лимит не выставлен
                applied: memoryMax !== null,
                memoryMax,
                memoryHigh: parseBytes(props.MemoryHigh),
                memoryCurrent,
                // Процент от лимита: >90% — движок близко к перезапуску
                usagePercent: usagePercent(memoryCurrent, memoryMax),
                active: props.ActiveState === 'active',
            });
        });
    });
}

/**
 * Применяет лимиты через root-хелпер.
 * @returns {Promise<{ok: boolean, error?: string}>}
 */
async function apply() {
    if (!config.helperUrl || !config.helperSecret) {
        return { ok: false, error: 'Хелпер не настроен. Выполните на сервере: bash /opt/tggate/scripts/telemt-limits.sh' };
    }
    try {
        const res = await fetch(`${config.helperUrl}/run`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ secret: config.helperSecret, key: 'telemt-limits' }),
            signal: AbortSignal.timeout(15000),
        });
        if (!res.ok) return { ok: false, error: `Хелпер ответил HTTP ${res.status}` };
        return { ok: true };
    } catch (err) {
        logger.error('Ошибка применения лимитов Telemt', { error: err.message });
        return { ok: false, error: err.message };
    }
}

module.exports = { getStatus, apply, parseBytes, usagePercent };