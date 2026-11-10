/* NEXPLAY service worker — boleh pasang + luar talian untuk aset */
const CACHE = 'nexplay-v1';
const TERAS = ['./', './index.html', './app.js', './manifest.json'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(TERAS)).catch(() => {}));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then(ks =>
    Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))
  ));
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url);

  // Video: JANGAN cache (fail besar). Biar pelayar uruskan byte-range.
  if (/\.(mp4|mkv|webm|m3u8|ts)$/i.test(u.pathname) || u.host.includes('archive.org/download')) {
    return;
  }

  // Metadata API: rangkaian dahulu, cache sandaran
  if (/graphql\.anilist\.co|api\.tvmaze\.com|archive\.org\/(advancedsearch|metadata)/.test(u.href)) {
    e.respondWith(
      fetch(e.request).then(r => {
        const salinan = r.clone();
        caches.open(CACHE).then(c => c.put(e.request, salinan)).catch(() => {});
        return r;
      }).catch(() => caches.match(e.request))
    );
    return;
  }

  // Imej poster: cache dahulu
  if (e.request.destination === 'image') {
    e.respondWith(
      caches.match(e.request).then(r => r || fetch(e.request).then(res => {
        const salinan = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, salinan)).catch(() => {});
        return res;
      }).catch(() => r))
    );
    return;
  }

  // Aset app: cache dahulu
  e.respondWith(caches.match(e.request).then(r => r || fetch(e.request)));
});
