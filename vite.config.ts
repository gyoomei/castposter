import { defineConfig } from 'vite';

export default defineConfig({
  base: '/',
  plugins: [],
  root: '.',
  publicDir: 'public',
  server: {
    port: 3000,
    host: true
  },
  build: {
    outDir: 'dist',
    sourcemap: true
  }
});
