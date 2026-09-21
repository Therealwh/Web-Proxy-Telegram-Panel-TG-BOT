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

        const args = parsed.version ? [String(parsed.version)] : [];
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
