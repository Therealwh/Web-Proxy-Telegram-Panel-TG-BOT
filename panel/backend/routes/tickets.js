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
