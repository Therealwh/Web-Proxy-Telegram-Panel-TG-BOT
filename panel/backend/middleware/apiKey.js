/**
 * @fileoverview Middleware аутентификации публичного API по ключу.
 * Заголовок: Authorization: Bearer tgk_...
 * Проверяет хэш ключа, срок действия, IP-ограничения, права.
 * @module middleware/apiKey
 */

const db = require('../db');
const { hashKey } = require('../routes/apiKeys');

const PERM_LEVEL = { read: 1, write: 2, full: 3 };

/**
 * Проверяет API-ключ.
 * @param {string} requiredPerm - минимальный уровень: read | write | full
 */
function requireApiKey(requiredPerm = 'read') {
    return (req, res, next) => {
        const header = req.headers.authorization || '';
        const key = header.startsWith('Bearer tgk_') ? header.slice(7) : null;
        if (!key) {
            return res.status(401).json({ error: 'Требуется API-ключ (Authorization: Bearer tgk_...)' });
        }

        const row = db.prepare('SELECT * FROM api_keys WHERE key_hash = ? AND enabled = 1').get(hashKey(key));
        if (!row) return res.status(401).json({ error: 'Недействительный или отключённый API-ключ' });

        if (row.expires_at && new Date(row.expires_at) < new Date()) {
            return res.status(401).json({ error: 'Срок действия API-ключа истёк' });
        }

        // Проверка IP-ограничений
        if (row.allowed_ips) {
            try {
                const ips = JSON.parse(row.allowed_ips);
                if (ips.length > 0 && !ips.includes(req.ip)) {
                    return res.status(403).json({ error: 'Запрос с этого IP запрещён для данного ключа' });
                }
            } catch { /* игнорируем битый JSON */ }
        }

        // Проверка прав
        if ((PERM_LEVEL[row.permissions] || 0) < (PERM_LEVEL[requiredPerm] || 1)) {
            return res.status(403).json({ error: `Недостаточно прав: требуется уровень «${requiredPerm}»` });
        }

        // Статистика использования
        db.prepare("UPDATE api_keys SET requests_count = requests_count + 1, last_used_at = datetime('now') WHERE id = ?")
            .run(row.id);

        req.apiKey = row;
        next();
    };
}

module.exports = { requireApiKey };
