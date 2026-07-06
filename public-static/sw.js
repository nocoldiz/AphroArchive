/* AphroArchive service worker — installable PWA shell + offline startup.
 *
 * Strategy:
 *   - Navigations (HTML): network-first, fall back to the cached app shell so
 *     the SPA still boots offline.
 *   - Vite hashed assets (/assets/*): cache-first + immutable, they never change.
 *   - Other shell statics (css/icons/manifest): stale-while-revalidate.
 *   - API / media / streaming: never intercepted — those are dynamic and large.
 *
 * Bump VERSION to force a full cache refresh on the next visit.
 */
const VERSION = 'v1';
const SHELL_CACHE = `aphro-shell-${VERSION}`;
const ASSET_CACHE = `aphro-assets-${VERSION}`;

// Best-effort precache. Any item that 404s (e.g. a css file not present in a
// given build) is skipped rather than failing the whole install.
const SHELL = [
  '/',
  '/index.html',
  '/manifest.json',
  '/icon.svg',
  '/style.css',
  '/themes.css',
  '/fonts.css',
];

// Same-origin request prefixes the worker must leave untouched.
const BYPASS = /^\/(api|stream|audio|books|photos|pages|cache|thumbs|hls)(\/|$)/;

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL_CACHE);
    await Promise.all(SHELL.map(async (url) => {
      try {
        const res = await fetch(new Request(url, { cache: 'reload' }));
        if (res.ok) await cache.put(url, res.clone());
      } catch { /* offline or missing — fine, runtime caching will fill in */ }
    }));
    self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys.filter((k) => k !== SHELL_CACHE && k !== ASSET_CACHE)
          .map((k) => caches.delete(k))
    );
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data === 'skipWaiting') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (BYPASS.test(url.pathname)) return;

  // App navigations — network-first, keep a fresh copy of the shell.
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const net = await fetch(req);
        const cache = await caches.open(SHELL_CACHE);
        cache.put('/index.html', net.clone());
        return net;
      } catch {
        const cache = await caches.open(SHELL_CACHE);
        return (await cache.match('/index.html')) || (await cache.match('/')) || Response.error();
      }
    })());
    return;
  }

  // Content-hashed, immutable build assets — cache-first.
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith((async () => {
      const cache = await caches.open(ASSET_CACHE);
      const hit = await cache.match(req);
      if (hit) return hit;
      const net = await fetch(req);
      if (net.ok) cache.put(req, net.clone());
      return net;
    })());
    return;
  }

  // Everything else in scope (css, icons, manifest) — stale-while-revalidate.
  event.respondWith((async () => {
    const cache = await caches.open(SHELL_CACHE);
    const hit = await cache.match(req);
    const network = fetch(req).then((net) => {
      if (net.ok) cache.put(req, net.clone());
      return net;
    }).catch(() => hit);
    return hit || network;
  })());
});
