/**
 * sw.js — Service Worker  v3
 *
 * P0-3 FIX: M3U / playlist URLs are NEVER cached.
 *   v3 bump → old v2 caches (which may have stale M3U data) are
 *   purged on activate. Any domain that serves playlist content is
 *   explicitly in the never-cache list.
 *
 * Cache strategies:
 *   App shell (index.html, JS, worker) → Cache-First (versioned)
 *   Playlist / M3U / CF workers        → Network-Only  ← key fix
 *   Channel logo images                → Stale-While-Revalidate
 *   Everything else                    → Network-First, cache fallback
 */

const SHELL_VER  = 'tvplus-shell-v3';   // bump removes old cached M3U data
const LOGO_VER   = 'tvplus-logos-v1';
const KEEP_CACHES = [SHELL_VER, LOGO_VER];

const SHELL_FILES = ['./', './index.html', './m3u-worker.js', './bundle.js', './bundle.css'];
const SHELL_PATHS = ['/index.html', '/m3u-worker.js', '/bundle.js', '/bundle.css'];

/* ── Never-cache: any URL matching these patterns goes Network-Only ── */
const NEVER_CACHE = [
  /\.m3u($|\?)/i,
  /iptv-org\.github\.io/,
  /raw\.githubusercontent\.com/,
  /jioplaylist\./,
  /joinus-apiworker\.workers\.dev/,
  /yupptv\./,
  /yecic62314\.workers\.dev/,
  /corsproxy\.io/,
  /allorigins\.win/,
  /cors-anywhere/,
];

const neverCache = (url) => NEVER_CACHE.some(p => p.test(url.href));
const isLogo     = (url) => /\.(png|jpe?g|svg|webp|ico)$/i.test(url.pathname) && !neverCache(url);
const isShell    = (url) => SHELL_PATHS.some(p => url.pathname.endsWith(p)) || url.pathname === '/';

/* ── Install ── */
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(SHELL_VER)
      .then(c => c.addAll(SHELL_FILES))
      .then(() => self.skipWaiting())
      .catch(() => self.skipWaiting())
  );
});

/* ── Activate: delete ALL old caches so stale M3U data is gone ── */
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => !KEEP_CACHES.includes(k)).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

/* ── Fetch ── */
self.addEventListener('fetch', e => {
  const { request } = e;
  if (request.method !== 'GET') return;

  let url;
  try { url = new URL(request.url); } catch { return; }
  if (!url.hostname || url.protocol === '$') return; // Tizen internal

  /* P0-3: playlist / M3U → pure network, touch no cache */
  if (neverCache(url)) {
    e.respondWith(fetch(request).catch(() => new Response('', { status: 503 })));
    return;
  }

  if (isShell(url)) {
    e.respondWith(cacheFirst(request, SHELL_VER));
    return;
  }

  if (isLogo(url)) {
    e.respondWith(staleWhileRevalidate(request, LOGO_VER));
    return;
  }

  e.respondWith(networkFirst(request, SHELL_VER));
});

async function cacheFirst(req, name) {
  const hit = await caches.match(req);
  if (hit) return hit;
  try {
    const res = await fetch(req);
    if (res.ok) (await caches.open(name)).put(req, res.clone());
    return res;
  } catch { return new Response('Offline', { status: 503 }); }
}

async function networkFirst(req, name) {
  try {
    const res = await fetch(req);
    if (res.ok) (await caches.open(name)).put(req, res.clone());
    return res;
  } catch {
    return (await caches.match(req)) || new Response('Offline', { status: 503 });
  }
}

async function staleWhileRevalidate(req, name) {
  const cache = await caches.open(name);
  const hit   = await cache.match(req);
  const fresh = fetch(req).then(r => { if (r.ok) cache.put(req, r.clone()); return r; }).catch(() => null);
  return hit || (await fresh) || new Response('', { status: 404 });
}

self.addEventListener('message', e => {
  if (e.data === 'SKIP_WAITING') self.skipWaiting();
});
