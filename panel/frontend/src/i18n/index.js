// Локализация панели: поиск строки по пути с фолбэком на русский
import ru from './ru';
import en from './en';
import { useLangStore } from '../store';

const dicts = { ru, en };

function lookup(lang, path) {
    const parts = String(path).split('.');
    let cur = dicts[lang];
    for (const p of parts) {
        if (cur == null || typeof cur !== 'object') return undefined;
        cur = cur[p];
    }
    return typeof cur === 'string' ? cur : undefined;
}

function fmt(str, vars) {
    if (!vars) return str;
    return String(str).replace(/\{(\w+)\}/g, (_, k) => (vars[k] ?? `{${k}}`));
}

/** Перевод по ключу с фолбэком на русский; vars — подстановки {name} */
export function tr(lang, path, vars) {
    const s = lookup(lang, path) ?? lookup('ru', path) ?? path;
    return fmt(s, vars);
}

/** Хук перевода: подписывает компонент на смену языка */
export function useT() {
    const lang = useLangStore((s) => s.lang);
    return (path, vars) => tr(lang, path, vars);
}

export { ru, en };
