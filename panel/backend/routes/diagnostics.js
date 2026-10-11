/**
 * @fileoverview Диагностика панели по кнопке «Проверить систему».
 *
 * Собрана так, чтобы ответ НИКОГДА не содержал секретов: проверяется только
 * факт наличия и стойкость, но не само значение. Администратор видит
 * «достаточно» или «слабый», но не токен, не пароль и не JWT-секрет.
 *
 * Все проверки best-effort: сбой одной не должен ронять остальные.
 * @module routes/diagnostics
 */

const express = require('express');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const db = require('../db');
const config = require('../config');
const { getServerLoad } = require('../services/stats');
const { getStatus } = require('../services/versionInfo');
const logger = require('../utils/logger');

const router = express.Router();

/** Статусы: ok — норма, warn — стоит поправить, fail — поломка. */
const OK = 'ok';

/** Выполняет команду с таймаутом, никогда не бросает. */
function run(cmd, args, timeout = 5000) {
    return new Promise((resolve) => {
        execFile(cmd, args, { timeout, stdio: ['ignore', 'pipe', 'ignore'] }, (err, stdout) => {
            resolve({ ok: !err, out: String(stdout || '').trim() });
        });
    });
}

/** Простейшая оценка стойкости строки без вывода самой строки. */
function secretStrength(value, { min = 32 } = {}) {
    const s = String(value || '');
    if (!s) return { state: 'missing' };
    if (s.length < min) return { state: 'weak' };
    if (/^(change-me|secret|password|test|dev)/i.test(s)) return { state: 'weak' };
    if (s.length < 48) return { state: 'ok' };
    return { state: 'ok' };
}

/** Свободно ли место на диске с данными. */
function diskUsage(dir) {
    try {
        const st = fs.statfsSync(dir);
        const freeMb = Math.floor(st.bavail * st.bsize / 1024 / 1024);
        const totalMb = Math.floor(st.blocks * st.bsize / 1024 / 1024);
        const usedPct = totalMb > 0 ? Math.round((1 - st.bavail / st.blocks) * 100) : 0;
        return { freeMb, totalMb, usedPct };
    } catch {
        return null;
    }
}

/** Свежесть последнего бэкапа по дате каталога. */
function lastBackup() {
    try {
        const dirs = fs.readdirSync(config.backupDir, { withFileTypes: true })
            .filter((d) => d.isDirectory() && d.name.startsWith('pre-update-'))
            .map((d) => d.name)
            .sort()
            .reverse();
        if (!dirs.length) return null;
        const full = path.join(config.backupDir, dirs[0]);
        const mtime = fs.statSync(full).mtimeMs;
        const days = Math.floor((Date.now() - mtime) / 86400000);
        return { name: dirs[0], days };
    } catch {
        return null;
    }
}

/** Целостность БД и соответствие схемы последней миграции. */
function dbHealth() {
    const res = { quickCheck: null, version: null, migrations: 0, sizeMb: 0 };
    try {
        res.quickCheck = db.pragma('quick_check', { simple: true });
    } catch {
        res.quickCheck = 'unknown';
    }
    try {
        // schema_version хранит по строке на каждую применённую миграцию,
        // поэтому нужна MAX, а не произвольная строка
        res.version = db.prepare('SELECT COALESCE(MAX(version), 0) AS v FROM schema_version').get()?.v ?? null;
        const dir = path.join(__dirname, '..', 'migrations');
        // Сравнивать надо НОМЕР последней миграции, а не количество файлов:
        // нумерация не сплошная (например, 012 отсутствует)
        const nums = fs.readdirSync(dir)
            .filter((f) => /^\d+_.+\.sql$/.test(f))
            .map((f) => parseInt(f, 10));
        res.migrations = nums.length ? Math.max(...nums) : 0;
    } catch {
        /* таблиц может не быть — не критично */
    }
    try {
        const bytes = fs.statSync(config.dbPath).size;
        res.sizeMb = Math.round(bytes / 1024 / 1024 * 10) / 10;
    } catch {
        res.sizeMb = 0;
    }
    return res;
}

/** Собирает все проверки. Тяжёлые вызовы выполняются параллельно. */
async function runChecks() {
    const loadP = getServerLoad().catch(() => null);
    const versionsP = getStatus().catch(() => null);
    const telemtP = run('systemctl', ['is-active', 'telemt']);
    const nginxP = run('systemctl', ['is-active', 'nginx']);
    const panelP = run('systemctl', ['is-active', 'tggate-panel']);
    const limitsP = require('../services/engineLimits').getStatus().catch(() => null);

    const [load, versions, telemtSvc, nginxSvc, panelSvc, limits] =
        await Promise.all([loadP, versionsP, telemtP, nginxP, panelP, limitsP]);

    const setting = (key) => {
        const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
        if (!row) return null;
        try { return JSON.parse(row.value); } catch { return row.value; }
    };

    const groups = [];

    // --- Версии ---
    groups.push({
        id: 'versions',
        status: versions?.panel?.latest && versions.panel.current !== versions.panel.latest ? 'warn' : OK,
        items: [
            { label: 'Панель', value: versions?.panel?.current || 'неизвестно' },
            { label: 'Доступная версия', value: versions?.panel?.latest || 'неизвестно' },
            { label: 'Telemt', value: versions?.telemt?.current || 'неизвестно' },
            { label: 'Node.js', value: process.version },
        ],
    });

    // --- Сервисы ---
    const svc = (r, name) => ({ label: name, value: r.ok && r.out === 'active' ? 'работает' : `не работает (${r.out || 'нет ответа'})` });
    const servicesOk = telemtSvc.ok && telemtSvc.out === 'active';
    groups.push({
        id: 'services',
        status: servicesOk && panelSvc.ok ? (nginxSvc.ok && nginxSvc.out === 'active' ? OK : 'warn') : 'fail',
        items: [svc(telemtSvc, 'Telemt (прокси)'), svc(panelSvc, 'Панель'), svc(nginxSvc, 'Nginx')],
    });

    // --- Ресурсы ---
    const disk = diskUsage(config.dataDir);
    const items = [];
    if (load) {
        items.push({ label: 'Загрузка CPU', value: `${load.cpu ?? 0}%` });
        items.push({
            label: 'Память',
            // systeminformation отдаёт байты
            value: `${load.ram?.percent ?? 0}% из ${Math.round((load.ram?.total ?? 0) / 1024 / 1024)} МБ`,
        });
        if (load.uptime) {
            const days = Math.floor(load.uptime / 86400);
            items.push({ label: 'Аптайм', value: days >= 1 ? `${days} дн.` : `${Math.floor(load.uptime / 3600)} ч.` });
        }
    }
    if (disk) {
        items.push({ label: 'Диск', value: `занято ${disk.usedPct}%, свободно ${disk.freeMb} МБ` });
    }
    groups.push({
        id: 'resources',
        status: disk && (disk.usedPct >= 90 || disk.freeMb < 512) ? 'fail'
            : (load && (load.ram?.percent ?? 0) >= 90 ? 'warn' : OK),
        items: items.length ? items : [{ label: 'Данные', value: 'не удалось получить' }],
    });

    // --- Лимиты ресурсов движка ---
    // Пользователь должен видеть потолок памяти и долю от него, иначе о том,
    // что движок упирается в лимит, он узнает только после падения всего.
    if (limits?.available) {
        const mb = (b) => (b === null ? '—' : `${Math.round(b / 1048576)} МБ`);
        const nearLimit = (limits.usagePercent ?? 0) >= 90;
        groups.push({
            id: 'engine_limits',
            status: !limits.applied ? 'warn' : nearLimit ? 'warn' : OK,
            items: [
                {
                    label: 'Потолок памяти Telemt',
                    value: limits.applied ? mb(limits.memoryMax) : 'не установлен',
                },
                {
                    label: 'Сейчас занимает',
                    value: limits.memoryCurrent === null
                        ? '—'
                        : `${mb(limits.memoryCurrent)}${limits.usagePercent !== null ? ` (${limits.usagePercent}% от лимита)` : ''}`,
                },
                { label: 'Мягкий порог', value: mb(limits.memoryHigh) },
                {
                    label: 'Пояснение',
                    value: limits.applied
                        ? 'При достижении потолка перезапустится только движок, панель останется доступна'
                        : 'Без лимита OOM-killer может убить панель или nginx вместо движка',
                },
            ],
        });
    }

    // --- База данных ---
    const dbs = dbHealth();
    const schemaBehind = dbs.version !== null && dbs.migrations > 0 && dbs.version < dbs.migrations;
    groups.push({
        id: 'database',
        status: dbs.quickCheck !== 'ok' ? 'fail' : schemaBehind ? 'warn' : OK,
        items: [
            { label: 'Целостность', value: dbs.quickCheck === 'ok' ? 'ок' : String(dbs.quickCheck) },
            { label: 'Версия схемы', value: `${dbs.version ?? '—'} из ${dbs.migrations} миграций` },
            { label: 'Размер БД', value: dbs.sizeMb < 0.1 ? '< 0.1 МБ' : `${dbs.sizeMb} МБ` },
        ],
    });

    // --- Бэкапы ---
    const bk = lastBackup();
    groups.push({
        id: 'backup',
        status: !bk ? 'warn' : bk.days > 7 ? 'warn' : OK,
        items: [
            { label: 'Последний бэкап', value: bk ? `${bk.name} (${bk.days} дн. назад)` : 'не найдено' },
            { label: 'Автобэкапы', value: setting('backup_auto') === false ? 'выключены' : 'включены' },
        ],
    });

    // --- Безопасность (значения секретов НЕ выводятся) ---
    const jwt = secretStrength(config.jwtSecret);
    const admins = db.prepare('SELECT COUNT(*) AS c FROM admins').get().c;
    const keys = db.prepare('SELECT COUNT(*) AS c FROM api_keys WHERE enabled = 1').get().c;
    const sessions = db.prepare('SELECT COUNT(*) AS c FROM refresh_tokens WHERE revoked = 0').get().c;
    const weak = jwt.state !== 'ok';
    groups.push({
        id: 'security',
        status: jwt.state === 'missing' ? 'fail' : weak ? 'warn' : OK,
        items: [
            {
                label: 'JWT-секрет',
                value: jwt.state === 'missing' ? 'не задан' : jwt.state === 'weak' ? 'слабый или задан по умолчанию' : 'достаточной длины',
            },
            { label: 'Администраторов', value: String(admins) },
            { label: 'Активных API-ключей', value: String(keys) },
            { label: 'Активных сессий', value: String(sessions) },
            { label: 'Двухфакторная аутентификация', value: 'не используется' },
        ],
    });

    // --- Уведомления ---
    const hasToken = !!setting('tg_bot_token');
    const hasChat = !!setting('tg_admin_chat_id');
    groups.push({
        id: 'notify',
        status: hasToken && hasChat ? OK : 'warn',
        items: [
            { label: 'Токен бота', value: hasToken ? 'задан' : 'не задан' },
            { label: 'Чат уведомлений', value: hasChat ? 'задан' : 'не задан' },
        ],
    });

    const summary = { ok: 0, warn: 0, fail: 0 };
    for (const g of groups) summary[g.status] = (summary[g.status] || 0) + 1;

    return { groups, summary, checkedAt: new Date().toISOString() };
}

// --- Кэш на 60 секунд: кнопка не должна долбить систему при частом нажатии ---
let cache = null;
const CACHE_MS = 60_000;

router.get('/', async (req, res, next) => {
    try {
        if (cache && Date.now() - cache.at < CACHE_MS) return res.json(cache.data);

        const data = await runChecks();
        cache = { at: Date.now(), data };
        logger.info('Выполнена диагностика системы', { summary: data.summary });
        res.json(data);
    } catch (err) {
        next(err);
    }
});

module.exports = router;