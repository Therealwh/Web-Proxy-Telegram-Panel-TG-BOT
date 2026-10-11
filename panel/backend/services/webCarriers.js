/**
 * @fileoverview Резервные WEB-носители (carrier) с перебором у клиента.
 *
 * Telemt умеет пробовать несколько транспортов подряд, пока клиент не выберет
 * рабочий: `web.carriers` — порядок кандидатов, `web.carrier` — финальный
 * запасной, добавляется один раз. Пустой массив отключает перебор.
 *
 * Два ограничения, которые нельзя игнорировать:
 *   1) Telegram iOS поддерживает только `https`, поэтому запасной вариант
 *      обязан остаться `https` — иначе отвалится весь iOS;
 *   2) `carriers` не поддерживает hot-reload, поэтому после PATCH конфига
 *      движок нужно перезапустить, иначе настройка молча не применится.
 *
 * Пользователь меняет порядок перебора; выбор конкретного транспорта
 * всегда остаётся за клиентом.
 * @module services/webCarriers
 */

const db = require('../db');
const telemt = require('./telemtApi');
const config = require('../config');
const logger = require('../utils/logger');

/** Все поддерживаемые Telemt транспорты. */
const ALL_CARRIERS = ['https', 'https-lanes', 'websocket', 'websocket-lanes'];

/** Запасной вариант: единственный, который понимает Telegram iOS. */
const FALLBACK_CARRIER = 'https';

/** Telemt не даёт набор кандидатов шире четырёх (с запасным). */
const MAX_CANDIDATES = 3;

/**
 * Приводит значение настройки к валидному массиву кандидатов.
 * https удаляется: он и так всегда добавляется как запасной.
 * @param {unknown} value - значение из настроек
 * @returns {string[]} уникальные кандидаты в заданном порядке
 * @throws {Error} при неизвестном транспорте или дубликатах
 */
function normalize(value) {
    if (value === false || value === null || value === undefined || value === '') return [];
    let list = value;
    if (typeof value === 'string') {
        const s = value.trim();
        if (s === 'false' || s === '') return [];
        if (s.startsWith('[')) {
            try { list = JSON.parse(s); } catch { throw new Error('Не удалось разобрать список носителей'); }
        } else {
            list = s.split(',').map((x) => x.trim()).filter(Boolean);
        }
    }
    if (!Array.isArray(list)) throw new Error('Список носителей должен быть массивом');
    if (list.length === 0) return [];

    const out = [];
    for (const raw of list) {
        const c = String(raw).trim().toLowerCase();
        if (!ALL_CARRIERS.includes(c)) {
            throw new Error(`Неизвестный носитель: ${c}. Доступны: ${ALL_CARRIERS.join(', ')}`);
        }
        if (c === FALLBACK_CARRIER) continue;
        if (out.includes(c)) throw new Error(`Повтор в списке носителей: ${c}`);
        out.push(c);
    }
    if (out.length > MAX_CANDIDATES) {
        throw new Error(`Слишком много носителей: максимум ${MAX_CANDIDATES} кандидатов плюс запасной ${FALLBACK_CARRIER}`);
    }
    // lanes требуют отдельных обработчиков — проверяем лимит движка
    return out;
}

/** Текущее состояние перебора из настроек. */
function getState() {
    let stored = [];
    try {
        const row = db.prepare('SELECT value FROM settings WHERE key = ?').get('web_carriers');
        if (row) stored = JSON.parse(row.value);
    } catch { /* настройка ещё не задана */ }
    let current = null;
    try {
        const row = db.prepare('SELECT value FROM settings WHERE key = ?').get('web_carriers_applied');
        if (row) current = JSON.parse(row.value);
    } catch { /* ещё не применяли */ }
    return {
        candidates: normalize(stored),
        fallback: FALLBACK_CARRIER,
        applied: current,
        supported: ALL_CARRIERS,
        needsRestart: current ? JSON.stringify(current) !== JSON.stringify(normalize(stored)) : true,
    };
}

function saveApplied(value) {
    db.prepare(
        'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
    ).run('web_carriers_applied', JSON.stringify(value));
}

/**
 * Применяет порядок перебора к работающему Telemt.
 * PATCH меняет конфиг, но carriers не перечитывается на лету — нужен рестарт.
 * @param {string[]} candidates - порядок кандидатов
 * @returns {Promise<{ok: boolean, candidates: string[], restarted: boolean, error?: string}>}
 */
async function apply(candidates) {
    const wanted = normalize(candidates);
    try {
        await telemt.patchConfig({ web: { carriers: wanted } });
        saveApplied(wanted);

        const restarted = await restartTelemt();
        logger.info('Порядок WEB-носителей применён', { candidates: wanted, restarted });
        return { ok: true, candidates: wanted, restarted };
    } catch (err) {
        logger.error('Не удалось применить порядок WEB-носителей', { error: err.message });
        return { ok: false, candidates: wanted, restarted: false, error: err.message };
    }
}

/** Перезапуск движка через root-хелпер. */
async function restartTelemt() {
    if (!config.helperUrl || !config.helperSecret) {
        logger.warn('Хелпер не настроен — перезапуск Telemt пропущен, примените вручную');
        return false;
    }
    try {
        const res = await fetch(`${config.helperUrl}/run`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ secret: config.helperSecret, key: 'restart-telemt' }),
            signal: AbortSignal.timeout(15000),
        });
        return res.ok;
    } catch (err) {
        logger.error('Ошибка перезапуска Telemt', { error: err.message });
        return false;
    }
}

module.exports = { ALL_CARRIERS, FALLBACK_CARRIER, MAX_CANDIDATES, normalize, getState, apply, restartTelemt };