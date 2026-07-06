import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import { resolve } from 'node:path';

// https://vitejs.dev/config/
export default defineConfig(() => ({
  plugins: [preact()],
  root: 'public',
  // PWA static assets (manifest, service worker, icons) live in <repo>/public-static
  // and are copied verbatim (unhashed, stable URLs) to the build output root —
  // exactly what a service worker and web manifest need. Vite also serves this
  // directory at / during dev.
  publicDir: '../public-static',
  // The Node server (server.js) serves nested SPA routes like /video/<id>,
  // where relative paths resolve incorrectly — use an absolute base.
  base: '/',
  build: {
    outDir: '../dist/public',
    emptyOutDir: true,
    rollupOptions: {
      output: {
        // Split the framework out of the app chunk: the vendor chunk is
        // content-hashed and effectively never changes, so after the first
        // visit it's served from the immutable browser cache while only the
        // (much smaller) app chunk re-downloads on updates.
        manualChunks(id: string) {
          if (id.includes('node_modules')) {
            if (id.includes('preact')) return 'vendor-preact';
            return 'vendor';
          }
        },
      },
    },
  },
  server: {
    port: 5173,
    // Home-dashboard widgets live in <repo>/plugins/*/widget.tsx, one level
    // above the Vite root (public/); allow the dev server to read them.
    fs: { allow: ['..'] },
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
}));
