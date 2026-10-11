/**
 * @fileoverview Применение резервного маршрута WARP из панели.
 *
 * Всё выключено по умолчанию. Включение — только явным действием
 * администратора: это меняет маршрутизацию сервера, и делать это молча
 * нельзя. Панель лишь передаёт команду скрипту, вся работа с сетью
 * идёт на стороне сервера.
 *
 * Скрипт scripts/warp.sh заворачивает в туннель ТОЛЬКО адреса Telegram DC.
 * Остальной трафик не затрагивается — иначе Cloudflare стал бы
 * обязательной зависимостью для всей работы панели.
 *
 * @module services/warpControl
 */

const { execFile } = require('child_process');
const config = require('../config');
const logger = require('../utils/logger');
const { parseWarpStatus, routeEffective, buildEnableCommands, buildDisableCommands } = require('./warp');

/** Разрешённые действия — тот же список, что проверяет хелпер. */
const ACTIONS = ['status', 'enable', 'disable'];

/**
 * Текущее состояние: установлен ли клиент, подключён ли туннель,
 * включены ли правила маршрутизации.
 *
 * Показываем всё раздельно: правила могут остаться от прошлого раза,
 * а туннель — быть отключённым. Такой маршрут опаснее отсутствия
 * маршрута, поэтому состояние «правила есть, туннеля нет» считаем
 * требующим вмешательства, а не рабочим.
 *
 * @returns {Promise<object>}
 */
async function getState() {
    return new Promise((resolve) => {
        execFile('bash', ['/opt/tggate/scripts/warp.sh', 'status'], { timeout: 8000 }, (err, stdout, stderr) => {
            if (err && !stdout) {
                resolve({
                    available: false,
                    reason: 'Скрипт WARP недоступен. Проверьте, что файл /opt/tggate/scripts/warp.sh есть.',
                });
                return;
            }
            const raw = String(stdout || '');
            const parsed = parseWarpStatus(raw);

            // Правила маршрутизации — из вывода скрипта
            const m = raw.match(/правил маршрутизации:\s*(\d+)\s*из\s*(\d+)/);
            const rules = m ? Number(m[1]) : 0;
            const rulesTotal = m ? Number(m[2]) : 0;

            resolve({
                available: true,
                installed: parsed.installed,
                connected: parsed.connected,
                rulesActive: rules,
                rulesTotal,
                routingEnabled: rules > 0,
                // Работает только если есть и туннель, и правила
                effective: rules > 0 && routeEffective(parsed),
                raw: raw.trim(),
            });
        });
    });
}

/**
 * Выполняет действие через root-хелпер.
 * @param {'enable'|'disable'|'status'} action
 * @returns {Promise<{ok: boolean, error?: string}>}
 */
async function run(action) {
    if (!ACTIONS.includes(action)) {
        return { ok: false, error: `Неизвестное действие: ${action}` };
    }
    if (!config.helperUrl || !config.helperSecret) {
        return {
            ok: false,
            error: 'Хелпер не настроен. Выполните вручную: sudo bash /opt/tggate/scripts/warp.sh ' + action,
        };
    }
    try {
        const res = await fetch(`${config.helperUrl}/run`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ secret: config.helperSecret, key: 'warp', action }),
            signal: AbortSignal.timeout(15000),
        });
        if (!res.ok) return { ok: false, error: `Хелпер ответил HTTP ${res.status}` };
        logger.info(`WARP: выполнено действие ${action}`);
        return { ok: true };
    } catch (err) {
        logger.error('Ошибка выполнения WARP', { action, error: err.message });
        return { ok: false, error: err.message };
    }
}

/**
 * Подсказка для администратора по текущему состоянию.
 * @param {object} state
 * @returns {string|null}
 */
function advice(state) {
    if (!state.available) return null;
    if (state.routingEnabled && !state.connected) {
        return 'Правила маршрутизации включены, но туннель WARP отключён — трафик к Telegram DC сейчас уходит в никуда. Выключите и включите резерв заново.';
    }
    if (state.effective) {
        return 'Резервный маршрут работает. Трафик к Telegram DC идёт через Cloudflare.';
    }
    if (!state.installed) {
        return 'Клиент WARP не установлен на сервере. Без него резервный маршрут включить нельзя.';
    }
    return null;
}

module.exports = { ACTIONS, getState, run, advice, buildEnableCommands, buildDisableCommands };