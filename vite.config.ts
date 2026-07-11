import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      // lets the browser fetch Google Calendar "secret address" ICS feeds
      // (calendar.google.com sends no CORS headers)
      '/gcal-proxy': {
        target: 'https://calendar.google.com',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/gcal-proxy/, ''),
      },
    },
  },
  build: {
    outDir: 'dist',
  },
});
