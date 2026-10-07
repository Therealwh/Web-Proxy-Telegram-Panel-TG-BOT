// Акцентные цветовые схемы панели (идентификаторы должны совпадать
// с data-accent блоками в styles/index.css; имена — в i18n settings.accent_*)
export const ACCENTS = [
    { id: 'blue', swatch: '#0088cc' },
    { id: 'emerald', swatch: '#10b981' },
    { id: 'violet', swatch: '#8b5cf6' },
    { id: 'amber', swatch: '#f59e0b' },
    { id: 'rose', swatch: '#f43f5e' },
    { id: 'cyan', swatch: '#06b6d4' },
];

export const DEFAULT_ACCENT = 'blue';

export function isAccent(id) {
    return ACCENTS.some((a) => a.id === id);
}
