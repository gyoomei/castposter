import { defineConfig } from 'vite';

export default defineConfig({
  base: '/',
  plugins: [],
  root: '.',
  publicDir: 'public',
  server: {
    port: 3000,
    host: true,
    proxy: {
      '/api/share-card': 'http://127.0.0.1:8787',
      '/api/share-card.png': 'http://127.0.0.1:8787',
      '/api/warpcast': 'http://127.0.0.1:8787',
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
});
