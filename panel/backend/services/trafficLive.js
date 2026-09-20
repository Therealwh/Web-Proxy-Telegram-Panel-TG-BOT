/**
 * @fileoverview Кольцевой буфер скорости трафика для живого графика.
 * Каждые 5 секунд снимает показатель скорости сети (rx/tx байт/с)
 * и хранит историю за 24 часа. Отдаётся с прореживанием под диапазон.
 * @module services/trafficLive
 */

const { getServerLoad } = require('./stats');

const MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24 часа
const MAX_POINTS = 400;                  // точек в ответе после прореживания

/** @type {{t: number, rx: number, tx: number}[]} */
const points = [];
let running = false;

/** Один замер скорости. */
async function sample() {
    const load = await getServerLoad();
    if (!load || !load.network) return;
    points.push({
        t: Date.now(),
        rx: load.network.rx_sec || 0, // Получение
        tx: load.network.tx_sec || 0, // Отправка
    });
    const cutoff = Date.now() - MAX_AGE_MS;
    while (points.length > 0 && points[0].t < cutoff) points.shift();
}

/** Запуск периодического замера. */
function start() {
    if (running) return;
    running = true;
    sample().catch(() => {});
    setInterval(() => sample().catch(() => {}), 5000).unref();
}

/**
 * Серия точек за диапазон с прореживанием.
 * @param {number} rangeMs - 1ч/6ч/24ч в миллисекундах
 */
function getSeries(rangeMs) {
    const cutoff = Date.now() - rangeMs;
    const filtered = points.filter((p) => p.t >= cutoff);
    if (filtered.length <= MAX_POINTS) return filtered;
    const step = Math.ceil(filtered.length / MAX_POINTS);
    const out = filtered.filter((_, i) => i % step === 0);
    const last = filtered[filtered.length - 1];
    if (out[out.length - 1] !== last) out.push(last);
    return out;
}

/** Текущая скорость (последний замер). */
function getCurrent() {
    return points.length > 0
        ? { rx: points[points.length - 1].rx, tx: points[points.length - 1].tx }
        : { rx: 0, tx: 0 };
}

module.exports = { start, getSeries, getCurrent };
