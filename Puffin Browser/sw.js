const CACHE = 'puffin-shell-v1';
const SHELL_FILES = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(SHELL_FILES)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Only cache-first the app shell itself. Everything the iframe loads (i.e. the
// actual sites being browsed) is a separate top-level navigation inside the
// iframe and is NOT intercepted here — we only own requests for our own files.
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  const isOwnFile = SHELL_FILES.some((f) => url.pathname.endsWith(f.replace('./', '/')) || f === './' && url.pathname.endsWith('/'));

  if (e.request.mode === 'navigate' || isOwnFile) {
    e.respondWith(
      caches.match(e.request).then((cached) => cached || fetch(e.request).catch(() => caches.match('./index.html')))
    );
  }
  // All other requests (iframe content, remote sites) pass through untouched.
});
