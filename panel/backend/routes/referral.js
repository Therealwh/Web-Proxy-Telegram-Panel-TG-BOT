/**
 * @fileoverview Админское API реферальной программы: сводная статистика,
 * топ рефереров, последние начисления.
 * @module routes/referral
 */

const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { adminStats } = require('../utils/referral');
const { getAll } = require('./settings');

const router = express.Router();

router.get('/stats', requireAuth, (req, res) => {
    const s = getAll();
    res.json({
        ...adminStats(),
        settings: { mode: s.referral_mode || 'percent', percent: Number(s.referral_percent ?? 10) },
    });
});

module.exports = router;
