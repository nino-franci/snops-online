const CACHE = 'snops-online-v2';
const CARD_ASSETS = ['J', 'Q', 'K', '10', 'A'].flatMap((rank) =>
  ['C', 'D', 'H', 'S'].map((suit) => `/cards/${rank}${suit}.png`)
);
const ASSETS = ['/', '/style.css', '/app.js', '/manifest.webmanifest', ...CARD_ASSETS];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))));
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET' || event.request.url.includes('/socket.io/')) return;
  event.respondWith(fetch(event.request).then((response) => {
    const copy = response.clone();
    caches.open(CACHE).then((cache) => cache.put(event.request, copy));
    return response;
  }).catch(() => caches.match(event.request)));
});
