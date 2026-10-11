import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';

export default [
    { ignores: ['dist'] },
    {
        files: ['**/*.{js,jsx}'],
        languageOptions: {
            ecmaVersion: 'latest',
            globals: globals.browser,
            parserOptions: {
                ecmaVersion: 'latest',
                ecmaFeatures: { jsx: true },
                sourceType: 'module',
            },
        },
        plugins: {
            'react-hooks': reactHooks,
            'react-refresh': reactRefresh,
        },
        rules: {
            ...js.configs.recommended.rules,

            // Нарушение = краш или бесконечный цикл (баг с [[]] в 1.13.3).
            // Ломает сборку — чинить обязательно.
            'react-hooks/rules-of-hooks': 'error',

            // Предупреждение: на живом коде это большой рефакторинг,
            // поэтому пока warn. Число зафиксировано как baseline и должно убывать.
            'react-hooks/exhaustive-deps': 'warn',

            // store.js намеренно экспортирует сторы рядом с компонентами
            'react-refresh/only-export-components': 'warn',

            // eslint без eslint-plugin-react не видит использование
            // переменных внутри JSX — отключаем, чтобы не было ложных срабатываний
            'no-unused-vars': 'off',
        },
    },
];