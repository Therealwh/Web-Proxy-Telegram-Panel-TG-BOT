/**
 * @fileoverview Логгер TGGATE. Пишет в консоль и в файл с ротацией по размеру.
 * В продакшене console.log не используется нигде, кроме этого модуля.
 * @module utils/logger
 */

const fs = require('fs');
const path = require('path');
const config = require('../config');

const MAX_LOG_SIZE = 5 * 1024 * 1024; // 5 МБ на файл

// Создаём каталог логов, если его нет
try {
    fs.mkdirSync(config.logDir, { recursive: true });
} catch {
    // Если нет прав (например, dev-режим) — пишем только в консоль
}

const LOG_FILE = path.join(config.logDir, 'panel.log');

/**
 * Форматирует строку лога с меткой времени и уровнем.
 * @param {string} level - уровень (INFO/WARN/ERROR)
 * @param {string} message - текст сообщения
 * @returns {string} отформатированная строка
 */
function format(level, message) {
    return `${new Date().toISOString()} [${level}] ${message}`;
}

/**
 * Дописывает строку в файл лога; при превышении размера переименовывает
 * текущий файл в panel.log.1 (простая ротация).
 * @param {string} line - строка для записи
 */
function writeToFile(line) {
    try {
        if (fs.existsSync(LOG_FILE) && fs.statSync(LOG_FILE).size > MAX_LOG_SIZE) {
            fs.renameSync(LOG_FILE, LOG_FILE + '.1');
        }
        fs.appendFileSync(LOG_FILE, line + '\n');
    } catch {
        // Игнорируем ошибки записи лога — не должны ронять приложение
    }
}

/**
 * Базовая функция логирования.
 * @param {string} level - уровень
 * @param {string} message - сообщение
 * @param {object} [meta] - дополнительные данные (сериализуются в JSON)
 */
function log(level, message, meta) {
    let line = format(level, message);
    if (meta !== undefined) {
        try {
            line += ' ' + JSON.stringify(meta);
        } catch {
            line += ' [meta не сериализуется]';
        }
    }
    // В консоль — всегда (systemd заберёт в journal)
    const fn = level === 'ERROR' ? console.error : level === 'WARN' ? console.warn : console.info;
    fn(line);
    writeToFile(line);
}

module.exports = {
    /** @param {string} msg @param {object} [meta] */
    info: (msg, meta) => log('INFO', msg, meta),
    /** @param {string} msg @param {object} [meta] */
    warn: (msg, meta) => log('WARN', msg, meta),
    /** @param {string} msg @param {object} [meta] */
    error: (msg, meta) => log('ERROR', msg, meta),
};
