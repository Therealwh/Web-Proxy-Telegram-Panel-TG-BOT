/**
 * @fileoverview Управление сайтом-заглушкой: файловый менеджер,
 * чтение/запись файлов, загрузка, применение шаблонов, reload Telemt.
 * @module routes/website
 */

const express = require('express');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const { z } = require('zod');

// Загрузка файлов в память (лимит 5 МБ), запись на диск после проверки имени
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });
const config = require('../config');
const { httpError } = require('../middleware/errorHandler');
const telemt = require('../services/telemtApi');
const logger = require('../utils/logger');

const router = express.Router();

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 МБ (лимит задан в multer)
const INSTALL_TEMPLATES = path.join(__dirname, '..', '..', '..', 'templates', 'websites');

// Разрешённые имена файлов (защита от path traversal)
const NAME_RE = /^[A-Za-z0-9_.\/-]{1,128}$/;

/**
 * Проверяет безопасность относительного пути внутри каталога сайта.
 * @param {string} name - относительный путь
 * @returns {string} абсолютный путь
 * @throws {Error} при попытке выйти за пределы каталога
 */
function safePath(name) {
    if (!NAME_RE.test(name) || name.includes('..')) {
        throw httpError(400, 'Некорректное имя файла');
    }
    const abs = path.normalize(path.join(config.websiteDir, name));
    if (!abs.startsWith(path.normalize(config.websiteDir))) {
        throw httpError(400, 'Некорректное имя файла');
    }
    return abs;
}

/** Рекурсивно собирает список файлов каталога. */
function listFiles(dir, prefix = '') {
    const out = [];
    if (!fs.existsSync(dir)) return out;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (entry.isDirectory()) {
            out.push(...listFiles(path.join(dir, entry.name), rel));
        } else {
            out.push({ name: rel, size: fs.statSync(path.join(dir, entry.name)).size });
        }
    }
    return out;
}

/** Просит Telemt перечитать статику (reload), не роняя запрос при ошибке. */
async function reloadTelemt() {
    try {
        await telemt.reload();
    } catch (err) {
        logger.warn('Не удалось применить reload Telemt после правки сайта', { error: err.message });
    }
}

// --- Список файлов ---
router.get('/files', (req, res) => {
    res.json({ files: listFiles(config.websiteDir) });
});

// --- Прочитать файл ---
router.get('/files/:name(*)', (req, res, next) => {
    try {
        const abs = safePath(req.params.name);
        if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) throw httpError(404, 'Файл не найден');
        res.json({ name: req.params.name, content: fs.readFileSync(abs, 'utf8') });
    } catch (err) {
        next(err);
    }
});

// --- Сохранить файл ---
router.put('/files/:name(*)', async (req, res, next) => {
    try {
        const schema = z.object({ content: z.string().max(MAX_FILE_SIZE, 'Файл больше 5 МБ') });
        const { content } = schema.parse(req.body);
        const abs = safePath(req.params.name);
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        fs.writeFileSync(abs, content, 'utf8');
        logger.info('Файл сайта обновлён', { name: req.params.name });
        await reloadTelemt();
        res.json({ ok: true });
    } catch (err) {
        next(err);
    }
});

// --- Удалить файл ---
router.delete('/files/:name(*)', async (req, res, next) => {
    try {
        const abs = safePath(req.params.name);
        if (!fs.existsSync(abs)) throw httpError(404, 'Файл не найден');
        if (req.params.name === 'index.html') throw httpError(400, 'index.html удалять нельзя');
        fs.unlinkSync(abs);
        await reloadTelemt();
        res.json({ ok: true });
    } catch (err) {
        next(err);
    }
});

// --- Загрузка файла (multipart) ---
router.post('/upload', upload.single('file'), async (req, res, next) => {
    try {
        if (!req.file) throw httpError(400, 'Файл не найден в запросе');
        const filename = path.basename(req.file.originalname);
        const abs = safePath(filename);
        fs.writeFileSync(abs, req.file.buffer);
        logger.info('Файл загружен на сайт', { filename, size: req.file.size });
        await reloadTelemt();
        res.json({ ok: true, name: filename });
    } catch (err) {
        next(err);
    }
});

// --- Список шаблонов сайтов ---
router.get('/templates', (req, res) => {
    const names = { repair: '🔧 Сайт на ремонте (анимация)', cars: '🚗 Автомобили', women: '💄 Женский портал' };
    const templates = [];
    if (fs.existsSync(INSTALL_TEMPLATES)) {
        for (const dir of fs.readdirSync(INSTALL_TEMPLATES)) {
            if (fs.statSync(path.join(INSTALL_TEMPLATES, dir)).isDirectory()) {
                templates.push({ id: dir, name: names[dir] || dir });
            }
        }
    }
    res.json({ templates });
});

// --- Применить шаблон ---
router.post('/apply-template', async (req, res, next) => {
    try {
        const schema = z.object({ template: z.string().regex(/^[a-z0-9-]+$/) });
        const { template } = schema.parse(req.body);
        const src = path.join(INSTALL_TEMPLATES, template);
        if (!fs.existsSync(src)) throw httpError(404, 'Шаблон не найден');

        // Бэкап текущего сайта
        const backupDir = path.join(config.backupDir, `website-${Date.now()}`);
        if (fs.existsSync(config.websiteDir)) {
            fs.cpSync(config.websiteDir, backupDir, { recursive: true });
        }
        fs.rmSync(config.websiteDir, { recursive: true, force: true });
        fs.cpSync(src, config.websiteDir, { recursive: true });

        logger.info('Применён шаблон сайта', { template, backup: backupDir });
        await reloadTelemt();
        res.json({ ok: true, backup: backupDir });
    } catch (err) {
        next(err);
    }
});

module.exports = router;
