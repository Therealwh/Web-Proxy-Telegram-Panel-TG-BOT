/**
 * @fileoverview Рекламные баннеры в админ-панели (для владельцев установок).
 *
 * Модель монетизации: владелец проекта продаёт рекламные места в панели
 * (дашборд, страница обновлений) рекламодателям из ниши (хостинги, услуги).
 * Кампании описываются в центральном ads.json (public repo), все установки
 * подтягивают его раз в сутки и показывают активные кампании.
 *
 * Приватность: никакой телеметрии наружу — показы/клики считаются
 * локально в БД установки, их видит только админ этой установки.
 *
 * Если активных кампаний нет — показывается встроенная заглушка
 * «Разместить рекламу» со ссылкой на Telegram владельца.
 * @module routes/ads
 */

const express = require('express');
const fs = require('fs');
const db = require('../db');
const logger = require('../utils/logger');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

// Центральный источник кампаний (public repo, CDN GitHub — без лимитов API)
const ADS_SOURCE = 'https://raw.githubusercontent.com/Therealwh/Web-Proxy-Telegram-Panel-TG-BOT/main/ads.json';
const CACHE_KEY = 'ads_cache';
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;   // обновление раз в 6 часов
const SUPPORT_URL = 'https://t.me/tggatetopsupport';

/** Кэш кампаний в БД (settings.ads_cache). */
function getCache() {
    try {
        const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(CACHE_KEY);
        if (!row) return null;
        return JSON.parse(row.value);
    } catch {
        return null;
    }
}

function saveCache(cache) {
    try {
        db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
            .run(CACHE_KEY, JSON.stringify(cache));
    } catch (e) {
        logger.warn('Реклама: не удалось сохранить кэш', { error: e.message });
    }
}

/** Свежий ли кэш (для проверки без сети). */
function cacheFresh(cache) {
    return cache && cache.fetchedAt &&
        (Date.now() - new Date(cache.fetchedAt).getTime()) < CACHE_TTL_MS;
}

/** Фильтрует кампании: активный период + нужный слот. Возвращает взвешенно перемешанные. */
function pickForSlot(cache, slot) {
    const now = new Date().toISOString().slice(0, 10);
    const active = (cache?.ads || []).filter((a) =>
        a.enabled !== false &&
        (!a.from || a.from <= now) &&
        (!a.to || a.to >= now) &&
        Array.isArray(a.slots) && a.slots.includes(slot)
    );
    // Взвешенная ротация: разворачиваем weight-раз каждый элемент, перемешиваем,
    // берём первого — у тяжёлых баннеров шанс пропорционально весу.
    const pool = [];
    for (const a of active) {
        const w = Math.max(1, Math.min(10, Number(a.weight) || 1));
        for (let i = 0; i < w; i++) pool.push(a);
    }
    if (pool.length === 0) return null;
    return pool[Math.floor(Math.random() * pool.length)];
}

/** Запрашивает кампании из центрального ads.json (с ретраем). */
async function fetchAds() {
    let lastErr = null;
    for (let i = 0; i < 2; i++) {
        try {
            const res = await fetch(ADS_SOURCE + '?t=' + Date.now(), {
                signal: AbortSignal.timeout(15000),
                headers: { 'Cache-Control': 'no-cache' },
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = JSON.parse(await res.text());
            if (!Array.isArray(data.ads)) throw new Error('bad format');
            return data;
        } catch (e) {
            lastErr = e;
            await new Promise((r) => setTimeout(r, 1000));
        }
    }
    throw lastErr || new Error('fetch failed');
}

/**
 * GET /api/ads/panel — активная кампания для слота панели + статистика.
 * Возвращает и заглушку, если активных кампаний нет (панель рисует сама).
 */
router.get('/panel', requireAuth, async (req, res, next) => {
    try {
        let cache = getCache();
        if (!cacheFresh(cache)) {
            try {
                const fetched = await fetchAds();
                cache = { fetchedAt: new Date().toISOString(), ads: fetched.ads };
                saveCache(cache);
            } catch (e) {
                logger.warn('Реклама: не удалось обновить кампании', { error: e.message });
                if (!cache) {
                    return res.json({ ok: true, placeholder: true, support: SUPPORT_URL, ad: null });
                }
            }
        }

        const ad = pickForSlot(cache, 'panel');
        if (!ad) {
            return res.json({ ok: true, placeholder: true, support: SUPPORT_URL, ad: null });
        }

        // Показ: инкремент в кэше статистики
        const stats = cache.stats || {};
        stats[ad.id] = { ...(stats[ad.id] || { impressions: 0, clicks: 0 }) };
        stats[ad.id].impressions += 1;
        cache.stats = stats;
        saveCache(cache);

        res.json({ ok: true, placeholder: false, ad });
    } catch (err) {
        next(err);
    }
});

/**
 * GET /api/ads/go/:id — редиректор клика: инкремент + переход на URL кампании.
 * (requireAuth: клики считает только админ этой установки)
 */
router.get('/go/:id', requireAuth, (req, res) => {
    try {
        const cache = getCache();
        const ad = (cache?.ads || []).find((a) => a.id === req.params.id);
        if (!ad || !ad.url) return res.status(404).json({ error: 'Кампания не найдена' });
        const stats = cache?.stats || {};
        stats[ad.id] = { ...(stats[ad.id] || { impressions: 0, clicks: 0 }) };
        stats[ad.id].clicks += 1;
        saveCache({ ...cache, stats });
        res.redirect(302, ad.url);
    } catch (err) {
        next(err);
    }
});

/**
 * GET /api/ads/stats — статистика кампаний этой установки (для карточки).
 */
router.get('/stats', requireAuth, (req, res) => {
    const cache = getCache();
    const stats = cache?.stats || {};
    const rows = (cache?.ads || []).map((a) => ({
        id: a.id,
        title: a.title,
        impressions: stats[a.id]?.impressions || 0,
        clicks: stats[a.id]?.clicks || 0,
    })).filter((r) => r.impressions > 0 || r.clicks > 0);
    res.json({ ok: true, stats: rows });
});

module.exports = router;
