/**
 * @fileoverview Тикеты поддержки: список, диалог, ответ админа, закрытие.
 * Ответ уходит клиенту в бот с уведомлением.
 * @module routes/tickets
 */

const express = require('express');
const { z } = require('zod');
const ticketsService = require('../services/tickets');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

router.get('/', requireAuth, (req, res) => {
    const search = String(req.query.search || '');
    const status = String(req.query.status || '');
    res.json({ tickets: ticketsService.listTickets({ search, status }) });
});

router.get('/:id/messages', requireAuth, (req, res, next) => {
    try {
        const id = Number(req.params.id);
        const ticket = require('../db').prepare('SELECT * FROM tickets WHERE id = ?').get(id);
        if (!ticket) return res.status(404).json({ error: 'Обращение не найдено' });
        res.json({ ticket, messages: ticketsService.ticketMessages(id) });
    } catch (err) { next(err); }
});

// Медиа сообщения (фото/PDF) — проксируется из Telegram (JWT; для <img> — ?token=)
router.get('/:id/media/:msgId', requireAuth, async (req, res, next) => {
    try {
        const db = require('../db');
        const msg = db.prepare(
            'SELECT file_id, media_type, file_name FROM ticket_messages WHERE id = ? AND ticket_id = ? AND file_id IS NOT NULL'
        ).get(Number(req.params.msgId), Number(req.params.id));
        if (!msg) return res.status(404).json({ error: 'Медиа не найдено' });

        const bot = require('../services/bot');
        if (!bot.isRunning()) return res.status(503).json({ error: 'Бот не запущен' });
        const token = bot.getBotSettings().bot_token;
        if (!token) return res.status(503).json({ error: 'Бот не настроен' });

        const file = await bot.getApi().getFile(msg.file_id);
        const tgRes = await fetch(`https://api.telegram.org/file/bot${token}/${file.file_path}`);
        if (!tgRes.ok) return res.status(502).json({ error: 'Не удалось скачать из Telegram' });

        const isPdf = msg.media_type === 'document' && (msg.file_name || '').toLowerCase().endsWith('.pdf');
        if (isPdf) res.setHeader('Content-Type', 'application/pdf');
        else if (msg.media_type === 'document') res.setHeader('Content-Type', 'application/octet-stream');
        else res.setHeader('Content-Type', 'image/jpeg');
        if (msg.file_name) res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(msg.file_name)}`);
        res.setHeader('Cache-Control', 'private, max-age=3600');
        res.send(Buffer.from(await tgRes.arrayBuffer()));
    } catch (err) { next(err); }
});

router.post('/:id/reply', requireAuth, (req, res, next) => {
    try {
        const schema = z.object({ text: z.string().trim().min(1).max(4000) });
        const { text } = schema.parse(req.body);
        const id = Number(req.params.id);
        const ticket = require('../db').prepare('SELECT * FROM tickets WHERE id = ?').get(id);
        if (!ticket) return res.status(404).json({ error: 'Обращение не найдено' });
        if (ticket.status === 'closed') {
            return res.status(409).json({ error: 'Обращение закрыто — откройте заново или создайте новое' });
        }
        const added = ticketsService.addAdminMessage(id, text, true);
        if (!added) return res.status(409).json({ error: 'Не удалось отправить' });
        res.json({ ok: true });
    } catch (err) { next(err); }
});

router.post('/:id/close', requireAuth, (req, res, next) => {
    try {
        const id = Number(req.params.id);
        const ok = ticketsService.closeTicket(id, true);
        if (!ok) return res.status(409).json({ error: 'Обращение уже закрыто' });
        res.json({ ok: true });
    } catch (err) { next(err); }
});

module.exports = router;
