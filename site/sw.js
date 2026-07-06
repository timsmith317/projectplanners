// File: site/sw.js → ~/Projects/projectplanners/site/sw.js
// ============================================================
//  Project Planner service worker
//  - Precaches the app shell so the home-screen app opens
//    instantly and works offline (localStorage still holds data).
//  - Same-origin GETs use stale-while-revalidate: serve cache
//    immediately, refresh it in the background, so a redeploy is
//    picked up on the *next* open without any manual step.
//  - /api/ requests are never intercepted or cached.
//
//  Bump CACHE_VERSION whenever site files change, so old caches
//  are cleaned up on activate.
// ============================================================

const CACHE_VERSION = 'planner-v8';

const PRECACHE = [
  '/',
  '/manifest.webmanifest',
  '/icon-192.png',
  '/icon-512.png',
  '/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => cache.addAll(PRECACHE)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // Never intercept the sync API.
  if (url.pathname.startsWith('/api/')) return;

  // Navigations map to the single app shell.
  const cacheKey = req.mode === 'navigate' ? '/' : req;

  event.respondWith(
    caches.open(CACHE_VERSION).then(async (cache) => {
      const network = fetch(req)
        .then((res) => {
          // Cache good same-origin responses and opaque font responses.
          if (res && (res.ok || res.type === 'opaque')) {
            cache.put(cacheKey, res.clone());
          }
          return res;
        })
        .catch(() => undefined);

      if (req.mode === 'navigate') {
        // NETWORK-FIRST for the page itself: online loads always get the
        // latest deploy (no one-version-behind cache lag); the cached shell
        // is the offline fallback only.
        const res = await network;
        if (res) return res;
        const cached = await cache.match(cacheKey);
        return cached || new Response('Offline', { status: 503 });
      }

      // Everything else (icons, fonts): stale-while-revalidate for speed.
      const cached = await cache.match(cacheKey);
      return cached || network.then((res) => res || new Response('Offline', { status: 503 }));
    })
  );
});
