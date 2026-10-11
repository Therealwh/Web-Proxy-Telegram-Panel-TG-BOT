/**
 * Сборка index.html с пользовательской аналитикой.
 *
 * Шаблон при применении копируется целиком, и обновление панели
 * перезаписывает файлы сайта. Счётчики и верификация при этом
 * пропадали бы, поэтому они живут в отдельном analytics.html,
 * который панель сохраняет и подставляет обратно в маркер.
 *
 * Собранный index.html отдаётся как чистая статика — серверной
 * сборки на лету нет, подстановка происходит один раз, здесь.
 */
const fs = require('fs');
const path = require('path');

const MARKER = '<!--ANALYTICS-->';

/**
 * Вставляет содержимое analytics.html в index.html вместо маркера.
 * @param {string} dir каталог сайта
 * @returns {boolean} была ли выполнена подстановка
 */
function buildIndex(dir) {
    const indexPath = path.join(dir, 'index.html');
    const analyticsPath = path.join(dir, 'analytics.html');
    if (!fs.existsSync(indexPath)) return false;

    let html = fs.readFileSync(indexPath, 'utf8');
    if (!html.includes(MARKER)) return false;

    let analytics = '';
    if (fs.existsSync(analyticsPath)) {
        analytics = fs.readFileSync(analyticsPath, 'utf8').trim();
    }

    html = html.split(MARKER).join(analytics);
    fs.writeFileSync(indexPath, html, 'utf8');
    return true;
}

/**
 * Сохраняет пользовательский analytics.html перед перезаписью каталога.
 * @param {string} dir каталог сайта
 * @returns {string|null} содержимое или null, если файла не было
 */
function preserveAnalytics(dir) {
    const analyticsPath = path.join(dir, 'analytics.html');
    if (!fs.existsSync(analyticsPath)) return null;
    return fs.readFileSync(analyticsPath, 'utf8');
}

/**
 * Восстанавливает analytics.html после копирования шаблона.
 * @param {string} dir каталог сайта
 * @param {string|null} content что восстановить
 */
function restoreAnalytics(dir, content) {
    if (content === null) return;
    fs.writeFileSync(path.join(dir, 'analytics.html'), content, 'utf8');
}

module.exports = { MARKER, buildIndex, preserveAnalytics, restoreAnalytics };