const BASE_PATH = self.location.pathname.replace(/[^/]+$/, '');
const CACHE_NAME = `pwa-cache${BASE_PATH.replace(/\//g, '-')}v24`;

const PRECACHE_URLS = [
  BASE_PATH,
  `${BASE_PATH}index.html`,
  `${BASE_PATH}manifest.json`,
  `${BASE_PATH}css/style.css`,
  `${BASE_PATH}js/app.js`,
  `${BASE_PATH}js/worker.js`,
  `${BASE_PATH}js/transcription.js`,
  `${BASE_PATH}js/recorder.js`,
  `${BASE_PATH}js/uploader.js`,
  `${BASE_PATH}js/storage.js`,
  `${BASE_PATH}js/history.js`,
  `${BASE_PATH}js/ui.js`,
  `${BASE_PATH}js/cloud.js`,
];

const STATIC_EXTENSIONS = ['js', 'css', 'png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'woff', 'woff2', 'ttf', 'eot', 'ico'];

function isStaticResource(url) {
  const ext = url.pathname.split('.').pop().toLowerCase();
  return STATIC_EXTENSIONS.includes(ext);
}

function isNavigateRequest(request) {
  return request.mode === 'navigate' || (request.method === 'GET' && request.destination === 'document');
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => Promise.allSettled(
        PRECACHE_URLS.map(url => cache.add(url).catch(err => console.warn(`precache failed ${url}:`, err)))
      ))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.map(k => { if (k.startsWith('pwa-cache-') && k !== CACHE_NAME) return caches.delete(k); })
    )).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  if (url.origin !== location.origin || request.method !== 'GET') return;

  if (isNavigateRequest(request)) {
    event.respondWith(
      fetch(request).then(r => {
        if (r && r.status === 200) {
          const clone = r.clone();
          caches.open(CACHE_NAME).then(c => c.put(request, clone));
        }
        return r;
      }).catch(async () => {
        const cached = await caches.match(request);
        if (cached) return cached;
        return new Response(
          '<h1>离线状态</h1><p>请检查网络连接后刷新页面。</p>',
          { status: 503, headers: { 'Content-Type': 'text/html' } }
        );
      })
    );
    return;
  }

  if (isStaticResource(url)) {
    event.respondWith(
      caches.match(request).then(cached => {
        if (cached) return cached;
        return fetch(request).then(r => {
          if (r && r.status === 200) {
            const clone = r.clone();
            caches.open(CACHE_NAME).then(c => c.put(request, clone));
          }
          return r;
        }).catch(() => new Response('', { status: 408 }));
      })
    );
  }
});