/**
 * sw.js — Service Worker for TV+ IPTV
 * Caches app shell for instant startup and offline capability.
 * Does NOT cache M3U playlist content (handled by IndexedDB).
 *
 * Strategy:
 *   App shell (index.html, worker files) → Cache First
 *   M3U/playlist URLs → Network Only (fresh data always preferred)
 *   Logo images → Stale-While-Revalidate (show cached, update in bg)
 */

const CACHE_NAME    = 'tvplus-shell-v1';
const WORKER_CACHE  = 'tvplus-workers-v1';
const LOGO_CACHE    = 'tvplus-logos-v1';

const SHELL_FILES = [
  '/',
  '/index.html',
  '/m3u-worker.js',
];

// ── Install: cache shell ──────────────────────────────────────
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(SHELL_FILES))
      .then(() => self.skipWaiting())
      .catch(() => self.skipWaiting())
  );
});

// ── Activate: clean old caches ────────────────────────────────
self.addEventListener('activate', (event) => {
  const KEEP = [CACHE_NAME, WORKER_CACHE, LOGO_CACHE];
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => !KEEP.includes(k)).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

// ── Fetch: routing strategy ───────────────────────────────────
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET
  if (request.method !== 'GET') return;

  // M3U/playlist files — network only (never cache raw M3U)
  if (url.pathname.endsWith('.m3u') || url.hostname.includes('iptv-org')) {
    return; // let browser handle normally
  }

  // Tizen WebAPI — skip entirely
  if (url.protocol === '$' || url.hostname === '') return;

  // Channel logo images — stale-while-revalidate
  if (isLogoRequest(url)) {
    event.respondWith(staleWhileRevalidate(request, LOGO_CACHE));
    return;
  }

  // App shell — cache first
  if (isShellRequest(url)) {
    event.respondWith(cacheFirst(request, CACHE_NAME));
    return;
  }

  // Everything else — network first with cache fallback
  event.respondWith(networkFirst(request, CACHE_NAME));
});

function isLogoRequest(url) {
  return /\.(png|jpg|jpeg|svg|webp|ico)$/i.test(url.pathname);
}

function isShellRequest(url) {
  return url.pathname === '/' ||
         url.pathname === '/index.html' ||
         url.pathname === '/m3u-worker.js';
}

async function cacheFirst(request, cacheName) {
  const cached = await caches.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(cacheName);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    return new Response('Offline', { status: 503 });
  }
}

async function networkFirst(request, cacheName) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(cacheName);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await caches.match(request);
    return cached || new Response('Offline', { status: 503 });
  }
}

async function staleWhileRevalidate(request, cacheName) {
  const cache  = await caches.open(cacheName);
  const cached = await cache.match(request);
  const fetchPromise = fetch(request).then(response => {
    if (response.ok) cache.put(request, response.clone());
    return response;
  }).catch(() => null);
  return cached || await fetchPromise || new Response('', { status: 404 });
}

// Message handler — allow main thread to skip waiting
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});
