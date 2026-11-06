/**
 * @fileoverview Калькулятор и верификатор лимитов движка Telemt.
 *
 * Формулы ограничений взяты из валидатора Telemt
 * (src/config/load/validate_web.rs + validate_web/memory.rs):
 *   1. control_items_per_session = 16 + max_streams_per_session × 3
 *   2. control_items_global = control_items_per_session × max_sessions_global
 *      → должен быть СТРОГО МЕНЬШЕ pending_items_global
 *   3. required_control_bytes_per_session = control_items_per_session × 268
 *      → ≤ control_bytes_per_session (262144 по умолчанию)
 *   4. required_control_bytes_global = control_items_global × 268
 *      → ≤ control_bytes_global
 *   5. websocket_bytes_global ≤ (pending_bytes_global − control_bytes_global)
 *      − (max_body_bytes + max_frames_per_body × 256 + carrier_batch_bytes)
 *   6. Суммарные резервы памяти (pending + lane + headers + статика + debug)
 *      ≤ memory_envelope_bytes, сам envelope ≤ 4 GiB
 * Панель считает рекомендации этими формулами и проверяет их до PATCH —
 * Telemt никогда не получает конфиг, который отвергнет.
 * @module utils/engineTuning
 */

const FRAME_COST = 8 + 4 + 256;            // 268: header + tag + queue item
const ITEMS_PER_SESSION = 16 + 128 * 3;    // 400: streams_per_session = 128
const LANE_STATE_BYTES = 1024;
const QUEUE_PROGRESS_BYTES = 3 * 1024 * 1024; // body 1MiB + frames 1MiB + batch 1MiB

/** Дефолтные поля web.limits, которые не тюнимся — подставляются как есть. */
const FIXED_FIELDS = {
    max_streams_per_session: 128,
    control_bytes_per_session: 262144,
    pending_items_per_session: 16384,
    pending_bytes_per_session: 33554432,
    pending_bytes_per_lane: 8388608,
    pending_items_per_lane: 1024,
    max_header_bytes: 8192,
    max_body_bytes: 1048576,
    max_frame_payload_bytes: 524288,
    carrier_batch_bytes: 1048576,
    max_body_bytes_global: 33554432,
    max_static_bytes: 16777216,
    max_static_file_bytes: 8388608,
    max_static_files: 4096,
    max_vhosts: 8,
    max_carrier_learning_entries: 4096,
    max_bootstraps_per_ip: 64,
    max_sessions_per_ip: 16,
    http_connection_capacity_action: 'wait',
};

/** Человекочитаемые названия лимитов для UI. */
const LIMIT_LABELS = {
    max_profiles: 'Профили (клиенты с Web)',
    max_sessions_global: 'Сессии (всего)',
    max_sessions_per_ip: 'Сессии с одного IP',
    max_http_connections: 'HTTP-подключения',
    max_streams_global: 'Логические потоки',
    max_streams_per_session: 'Потоков на сессию',
    max_bootstraps_global: 'Bootstrap-запросы',
    max_bootstraps_per_ip: 'Bootstrap с одного IP',
    max_http_overload_connections: 'Перегрузочные подключения',
    control_bytes_global: 'Резерв control-байт (глобально)',
    control_bytes_per_session: 'Резерв control-байт (сессия)',
    pending_items_global: 'Очередь: элементов (глобально)',
    pending_items_per_session: 'Очередь: элементов (сессия)',
    pending_items_per_lane: 'Очередь: элементов (lane)',
    pending_bytes_global: 'Очередь: байт (глобально)',
    pending_bytes_per_session: 'Очередь: байт (сессия)',
    pending_bytes_per_lane: 'Очередь: байт (lane)',
    websocket_bytes_global: 'WebSocket-бюджет',
    max_tombstones_per_session: 'Tombstones на сессию',
    max_header_bytes: 'Макс. размер заголовков',
    max_body_bytes: 'Макс. размер тела запроса',
    max_frame_payload_bytes: 'Макс. размер кадра',
    carrier_batch_bytes: 'Батч carrier-запросов',
    max_body_bytes_global: 'Тела запросов (глобально)',
    max_static_bytes: 'Статика (глобально)',
    max_static_file_bytes: 'Макс. размер файла статики',
    max_static_files: 'Файлов статики',
    max_vhosts: 'Виртуальные хосты',
    max_carrier_learning_entries: 'Записи carrier learning',
    http_connection_capacity_action: 'Действие при перегрузке',
    max_connections: 'Клиентские соединения (ME+HTTP)',
};

/**
 * Рассчитывает рекомендованные лимиты под объём RAM сервера.
 * Перебирает целевые значения сессий от больших к меньшим и возвращает
 * первый набор, который проходит ВСЕ проверки валидатора Telemt
 * (контрольные резервы, memory fit, websocket progress).
 * @param {number} ramBytes - общий объём RAM сервера
 * @returns {{ limits: object, max_connections: number, envelope: number, sessions: number }}
 */
function recommendLimits(ramBytes) {
    // Движку отдаём ~55% RAM (остальное — systemd, panel, nginx, caddy),
    // но не больше 4 ГБ — потолок самого Telemt.
    const envelope = Math.min(Math.floor(ramBytes * 0.55), 4 * 1024 ** 3);
    const tiers = [16384, 8192, 4096, 2048, 1024, 512, 256];

    for (const sessions of tiers) {
        const httpConnections = sessions * 2;
        const streamsGlobal = sessions * 8;
        const controlBytesGlobal = Math.ceil(itemsPerSessionGlobal(sessions) * FRAME_COST * 1.15);
        const pendingItemsGlobal = Math.ceil(itemsPerSessionGlobal(sessions) * 1.3);
        const pendingBytesGlobal = controlBytesGlobal + 96 * 1024 ** 2 + QUEUE_PROGRESS_BYTES + 16 * 1024 ** 2;
        const websocketBytesGlobal = pendingBytesGlobal - controlBytesGlobal - QUEUE_PROGRESS_BYTES;
        const laneState = (streamsPerSession + 129) * sessions * LANE_STATE_BYTES;
        const httpHeader = httpConnections * 8192;
        const overload = 256 * 4096;
        const capabilityIndex = 1024 * 64;
        const carrierLearning = 4096 * 512;
        const reserved = pendingBytesGlobal
            + 33554432 + 16777216 + 16777216 + 16 * 1024 ** 2 + 2 * 1024 ** 2
            + capabilityIndex + carrierLearning + laneState + httpHeader + overload;

        if (!verifyLimits({
            max_profiles: 1024,
            max_sessions_global: sessions,
            max_sessions_per_ip: 16,
            max_http_connections: httpConnections,
            max_streams_per_session: 128,
            max_streams_global: streamsGlobal,
            max_bootstraps_global: Math.max(512, Math.round(sessions / 4)),
            max_bootstraps_per_ip: 64,
            max_http_overload_connections: 256,
            control_bytes_global: controlBytesGlobal,
            control_bytes_per_session: 262144,
            pending_items_global: pendingItemsGlobal,
            pending_items_per_session: 16384,
            pending_items_per_lane: 1024,
            pending_bytes_global: pendingBytesGlobal,
            pending_bytes_per_session: 33554432,
            pending_bytes_per_lane: 8388608,
            websocket_bytes_global: websocketBytesGlobal,
            max_tombstones_per_session: 128,
            max_header_bytes: 8192,
            max_body_bytes: 1048576,
            max_frame_payload_bytes: 524288,
            carrier_batch_bytes: 1048576,
            max_body_bytes_global: 33554432,
            max_static_bytes: 16777216,
            max_static_file_bytes: 8388608,
            max_static_files: 4096,
            max_vhosts: 8,
            max_carrier_learning_entries: 4096,
            http_connection_capacity_action: 'wait',
            memory_envelope_bytes: envelope,
        })) continue;

        return {
            limits: {
                max_profiles: 1024,
                max_sessions_global: sessions,
                max_sessions_per_ip: 16,
                max_http_connections: httpConnections,
                max_streams_per_session: 128,
                max_streams_global: streamsGlobal,
                max_bootstraps_global: Math.max(512, Math.round(sessions / 4)),
                max_bootstraps_per_ip: 64,
                max_http_overload_connections: 256,
                control_bytes_global: controlBytesGlobal,
                control_bytes_per_session: 262144,
                pending_items_global: pendingItemsGlobal,
                pending_items_per_session: 16384,
                pending_items_per_lane: 1024,
                pending_bytes_global: pendingBytesGlobal,
                pending_bytes_per_session: 33554432,
                pending_bytes_per_lane: 8388608,
                websocket_bytes_global: websocketBytesGlobal,
                max_tombstones_per_session: 128,
                max_header_bytes: 8192,
                max_body_bytes: 1048576,
                max_frame_payload_bytes: 524288,
                carrier_batch_bytes: 1048576,
                max_body_bytes_global: 33554432,
                max_static_bytes: 16777216,
                max_static_file_bytes: 8388608,
                max_static_files: 4096,
                max_vhosts: 8,
                max_carrier_learning_entries: 4096,
                http_connection_capacity_action: 'wait',
            },
            max_connections: 0,
            envelope,
            sessions,
        };
    }

    // Совсем маленький сервер: минимальный набор (теоретически недостижимо)
    const fallback = {
        max_profiles: 256,
        max_sessions_global: 256,
        max_sessions_per_ip: 16,
        max_http_connections: 512,
        max_streams_per_session: 128,
        max_streams_global: 2048,
        max_bootstraps_global: 256,
        max_bootstraps_per_ip: 64,
        max_http_overload_connections: 64,
        control_bytes_global: 33554432,
        control_bytes_per_session: 262144,
        pending_items_global: 131072,
        pending_items_per_session: 16384,
        pending_items_per_lane: 1024,
        pending_bytes_global: 167772160,
        pending_bytes_per_session: 33554432,
        pending_bytes_per_lane: 8388608,
        websocket_bytes_global: 33554432,
        max_tombstones_per_session: 128,
        max_header_bytes: 8192,
        max_body_bytes: 1048576,
        max_frame_payload_bytes: 524288,
        carrier_batch_bytes: 1048576,
        max_body_bytes_global: 33554432,
        max_static_bytes: 16777216,
        max_static_file_bytes: 8388608,
        max_static_files: 4096,
        max_vhosts: 8,
        max_carrier_learning_entries: 4096,
        http_connection_capacity_action: 'wait',
        memory_envelope_bytes: Math.floor(ramBytes * 0.55),
    };
    return { limits: fallback, max_connections: 0, envelope: fallback.memory_envelope_bytes, sessions: fallback.max_sessions_global };
}

function itemsPerSessionGlobal(sessions) {
    return ITEMS_PER_SESSION * sessions;
}

/**
 * Верифицирует набор лимитов по формулам валидатора Telemt.
 * @param {object} l - полный набор web.limits (+ memory_envelope_bytes)
 * @returns {string|null} текст ошибки или null, если набор валиден
 */
function verifyLimits(l) {
    const itemsPerSession = 16 + l.max_streams_per_session * 3;
    const itemsGlobal = itemsPerSession * l.max_sessions_global;
    const requiredPerSession = itemsPerSession * FRAME_COST;
    const requiredGlobal = itemsGlobal * FRAME_COST;

    if (itemsPerSession >= l.pending_items_per_session) {
        return `control items на сессию (${itemsPerSession}) должен быть меньше pending_items_per_session (${l.pending_items_per_session})`;
    }
    if (itemsGlobal >= l.pending_items_global) {
        return `control items глобально (${itemsGlobal}) должен быть меньше pending_items_global (${l.pending_items_global}) — поднимите pending_items_global`;
    }
    if (requiredPerSession > l.control_bytes_per_session) {
        return `нужен control_bytes_per_session ≥ ${requiredPerSession}, задано ${l.control_bytes_per_session}`;
    }
    if (requiredGlobal > l.control_bytes_global) {
        return `нужен control_bytes_global ≥ ${requiredGlobal}, задано ${l.control_bytes_global}`;
    }

    const queueProgress = l.max_body_bytes + l.max_frames_per_body * 256 + l.carrier_batch_bytes;
    const dataBytes = l.pending_bytes_global - l.control_bytes_global;
    if (l.websocket_bytes_global > dataBytes - queueProgress) {
        return `websocket_bytes_global (${l.websocket_bytes_global}) должен помещаться в ${dataBytes - queueProgress} (pending − control − queue progress)`;
    }

    const laneState = (l.max_streams_per_session + l.max_tombstones_per_session + 1) * l.max_sessions_global * LANE_STATE_BYTES;
    const httpHeader = l.max_http_connections * l.max_header_bytes;
    const overload = l.max_http_overload_connections * 4096;
    const capabilityIndex = l.max_profiles * 64;
    const carrierLearning = l.max_carrier_learning_entries * 512;
    const debugRing = l.debug_records_capacity * 8 * 2;
    const reserved = l.pending_bytes_global
        + l.max_body_bytes_global + l.max_static_bytes
        + debugRing + (2 * 8 * 1024 * 1024) + (8 * 1024 * 1024)
        + carrierLearning + capabilityIndex + laneState + httpHeader + overload;
    if (reserved > l.memory_envelope_bytes) {
        return `резервы памяти (${(reserved / 1048576).toFixed(0)} МиБ) превышают memory_envelope_bytes (${(l.memory_envelope_bytes / 1048576).toFixed(0)} МиБ) — уменьшите сессии/потоки или поднимите envelope`;
    }
    if (l.memory_envelope_bytes > 4 * 1024 ** 3) {
        return 'memory_envelope_bytes не может превышать 4 ГиБ';
    }
    return null;
}

module.exports = { recommendLimits, verifyLimits, LIMIT_LABELS, FIXED_FIELDS, ITEMS_PER_SESSION, FRAME_COST };
