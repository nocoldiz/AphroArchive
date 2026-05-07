import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import { resolve } from 'node:path';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [preact()],
  root: 'public', // Setting root to public while we migrate
  base: './',
  build: {
    outDir: '../dist/public',
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3000',
      '/stream': 'http://localhost:3000',
      '/audio': 'http://localhost:3000',
      '/books': 'http://localhost:3000',
      '/photos': 'http://localhost:3000',
      '/pages': 'http://localhost:3000',
      '/cache': 'http://localhost:3000',
    }
  }
});
