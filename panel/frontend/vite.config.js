import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// base: './' — относительные пути, чтобы панель работала
// под секретным префиксом /<ADMIN_PATH>/ за Nginx
export default defineConfig({
    plugins: [react()],
    base: './',
    build: {
        outDir: 'dist',
        sourcemap: false,
    },
    server: {
        port: 5173,
        proxy: {
            '/api': 'http://127.0.0.1:3000',
            '/ws': { target: 'ws://127.0.0.1:3000', ws: true },
        },
    },
});
