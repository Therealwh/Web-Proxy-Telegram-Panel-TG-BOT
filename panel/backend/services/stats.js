/**
 * @fileoverview Сервис системной статистики с кэшированием.
 * Собирает CPU/RAM/сеть/диск через systeminformation; кэш обновляется
 * не чаще, чем раз в CACHE_TTL мс, чтобы не нагружать систему.
 * @module services/stats
 */

const si = require('systeminformation');
const logger = require('../utils/logger');

const CACHE_TTL = 5000; // 5 секунд кэш

let cache = null;
let cacheTime = 0;
let prevNet = null; // для подсчёта скорости сети

/**
 * Собирает текущую нагрузку сервера.
 * @returns {Promise<object>} { cpu, ram, disk, network, uptime }
 */
async function getServerLoad() {
    const now = Date.now();
    if (cache && now - cacheTime < CACHE_TTL) return cache;

    try {
        const [cpu, mem, disk, net, time] = await Promise.all([
            si.currentLoad(),
            si.mem(),
            si.fsSize(),
            si.networkStats(),
            si.time(),
        ]);

        // Скорость сети: разница счётчиков за период между вызовами
        let network = { rx_sec: 0, tx_sec: 0 };
        const mainIface = net.find((i) => i.iface !== 'lo') || net[0];
        if (mainIface) {
            if (prevNet && prevNet.iface === mainIface.iface) {
                const dt = (now - prevNet.time) / 1000;
                if (dt > 0) {
                    network = {
                        rx_sec: Math.max(0, Math.round((mainIface.rx_bytes - prevNet.rx) / dt)),
                        tx_sec: Math.max(0, Math.round((mainIface.tx_bytes - prevNet.tx) / dt)),
                    };
                }
            }
            prevNet = { iface: mainIface.iface, rx: mainIface.rx_bytes, tx: mainIface.tx_bytes, time: now };
        }

        const rootDisk = disk.find((d) => d.mount === '/') || disk[0];

        cache = {
            cpu: Math.round(cpu.currentLoad),
            ram: {
                total: mem.total,
                used: mem.used,
                percent: Math.round((mem.used / mem.total) * 100),
            },
            disk: rootDisk
                ? { total: rootDisk.size, used: rootDisk.used, percent: Math.round(rootDisk.use) }
                : null,
            network,
            uptime: time.uptime,
        };
        cacheTime = now;
        return cache;
    } catch (err) {
        logger.error('Ошибка сбора системной статистики', { error: err.message });
        return cache || { cpu: 0, ram: null, disk: null, network: { rx_sec: 0, tx_sec: 0 }, uptime: 0 };
    }
}

module.exports = { getServerLoad };
