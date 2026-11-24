/* LAZA app service worker: keeps the app usable when the server is unreachable for a while.
 *  - app shell + static assets: cached, served instantly (and when offline)
 *  - GET /api/*: network first (5s), falls back to the last good answer (marked x-laza-cache)
 *  - everything else (POST/PUT/DELETE, sockets, health check, customer QR API) goes straight to the network
 */
const VERSION = 'v1';
const SHELL = 'laza-shell-' + VERSION;
const API = 'laza-api-' + VERSION;
const ASSETS = 'laza-assets-' + VERSION;
const NETWORK_TIMEOUT = 5000;

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(['/', '/laza.svg', '/manifest.webmanifest'])).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => ![SHELL, API, ASSETS].includes(k)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), ms);
    promise.then(
      (v) => { clearTimeout(t); resolve(v); },
      (e) => { clearTimeout(t); reject(e); },
    );
  });
}

async function apiGet(request) {
  const cache = await caches.open(API);
  try {
    const res = await withTimeout(fetch(request), NETWORK_TIMEOUT);
    if (res.ok) cache.put(request.url, res.clone());
    return res;
  } catch (err) {
    const hit = await cache.match(request.url);
    if (hit) {
      const headers = new Headers(hit.headers);
      headers.set('x-laza-cache', '1');
      return new Response(await hit.blob(), { status: hit.status, statusText: hit.statusText, headers });
    }
    throw err;
  }
}

async function navigate(request) {
  const cache = await caches.open(SHELL);
  try {
    const res = await withTimeout(fetch(request), NETWORK_TIMEOUT);
    if (res.ok) cache.put('/', res.clone());
    return res;
  } catch (err) {
    const hit = await cache.match('/');
    if (hit) return hit;
    throw err;
  }
}

async function staticAsset(request) {
  const cache = await caches.open(ASSETS);
  const hit = await cache.match(request);
  if (hit) return hit;
  const res = await fetch(request);
  if (res.ok || res.type === 'opaque') cache.put(request, res.clone());
  return res;
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (url.origin !== self.location.origin) {
    if (/fonts\.(googleapis|gstatic)\.com$/.test(url.hostname)) e.respondWith(staticAsset(req));
    return;
  }
  if (url.pathname.startsWith('/socket.io') || url.pathname === '/api/health' || url.pathname.startsWith('/api/public')) return;
  // Customer self-ordering pages (/m/...) are not part of the staff app.
  if (url.pathname.startsWith('/m/')) return;

  if (url.pathname.startsWith('/api/')) return e.respondWith(apiGet(req));
  if (req.mode === 'navigate') return e.respondWith(navigate(req));
  if (url.pathname.startsWith('/assets/') || /\.(svg|png|ico|webmanifest|woff2?)$/.test(url.pathname)) return e.respondWith(staticAsset(req));
});

self.addEventListener('message', (e) => {
  if (e.data === 'clear-api') e.waitUntil(caches.delete(API));
});
