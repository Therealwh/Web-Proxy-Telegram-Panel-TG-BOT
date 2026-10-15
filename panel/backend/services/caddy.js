/**
 * Caddy: валидация конфига перед рестартом и дедупликация сайтов.
 *
 * История: в Caddyfile оказался дубликат сайта status.vpstg.run, и при
 * очередном рестарте Caddy отказался стартовать («ambiguous site
 * definition»). Порт 443 nobody слушал — сайт и веб-прокси легли.
 * Дубль писал установщик статуса-домена, поэтому защита делается здесь,
 * при каждой записи конфига.
 */
const { execFile } = require('child_process');

/** Путь к Caddyfile и бинарнику — переопределяется в тестах. */
const CADDYFILE = '/etc/caddy/Caddyfile';
const CADDY_BIN = 'caddy';

/**
 * Убирает дубликаты сайтов в Caddyfile.
 *
 * Разбирает файл на глобальный блок (в начале) и блоки «site { … }».
 * Первый блок сайта сохраняется, повторные отбрасываются целиком.
 * @param {string} src исходный Caddyfile
 * @returns {{ text: string, removed: string[] }} новый конфиг и список удалённых
 */
function dedupeSites(src) {
    const lines = src.split('\n');
    const out = [];
    const seen = new Set();
    const removed = [];
    let i = 0;
    const n = lines.length;

    const siteStart = (line) => {
        // Имя сайта в начале строки: домен, «домен:порт», «*» или адрес
        const m = line.match(/^([^\s{#][^\s{]*)\s*\{/);
        return m ? m[1] : null;
    };

    // Глобальный блок — до первого сайта
    while (i < n && siteStart(lines[i]) === null) {
        out.push(lines[i]);
        i += 1;
    }

    while (i < n) {
        const site = siteStart(lines[i]);
        if (!site) { out.push(lines[i]); i += 1; continue; }

        const block = [];
        let depth = 0;
        while (i < n) {
            const line = lines[i];
            block.push(line);
            depth += (line.match(/\{/g) || []).length;
            depth -= (line.match(/\}/g) || []).length;
            i += 1;
            if (depth <= 0) break;
        }

        if (seen.has(site)) removed.push(site);
        else { seen.add(site); out.push(...block); }
    }

    return { text: out.join('\n'), removed };
}

/**
 * Валидирует Caddyfile через сам Caddy.
 * @param {string} [file] путь к конфигу
 * @returns {Promise<{ok: boolean, output: string}>}
 */
function validate(file = CADDYFILE) {
    return new Promise((resolve) => {
        execFile(CADDY_BIN, ['validate', '--config', file], { timeout: 15000 }, (err, stdout, stderr) => {
            resolve({ ok: !err, output: String(stdout || '') + String(stderr || '') });
        });
    });
}

module.exports = { dedupeSites, validate, CADDYFILE, CADDY_BIN };