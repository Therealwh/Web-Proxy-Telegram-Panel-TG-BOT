/** @type {import('tailwindcss').Config} */
export default {
    content: ['./index.html', './src/**/*.{js,jsx}'],
    darkMode: 'class',
    theme: {
        extend: {
            colors: {
                // Фирменный акцент — Telegram Blue
                primary: {
                    DEFAULT: '#0088cc',
                    50: '#e6f4fa', 100: '#cce9f5', 200: '#99d3eb',
                    300: '#66bde1', 400: '#33a7d7', 500: '#0088cc',
                    600: '#006da3', 700: '#00527a', 800: '#003652',
                    900: '#001b29',
                },
            },
            fontFamily: {
                sans: ['Inter', 'system-ui', 'sans-serif'],
                mono: ['JetBrains Mono', 'monospace'],
            },
        },
    },
    plugins: [],
};
