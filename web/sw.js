/* 好队友 PWA service worker — app-shell cache + offline fallback.
   Data lives in localStorage, so we only need to cache static shell assets. */
const CACHE = 'hdy-pwa-v8';
const ASSETS = [
  './index.html', './form.html', './flow.html', './manage.html', './app.html',
  './dashboard.html', './print.html', './views.html',
  './manifest.webmanifest',
  './icons/icon-192.png', './icons/icon-512.png', './icons/icon-180.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    // cache individually so one missing asset can't abort the whole install
    await Promise.all(ASSETS.map((a) => c.add(a).catch(() => {})));
    self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
    self.clients.claim();
  })());
});

// cache-first for shell, then network; fall back to cached app shell when offline
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  e.respondWith((async () => {
    const cached = await caches.match(req);
    if (cached) return cached;
    try {
      const res = await fetch(req);
      if (res && res.status === 200 && res.type === 'basic') {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy));
      }
      return res;
    } catch (err) {
      return (await caches.match('./app.html')) || Response.error();
    }
  })());
});

// allow the page to show a notification via the SW (works while installed)
self.addEventListener('message', (e) => {
  const d = e.data || {};
  if (d.type === 'notify' && self.registration.showNotification) {
    self.registration.showNotification(d.title || '好队友', {
      body: d.body || '', icon: './icons/icon-192.png', badge: './icons/icon-192.png',
      tag: d.tag, data: d.data || {},
    });
  }
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const url = './app.html?tab=msg';
    for (const c of all) { if ('focus' in c) return c.focus(); }
    if (self.clients.openWindow) return self.clients.openWindow(url);
  })());
});
