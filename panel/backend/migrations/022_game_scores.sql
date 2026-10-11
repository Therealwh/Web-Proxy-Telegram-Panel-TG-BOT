-- Таблица рекордов для игры на сайте-заглушке.
--
-- Сайт-заглушка отдаётся движком как статика, поэтому рекорды хранит
-- панель. Таблица намеренно НЕ хранит IP: он нужен только для
-- ограничения частоты отправки и не записывается. Иначе ради простой
-- игры пришлось бы собирать данные о посетителях без нужды.
--
-- Держим не всё подряд, а только лучшие результаты — таблица не должна
-- расти бесконечно от спама.

CREATE TABLE IF NOT EXISTS game_scores (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nickname TEXT NOT NULL,
    score INTEGER NOT NULL,
    level INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Чтение лидерборда всегда идёт по убыванию очков.
CREATE INDEX IF NOT EXISTS idx_game_scores_score ON game_scores(score DESC);