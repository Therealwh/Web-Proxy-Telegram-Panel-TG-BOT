/**
 * @fileoverview Экранирование значений для CSV-экспорта.
 * Защита от CSV-инъекции (формулы Excel/Sheets) — MINOR-5.
 * @module utils/csv
 */

/**
 * Экранирует значение для CSV-ячейки: кавычки удваиваются, опасные
 * первые символы (=, +, -, @, Tab, CR) получают префикс ' — чтобы
 * Excel/Sheets не выполнили значение как формулу.
 * @param {*} value - любое значение ячейки
 * @returns {string} безопасная CSV-ячейка (без внешних кавычек — их добавляет вызывающий при необходимости)
 */
function csvCell(value) {
    let s = String(value ?? '');
    // Стандартное CSV-экранирование
    if (/[",\n\r]/.test(s)) {
        s = `"${s.replace(/"/g, '""')}"`;
    }
    // Защита от формул: первый символ-триггер → префикс '
    if (/^[=+\-@\t\r]/.test(s)) {
        s = `'${s}`;
    }
    return s;
}

/**
 * Формирует CSV-строку из массива значений (запятые между ячейками).
 * @param {Array<*>} fields - значения строки
 * @returns {string}
 */
function csvRow(fields) {
    return fields.map(csvCell).join(',');
}

module.exports = { csvCell, csvRow };
