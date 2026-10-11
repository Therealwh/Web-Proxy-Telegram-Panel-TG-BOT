/**
 * Аудит ключей перевода: все t('...') в коде против ru.js и en.js.
 *
 * Нужен потому, что ключи уже терялись: команда git checkout вернула
 * i18n-файлы к HEAD вместе с незакоммиченными правками, и в интерфейсе
 * появились сырые ключи вместо текста. Скрипт ловит такое сразу.
 *
 * Ключи с параметрами (t('x.y', {...})) и динамические (t(`faketlsReason.${r}`))
 * проверяются по префиксу.
 */
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', 'src');
const I18N = path.join(SRC, 'i18n');

function walk(dir, out = []) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) { if (e.name !== 'i18n') walk(p, out); }
        else if (/\.(jsx|js)$/.test(e.name)) out.push(p);
    }
    return out;
}

// Ключи вида t('a.b.c') — только статические, без шаблонных подстановок
const STATIC_RE = /\bt\(\s*'([a-zA-Z0-9_.]+)'/g;
// Динамические вида t(`prefix.${x}`) — берём префикс до точки
const DYNAMIC_RE = /\bt\(\s*`([a-zA-Z0-9_]+(?:\.[a-zA-Z0-9_]+)*)\./g;

const used = new Set();
for (const file of walk(SRC)) {
    const src = fs.readFileSync(file, 'utf8');
    for (const m of src.matchAll(STATIC_RE)) used.add(m[1]);
    for (const m of src.matchAll(DYNAMIC_RE)) used.add(m[1] + '.');
}

function collectKeys(obj, prefix, out) {
    for (const [k, v] of Object.entries(obj)) {
        const full = prefix ? `${prefix}.${k}` : k;
        // Промежуточные объекты тоже в множество: без них префиксы динамических
        // ключей вида t(`settings.${x}`) выглядят как отсутствующие.
        out.add(full);
        if (v && typeof v === 'object' && !Array.isArray(v)) collectKeys(v, full, out);
    }
    return out;
}

function loadDict(name) {
    const src = fs.readFileSync(path.join(I18N, name), 'utf8');
    // Комментарии вырезаем: иначе `return ` + «// комментарий\n{…}» превращается
    // в return без значения и последующий блок, и парсер падает.
    const body = src
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '')
        .replace(/^import[^\n]*$/gm, '')
        .replace(/export\s+default\s*/, '')
        .trim();
    return new Function(`return ${body.replace(/;\s*$/, '')};`)();
}

let totalMissing = 0;
for (const lang of ['ru', 'en']) {
    const dict = collectKeys(loadDict(lang + '.js'), '', new Set());
    const missing = [...used].filter((k) => {
        const probe = k.endsWith('.') ? k.slice(0, -1) : k;
        return !dict.has(k) && !dict.has(probe);
    }).sort();
    totalMissing += missing.length;
    console.log(`\n${lang}.js — ключей в словаре: ${dict.size}, использовано в коде: ${used.size}`);
    if (missing.length === 0) console.log('  все ключи на месте');
    else {
        console.log(`  ОТСУТСТВУЮТ (${missing.length}):`);
        for (const k of missing) console.log('    ' + k);
    }
}

process.exit(totalMissing === 0 ? 0 : 1);