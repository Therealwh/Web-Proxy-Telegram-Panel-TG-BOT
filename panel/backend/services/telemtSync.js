/**
 * @fileoverview Очередь синхронизации Telemt (C5/M7): при сбое patchUser
 * во время продления/выдачи доступа — патч попадает в очередь и ретраится
 * из scheduler каждые 10 минут (до 20 попыток), затем алерт админу.
 * @module services/telemtSync
 */

const db = require('../db');
const telemt = require('./telemtApi');
const notifier = require('./notifier');
const { getAll } = require('../routes/settings');
const logger = require('../utils/logger');

const MAX_ATTEMPTS = 20;

/**
 * Ставит патч клиента в очередь синхронизации.
 * @param {number} clientId - id клиента в локальной БД
 * @param {object} patch - тело patchUser для Telemt
 */
function enqueue(clientId, patch) {
    db.prepare('INSERT INTO telemt_sync_queue (client_id, patch_json) VALUES (?, ?)')
        .run(clientId, JSON.stringify(patch));
    logger.info('Telemt sync: патч поставлен в очередь', { clientId });
}

/**
 * Обрабатывает очередь: ретраит patchUser; успех — удаляет запись,
 * превышение попыток — удаляет + алерт админу.
 */
async function processQueue() {
    const rows = db.prepare(
        'SELECT * FROM telemt_sync_queue WHERE attempts < ? ORDER BY id LIMIT 50'
    ).all(MAX_ATTEMPTS);
    if (rows.length === 0) return;

    for (const row of rows) {
        const client = db.prepare('SELECT username FROM clients WHERE id = ?').get(row.client_id);
        const patch = JSON.parse(row.patch_json);
        try {
            await telemt.patchUser(client?.username, patch);
            db.prepare('DELETE FROM telemt_sync_queue WHERE id = ?').run(row.id);
            logger.info('Telemt sync: патч применён после ретрая', { clientId: row.client_id, attempts: row.attempts + 1 });
        } catch (err) {
            const attempts = row.attempts + 1;
            db.prepare(
                "UPDATE telemt_sync_queue SET attempts = ?, last_error = ?, updated_at = datetime('now') WHERE id = ?"
            ).run(attempts, err.message, row.id);
            if (attempts >= MAX_ATTEMPTS) {
                db.prepare('DELETE FROM telemt_sync_queue WHERE id = ?').run(row.id);
                logger.error('Telemt sync: исчерпаны попытки — патч НЕ применён', {
                    clientId: row.client_id, attempts, error: err.message,
                });
                // Алерт админу: ручное вмешательство
                try {
                    const settings = getAll();
                    await notifier.notifyAdmin(settings,
                        `🚨 <b>Telemt sync не удался</b>\nКлиент #${row.client_id} (${client?.username || '?'}): ${err.message}\nПроверьте срок доступа вручную.`
                    );
                } catch { /* уведомления не настроены */ }
            } else {
                logger.warn('Telemt sync: ретрай позже', { clientId: row.client_id, attempts, error: err.message });
            }
        }
    }
}

module.exports = { enqueue, processQueue, MAX_ATTEMPTS };
