import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: '0.0.0.0',
    port: 3000,
    allowedHosts: true,
    hmr: false,
    proxy: {
      '/api': {
        target: 'https://mukisoft-stock-ai.onrender.com',
        changeOrigin: true,
        secure: true,
      },
      '/__render_api': {
        target: 'https://mukisoft-stock-ai.onrender.com',
        changeOrigin: true,
        secure: true,
        rewrite: (path) => path.replace(/^\/__render_api/, ''),
      },
    },
  },
  preview: {
    host: '0.0.0.0',
    port: 3000,
  },
});
