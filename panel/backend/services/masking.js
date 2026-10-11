/**
 * @fileoverview Настройки маскировки: политика SNI и selfmask.
 *
 * Обе настройки живут в конфиге Telemt и НЕ поддерживают hot-reload —
 * меняется файл, процесс перезапускается. Без перезапуска настройка выглядела
 * бы применённой, но не действовала, поэтому рестарт тут обязателен, а его
 * результат мы проверяем отдельно.
 *
 * Политика SNI решает, что отвечать клиенту, который пришёл с чужим SNI:
 *   drop             — молча закрыть соединение;
 *   mask             — проксировать на mask_host:mask_port (максимум маскировки);
 *   accept           — принять и продолжить (хуже защита от активного пробинга);
 *   reject_handshake — TLS-alert unrecognized_name, как у nginx на дефолтном
 *                      vhost'е без такого домена.
 *
 * Selfmask переводит decoy-сайт с режима статической папки на реальный бэкенд
 * (`http_upstream`), чтобы при сканировании или неверном SNI открывался живой
 * сайт, а не заглушка панели.
 * @module services/masking
 */

const telemt = require('./telemtApi');
const config = require('../config');
const logger = require('../utils/logger');
const { restartTelemt } = require('./webCarriers');

/** Допустимые действия при неизвестном SNI. */
const SNI_ACTIONS = ['drop', 'mask', 'accept', 'reject_handshake'];

/** Человеческие описания режимов для интерфейса. */
const SNI_ACTION_LABELS = {
    drop: 'Молча закрыть соединение',
    mask: 'Перенаправить на маску (максимальная маскировка)',
    accept: 'Принять как валидный (слабее защита от пробинга)',
    reject_handshake: 'Отказать рукопожатием (как nginx без этого домена)',
};

/**
 * Проверяет, что адрес selfmask пригоден: Telemt принимает только http://
 * с литералом приватного, loopback или link-local адреса. Имя хоста или
 * https:// движок отвергнет, а ошибка валидации уводит его в аварийный режим.
 * @param {string} raw - адрес в виде host:port или http://host:port
 * @returns {{ok: boolean, upstream?: string, error?: string}}
 */
function validateUpstream(raw) {
    let value = String(raw || '').trim();
    if (!value) return { ok: false, error: 'Укажите адрес бэкенда, например 127.0.0.1:8099' };
    if (value.startsWith('http://')) value = value.slice(7);
    else if (value.startsWith('https://')) {
        return { ok: false, error: 'Telemt принимает только http:// — HTTPS для decoy не поддерживается' };
    }
    if (value.includes('/') || value.includes('@') || value.includes('?') || value.includes('#')) {
        return { ok: false, error: 'Адрес не должен содержать путь, логин или параметры' };
    }
    const m = value.match(/^\[?([^\]]+?)\]?:(\d{1,5})$/);
    if (!m) return { ok: false, error: 'Неверный формат адреса, ожидается host:port' };
    const host = m[1];
    const port = Number(m[2]);
    if (port < 1 || port > 65535) return { ok: false, error: 'Порт вне диапазона 1–65535' };

    // Только IP-литералы приватной/локальной сети — именно это требует Telemt
    if (!isPrivateHost(host)) {
        return { ok: false, error: 'Нужен приватный IP (например 127.0.0.1), а не доменное имя' };
    }
    return { ok: true, upstream: `http://${host}:${port}` };
}

/** Приватный ли это адрес (v4 или v6, включая loopback и link-local). */
function isPrivateHost(host) {
    const h = String(host).toLowerCase();
    if (h === 'localhost') return true;
    if (h === '::1' || h === '0:0:0:0:0:0:0:1') return true;
    const v4 = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
    if (v4) {
        const [a, b] = [Number(v4[1]), Number(v4[2])];
        if (a === 10 || a === 127) return true;
        if (a === 172 && b >= 16 && b <= 31) return true;
        if (a === 192 && b === 168) return true;
        if (a === 169 && b === 254) return true;
        return false;
    }
    if (/^f[cd][0-9a-f]{2}:/.test(h)) return true;   // fc00::/7 — unique local
    if (/^fe[89ab][0-9a-f]:/.test(h)) return true;  // fe80::/10 — link local
    return false;
}

/** Текущее состояние маскировки из конфига Telemt. */
async function getState() {
    try {
        const cfg = await telemt.getConfig();
        const censorship = cfg?.censorship || {};
        const decoy = cfg?.web?.vhosts?.[0]?.decoy || {};
        return {
            available: true,
            sniAction: censorship.unknown_sni_action || 'drop',
            sniAllowed: SNI_ACTIONS,
            sniLabels: SNI_ACTION_LABELS,
            selfmask: decoy.mode === 'http_upstream',
            selfmaskUpstream: decoy.upstream || '',
            tlsDomain: censorship.tls_domain || null,
            tlsDomains: Array.isArray(censorship.tls_domains) ? censorship.tls_domains : [],
        };
    } catch (err) {
        return { available: false, reason: err.message };
    }
}

/**
 * Применяет политику SNI.
 * @param {string} action - одно из SNI_ACTIONS
 * @returns {Promise<{ok: boolean, error?: string}>}
 */
async function applySniAction(action) {
    const value = String(action || '').trim().toLowerCase();
    if (!SNI_ACTIONS.includes(value)) {
        return { ok: false, error: `Неизвестное действие: ${value}. Допустимо: ${SNI_ACTIONS.join(', ')}` };
    }
    try {
        await telemt.patchConfig({ censorship: { unknown_sni_action: value } });
        const restarted = await restartTelemt();
        logger.info('Политика SNI применена', { action: value, restarted });
        return { ok: true, restarted };
    } catch (err) {
        logger.error('Не удалось применить политику SNI', { error: err.message });
        return { ok: false, error: err.message };
    }
}

/**
 * Включает или выключает selfmask (живой сайт за прокси-доменом).
 * @param {boolean} enabled
 * @param {string} [upstream] - адрес бэкенда; обязателен при включении
 * @returns {Promise<{ok: boolean, error?: string}>}
 */
async function applySelfmask(enabled, upstream) {
    try {
        const cfg = await telemt.getConfig();
        const vhosts = cfg?.web?.vhosts;
        if (!Array.isArray(vhosts) || vhosts.length === 0) {
            return { ok: false, error: 'В конфиге Telemt нет vhosts — selfmask применить не к чему' };
        }

        const decoy = { ...(vhosts[0].decoy || {}) };
        if (enabled) {
            const check = validateUpstream(upstream);
            if (!check.ok) return { ok: false, error: check.error };
            decoy.mode = 'http_upstream';
            decoy.upstream = check.upstream;
            delete decoy.directory;
            delete decoy.index;
        } else {
            decoy.mode = 'static_directory';
            decoy.directory = config.websiteDir;
            decoy.index = 'index.html';
            delete decoy.upstream;
        }

        const newVhosts = [...vhosts];
        newVhosts[0] = { ...vhosts[0], decoy };
        await telemt.patchConfig({ web: { vhosts: newVhosts } });
        const restarted = await restartTelemt();
        logger.info('Selfmask применён', { enabled, restarted });
        return { ok: true, restarted, upstream: decoy.upstream || decoy.directory };
    } catch (err) {
        logger.error('Не удалось применить selfmask', { error: err.message });
        return { ok: false, error: err.message };
    }
}

module.exports = {
    SNI_ACTIONS, SNI_ACTION_LABELS, isPrivateHost, validateUpstream,
    getState, applySniAction, applySelfmask,
};