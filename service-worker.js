const BUILD_ID = new URL(self.location.href).searchParams.get('v') || 'dev';
const CACHE_PREFIX = 'openclaw-news-site';
const APP_SHELL_CACHE = `${CACHE_PREFIX}-shell-${BUILD_ID}`;
const DATA_CACHE = `${CACHE_PREFIX}-data-${BUILD_ID}`;
const ORIGIN = self.location.origin;
const APP_SHELL_URLS = [
  new URL('./', self.location.href).toString(),
  new URL('./index.html', self.location.href).toString(),
  new URL('./assets/favicon.svg', self.location.href).toString(),
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(APP_SHELL_CACHE);
    await Promise.all(APP_SHELL_URLS.map(async (url) => {
      try {
        const response = await fetch(url, { cache: 'reload' });
        if (isCacheableResponse(response)) {
          await cache.put(url, response.clone());
        }
      } catch {
        // Ignore precache misses and rely on runtime fetches.
      }
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const cacheNames = await caches.keys();
    await Promise.all(cacheNames
      .filter((name) => name.startsWith(CACHE_PREFIX) && ![APP_SHELL_CACHE, DATA_CACHE].includes(name))
      .map((name) => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== ORIGIN) return;

  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request, APP_SHELL_CACHE, {
      fallbackUrl: new URL('./index.html', self.location.href).toString(),
      timeoutMs: 2500,
    }));
    return;
  }

  if (isDataRequest(url)) {
    event.respondWith(networkFirst(request, DATA_CACHE, { timeoutMs: 1600 }));
    return;
  }

  if (isAppAssetRequest(request, url)) {
    event.respondWith(staleWhileRevalidate(request, APP_SHELL_CACHE));
  }
});

function isDataRequest(url) {
  return url.pathname.endsWith('/data/manifest.json')
    || url.pathname.includes('/data/chunks/')
    || url.pathname.endsWith('/data/news.json')
    || url.pathname.endsWith('/runtime-config.js');
}

function isAppAssetRequest(request, url) {
  return request.destination === 'script'
    || request.destination === 'style'
    || request.destination === 'image'
    || request.destination === 'font'
    || url.pathname.includes('/assets/');
}

function isCacheableResponse(response) {
  return Boolean(response && response.ok && response.type !== 'error');
}

async function networkFirst(request, cacheName, { fallbackUrl = null, timeoutMs = 0 } = {}) {
  const cache = await caches.open(cacheName);

  try {
    const response = await fetchWithTimeout(request, timeoutMs);
    if (isCacheableResponse(response)) {
      await cache.put(request, response.clone());
    }
    return response;
  } catch (error) {
    const cached = await cache.match(request, { ignoreSearch: false });
    if (cached) return cached;

    if (fallbackUrl) {
      const fallbackResponse = await cache.match(fallbackUrl, { ignoreSearch: true }) || await caches.match(fallbackUrl, { ignoreSearch: true });
      if (fallbackResponse) return fallbackResponse;
    }

    throw error;
  }
}

async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request, { ignoreSearch: false });

  const networkPromise = fetch(request)
    .then(async (response) => {
      if (isCacheableResponse(response)) {
        await cache.put(request, response.clone());
      }
      return response;
    })
    .catch(() => null);

  if (cached) {
    void networkPromise;
    return cached;
  }

  const networkResponse = await networkPromise;
  if (networkResponse) return networkResponse;

  throw new Error(`No cached response for ${request.url}`);
}

function fetchWithTimeout(request, timeoutMs) {
  if (!timeoutMs) return fetch(request);

  return Promise.race([
    fetch(request),
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error(`Timed out after ${timeoutMs}ms`)), timeoutMs);
    }),
  ]);
}
