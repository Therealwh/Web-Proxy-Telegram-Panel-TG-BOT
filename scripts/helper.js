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
        if (!secret || parsed.secret !== secret) {
            log('ОТКАЗАНО: неверный секрет');
            res.statusCode = 403;
            return res.end(JSON.stringify({ ok: false, error: 'forbidden' }));
        }

        const script = SCRIPTS[parsed.key];
        if (!script || !fs.existsSync(script)) {
            res.statusCode = 404;
            return res.end(JSON.stringify({ ok: false, error: 'script not found' }));
        }

        const args = parsed.version ? [String(parsed.version)] : [];
        log(`Запуск: ${script} ${args.join(' ')}`);

        // Скрипты сами пишут результат в БД и живут до 10 минут.
        // Обновление панели перезапустит панель — хелпер продолжит работу
        // (это отдельный root-сервис, в cgroup панели он не входит).
        execFile('bash', [script, ...args], { timeout: 600000 }, (err, stdout, stderr) => {
            log(`Завершено (${parsed.key}): ${err ? 'ОШИБКА: ' + (stderr || err.message).slice(0, 500) : 'успех'}`);
        });

        res.end(JSON.stringify({ ok: true }));
    });
});

server.listen(PORT, '127.0.0.1', () => {
    log(`Helper запущен на 127.0.0.1:${PORT}`);
});
