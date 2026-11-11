-- Миграция 029: промокоды v2 — дни/скидка, аудитория, защита «1 человек — 1 раз»

-- Тип промокода: 'days' — подарок дней, 'percent' — скидка на покупку
ALTER TABLE promo_codes ADD COLUMN kind TEXT NOT NULL DEFAULT 'percent';
-- Кому: 'new' — только новым (без активного прокси), 'all' — всем
ALTER TABLE promo_codes ADD COLUMN audience TEXT NOT NULL DEFAULT 'all';
-- Сколько дней дарит (для kind='days')
ALTER TABLE promo_codes ADD COLUMN days INTEGER;
-- Защита: один человек может применить промокод только один раз
ALTER TABLE promo_codes ADD COLUMN one_per_user INTEGER NOT NULL DEFAULT 1;

-- Журнал применений: кто и когда применил (защита per-user)
CREATE TABLE IF NOT EXISTS promo_uses (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    promo_code   TEXT NOT NULL REFERENCES promo_codes(code) ON DELETE CASCADE,
    telegram_id  INTEGER NOT NULL,
    used_at      TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(promo_code, telegram_id)
);
CREATE INDEX IF NOT EXISTS idx_promo_uses_tg ON promo_uses(telegram_id);

-- Активированный промокод-скидка (ждёт следующей покупки пользователя)
ALTER TABLE bot_users ADD COLUMN pending_promo TEXT;

-- Промокод, под которым создан платёж (скидка учтена в amount)
ALTER TABLE payments ADD COLUMN promo_code TEXT;
