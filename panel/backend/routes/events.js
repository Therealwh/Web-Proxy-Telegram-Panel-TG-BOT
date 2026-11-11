/**
 * @fileoverview Лента понятных событий для админа (за последние сутки).
 * @module routes/events
 */

const express = require('express');
const { requireAuth } = require('../middleware/auth');
const eventLog = require('../services/eventLog');

const router = express.Router();

router.get('/', requireAuth, (req, res) => {
    const limit = Math.min(500, Math.max(1, parseInt(String(req.query.limit || '200'), 10) || 200));
    res.json({ events: eventLog.listEvents(limit) });
});

module.exports = router;
