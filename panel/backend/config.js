/**
 * @fileoverview Конфигурация backend панели TGGATE.
 * Загружает переменные окружения из .env и предоставляет их с дефолтами
 * и базовой валидацией. Все секреты — только через этот модуль.
 * @module config
 */

require('dotenv').config();

const path = require('path');

/**
 * Возвращает обязательную переменную окружения или выбрасывает ошибку.
 * @param {string} name - имя переменной
 * @returns {string} значение переменной
 * @throws {Error} если переменная не задана
 */
function required(name) {
    const value = process.env[name];
    if (!value) {
        throw new Error(`Отсутствует обязательная переменная окружения: ${name}`);
    }
    return value;
}

module.exports = {
    // Режим работы
    env: process.env.NODE_ENV || 'development',
    isProd: process.env.NODE_ENV === 'production',

    // Сеть
    port: Number(process.env.PORT || 3000),
    host: process.env.HOST || '127.0.0.1',
    domain: process.env.DOMAIN || 'localhost',
    serverIp: process.env.SERVER_IP || '127.0.0.1',
    adminPath: process.env.ADMIN_PATH || 'admin',

    // Безопасность
    jwtSecret: required('JWT_SECRET'),
    jwtAccessTtl: process.env.JWT_ACCESS_TTL || '12h',   // жизнь access-токена
    jwtRefreshTtl: process.env.JWT_REFRESH_TTL || '30d',  // жизнь refresh-токена

    // Telemt Control API
    telemt: {
        apiUrl: process.env.TELEMT_API_URL || 'http://127.0.0.1:9091',
        apiAuth: process.env.TELEMT_API_AUTH || '',
        configPath: process.env.TELEMT_CONFIG || '/etc/tggate/telemt.toml',
    },

    // Пути
    dbPath: process.env.DB_PATH || path.join(__dirname, 'data', 'tggate.db'),
    dataDir: process.env.DATA_DIR || path.join(__dirname, 'data'),
    backupDir: process.env.BACKUP_DIR || path.join(__dirname, 'backups'),
    logDir: process.env.LOG_DIR || path.join(__dirname, 'logs'),
    websiteDir: path.join(process.env.DATA_DIR || path.join(__dirname, 'data'), 'website'),
    frontendDist: path.join(__dirname, '..', 'frontend', 'dist'),

    // Прокси
    mtprotoPort: Number(process.env.MTPROTO_PORT || 8443),
};
