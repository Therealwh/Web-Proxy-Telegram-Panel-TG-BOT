/**
 * @fileoverview TGGATE Helper — привилегированный помощник панели.
 * Крошечный root-сервис на 127.0.0.1:9443: панель отправляет запрос
 * {secret, key, version} — хелпер запускает соответствующий root-скрипт.
 *
 * ЗАЧЕМ: панель работает от пользователя tggate и не может запускать
 * root-команды (sudo-правила хрупки и зависели от ручной настройки).
 * Хелпер ставится автоматически install.sh / install-helper.sh.
 *
 * Безопасность: слушает ТОЛЬКО loopback, доступ по секрету из
 * /etc/tggate/install.env (HELPER_SECRET), выполняет ровно 3 скрипта.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');

const PORT = Number(process.env.HELPER_PORT || 9443);
const SCRIPTS_DIR = '/opt/tggate/scripts';
const LOG_FILE = '/var/log/tggate/helper.log';

/** Разрешённые действия: key -> скрипт. Больше ничего не выполняется. */
const SCRIPTS = {
    panel: path.join(SCRIPTS_DIR, 'update-panel.sh'),
    telemt: path.join(SCRIPTS_DIR, 'update-telemt.sh'),
    check: path.join(SCRIPTS_DIR, 'check-updates.sh'),
    domain: path.join(SCRIPTS_DIR, 'change-domain.sh'),
    'web-domain': path.join(SCRIPTS_DIR, 'setup-web-domain.sh'),
    'restart-telemt': path.join(SCRIPTS_DIR, 'restart-telemt.sh'),
    'restart-panel': path.join(SCRIPTS_DIR, 'restart-panel.sh'),
    'restart-all': path.join(SCRIPTS_DIR, 'restart-all.sh'),
    zapret2: path.join(SCRIPTS_DIR, 'zapret2-ctl.sh'),
};

/** Секрет из install.env (генерируется установщиком/install-helper.sh). */
function getSecret() {
    try {
        const env = fs.readFileSync('/etc/tggate/install.env', 'utf8');
        const m = env.match(/^HELPER_SECRET="?([^"\n]+)"?$/m);
        return m ? m[1] : null;
    } catch {
        return null;
    }
}

/** Constant-time сравнение секретов. */
function safeEqual(a, b) {
    const ba = Buffer.from(String(a));
    const bb = Buffer.from(String(b));
    if (ba.length !== bb.length) return false;
    return crypto.timingSafeEqual(ba, bb);
}

// Мьютекс: только один обновляющий процесс одновременно
let busy = false;

function log(msg) {
    const line = `${new Date().toISOString()} ${msg}\n`;
    try { fs.appendFileSync(LOG_FILE, line); } catch { /* ignore */ }
}

let systemdRunAvailable = false;
try {
    execFileSync('systemd-run', ['--version'], { stdio: 'ignore' });
    systemdRunAvailable = true;
} catch { /* нет systemd-run — обновления пойдут как раньше */ }

const server = http.createServer((req, res) => {
    if (req.method !== 'POST' || !req.url.startsWith('/run')) {
        res.statusCode = 404;
        return res.end('not found');
    }
    let body = '';
    req.on('data', (c) => { body += c; if (body.length > 4096) req.destroy(); });
    req.on('end', () => {
        let parsed;
        try { parsed = JSON.parse(body || '{}'); } catch { res.statusCode = 400; return res.end('bad json'); }

        const secret = getSecret();
        if (!secret || !safeEqual(parsed.secret, secret)) {
            log('ОТКАЗАНО: неверный секрет');
            res.statusCode = 403;
            return res.end(JSON.stringify({ ok: false, error: 'forbidden' }));
        }

        // Обновление панели перезапускает панель; параллельные обновления запрещены
        if (busy) {
            res.statusCode = 409;
            return res.end(JSON.stringify({ ok: false, error: 'update already running' }));
        }

        const script = SCRIPTS[parsed.key];
        if (!script || !fs.existsSync(script)) {
            res.statusCode = 404;
            return res.end(JSON.stringify({ ok: false, error: 'script not found' }));
        }

        // Ключ cron: обновление /etc/cron.d/tggate-updates (root)
        if (parsed.key === 'cron') {
            const allowed = ['off', 'hourly', 'daily', 'weekly', 'monthly'];
            if (!allowed.includes(parsed.frequency)) {
                res.statusCode = 400;
                return res.end(JSON.stringify({ ok: false, error: 'bad frequency' }));
            }
            const cronMap = { hourly: '0 * * * *', daily: '0 4 * * *', weekly: '0 4 * * 1', monthly: '0 4 1 * *' };
            const line = parsed.frequency === 'off' ? '' : `${cronMap[parsed.frequency]} root ${SCRIPTS.check} >/dev/null 2>&1\n`;
            fs.writeFileSync('/etc/cron.d/tggate-updates', line);
            log(`Cron обновлён: ${parsed.frequency}`);
            return res.end(JSON.stringify({ ok: true }));
        }

        // Zapret2: действие строго из белого списка (install/remove/start/stop/restart)
        if (parsed.key === 'zapret2') {
            const allowed = ['install', 'remove', 'start', 'stop', 'restart'];
            const action = String(parsed.action || '');
            if (!allowed.includes(action)) {
                res.statusCode = 400;
                return res.end(JSON.stringify({ ok: false, error: 'bad action' }));
            }
            busy = true;
            log(`zapret2: ${action}`);
            execFile('bash', [script, action], { timeout: 600000 }, (err, stdout, stderr) => {
                busy = false;
                log(`zapret2 ${action} завершено: ${err ? 'ОШИБКА: ' + (stderr || err.message).slice(0, 500) : 'успех'}`);
            });
            return res.end(JSON.stringify({ ok: true }));
        }

        // Zapret2: мгновенный статус через systemd (достоверный ответ, без флага busy).
        // Показывает active/inactive/failed и жив ли процесс nfqws2.
        if (parsed.key === 'zapret2-status') {
            execFile('bash', ['-c', 'systemctl is-active tggate-zapret2.service 2>/dev/null; pgrep -x nfqws2 >/dev/null 2>&1 && echo PROC=1 || echo PROC=0; echo ---JOURNAL---; journalctl -u tggate-zapret2 -n 20 --no-pager -o short-iso 2>/dev/null'], (err, stdout) => {
                const out = String(stdout || '');
                const active = /^active$/m.test(out);
                const failed = /failed|inactive/.test(out);
                const proc = /PROC=1/.test(out);
                const journal = out.split('---JOURNAL---\n')[1] || '';
                res.end(JSON.stringify({ ok: true, active, failed, proc, journal }));
            });
            return;
        }

        // Смена домена: аргумент — строго валидный домен (execFile, без shell)
        if (parsed.key === 'domain' || parsed.key === 'web-domain') {
            const d = String(parsed.domain || '').toLowerCase().trim();
            const DOMAIN_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;
            if (!DOMAIN_RE.test(d) || d.length > 253) {
                res.statusCode = 400;
                return res.end(JSON.stringify({ ok: false, error: 'bad domain' }));
            }
            busy = true;
            log(`Смена домена (${parsed.key}) → ${d}`);
            execFile('bash', [script, d], { timeout: 180000 }, (err, stdout, stderr) => {
                busy = false;
                log(`Смена домена завершена: ${err ? 'ОШИБКА: ' + (stderr || err.message).slice(0, 500) : 'успех'}`);
            });
            return res.end(JSON.stringify({ ok: true }));
        }

        const args = parsed.version ? [String(parsed.version)] : [];
        // Долгие обновления отвязываем от cgroup хелпера (systemd-run):
        // рестарт хелпера больше не убивает установку пакетов посреди пути
        if ((parsed.key === 'panel' || parsed.key === 'telemt') && systemdRunAvailable) {
            const unit = `tggate-update-${parsed.key}-${Date.now()}`;
            // Передаём ПОЛНОЕ окружение хелпера (HOME, PATH и т.д.) —
            // иначе npm в чистом юните падает без кэша и переменных
            const envArgs = [];
            for (const [k, v] of Object.entries(process.env)) {
                if (v !== undefined) envArgs.push('--setenv', `${k}=${v}`);
            }
            log(`Обновление в отдельном юните: ${unit}`);
            execFile('systemd-run', ['--collect', `--unit=${unit}`, ...envArgs, 'bash', script, ...args],
                { timeout: 30000 }, (err) => {
                    if (err) log(`systemd-run не удался (${err.message}) — скрипт продолжит в cgroup хелпера`);
                });
            return res.end(JSON.stringify({ ok: true }));
        }
        log(`Запуск: ${script} ${args.join(' ')}`);

        // Скрипты сами пишут результат в БД и живут до 10 минут.
        // Обновление панели перезапустит панель — хелпер продолжит работу
        // (это отдельный root-сервис, в cgroup панели он не входит).
        busy = true;
        execFile('bash', [script, ...args], { timeout: 600000 }, (err, stdout, stderr) => {
            busy = false;
            log(`Завершено (${parsed.key}): ${err ? 'ОШИБКА: ' + (stderr || err.message).slice(0, 500) : 'успех'}`);
        });

        res.end(JSON.stringify({ ok: true }));
    });
});

server.listen(PORT, '127.0.0.1', () => {
    log(`Helper запущен на 127.0.0.1:${PORT}`);
});
