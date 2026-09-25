/**
 * @fileoverview Безопасная работа с путями внутри корневого каталога.
 * Вынесено из routes/website.js для тестируемости (скилл owasp-security-audit §3).
 * @module utils/safePath
 */

const path = require('path');
const fs = require('fs');

// Разрешённые имена файлов (защита от path traversal)
const NAME_RE = /^[A-Za-z0-9_.\-/]{1,128}$/;

/**
 * Проверяет безопасность относительного пути внутри корневого каталога.
 * Разворачивает симлинки (realpath) — закрывает symlink-escape (MINOR-7).
 * @param {string} baseDir - корневой каталог (должен существовать)
 * @param {string} name - относительный путь от пользователя
 * @returns {string} абсолютный канонический путь внутри baseDir
 * @throws {Error} при попытке выйти за пределы каталога
 */
function safePath(baseDir, name) {
    if (typeof name !== 'string' || name.length === 0 || name.includes('..') ||
        // Абсолютный путь (POSIX и Windows с диском) — отклоняем до всякой нормализации
        path.isAbsolute(name) || /^[a-zA-Z]:/.test(name) || !NAME_RE.test(name)) {
        throw Object.assign(new Error('Некорректное имя файла'), { status: 400 });
    }
    const abs = path.normalize(path.join(baseDir, name));
    if (!abs.startsWith(path.normalize(baseDir))) {
        throw Object.assign(new Error('Некорректное имя файла'), { status: 400 });
    }
    // Symlink-escape: если файл/каталог существует, realpath должен остаться внутри base
    try {
        const realBase = fs.realpathSync(baseDir);
        const real = fs.realpathSync(abs);
        if (!real.startsWith(realBase + path.sep) && real !== realBase) {
            throw Object.assign(new Error('Некорректное имя файла'), { status: 400 });
        }
        return real;
    } catch (err) {
        // ENOENT — путь ещё не существует: безопасно, возвращаем неканонический путь;
        // наши собственные reject-ошибки (status: 400) пробрасываем дальше
        if (err.code === 'ENOENT') return abs;
        throw err;
    }
}

module.exports = { safePath, NAME_RE };
