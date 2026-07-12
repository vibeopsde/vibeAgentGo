// vibeAgentGo Service Worker
// Keep CACHE_NAME in sync with version.ts / package.json on every release.
// The build does not auto-inject this value — update it manually before tagging.
const CACHE_NAME = 'vibeAgentGo-__VERSION__';
const ASSETS = [
    "./agent-worker.js",
    "./apple-touch-icon.png",
    "./assets/index-Ba8Q4GKR.js",
    "./assets/index-DL1fIieG.css",
    "./favicon.ico",
    "./index.html",
    "./logo-192.png",
    "./logo-512.png",
    "./manifest.json"
  ];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((c) => c.addAll(ASSETS).catch(() => {}))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('message', (e) => {
  if (e.data && e.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

self.addEventListener('fetch', (e) => {
  const req = e.request;

  // Never intercept non-GET requests
  if (req.method !== 'GET') return;

  // Don't cache LLM API calls or cross-origin requests
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Never intercept API proxy or other backend routes (they have their own CORS/headers)
  if (url.pathname.startsWith('/api/')) return;

  // Network-first for navigation requests (HTML) and un-hashed files — always get latest
  if (req.mode === 'navigate' || (req.headers.get('accept') || '').includes('text/html') ||
      url.pathname === '/agent-worker.js' || url.pathname === '/manifest.json') {
    e.respondWith(
      fetch(req)
        .then((res) => {
          const clone = res.clone();
          caches.open(CACHE_NAME).then((c) => c.put(req, clone));
          return res;
        })
        .catch(() => caches.match(req).then((cached) => cached || caches.match('./')))
    );
    return;
  }

  // Cache-first for hashed assets (JS/CSS with content hash in filename)
  // These never change — only the filename changes with each build
  e.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req).then((res) => {
        if (res.status === 200) {
          const clone = res.clone();
          caches.open(CACHE_NAME).then((c) => c.put(req, clone));
        }
        return res;
      }).catch(() => cached);
    })
  );
});
