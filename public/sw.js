// Bump this whenever the bundle-loading strategy changes. It forces installed
// copies to discard any old HTML/chunk pairing left by a previous deployment.
const CACHE_VERSION = 'full-circle-v41';
const APP_CACHE = `${CACHE_VERSION}-app`;
const RUNTIME_CACHE = `${CACHE_VERSION}-runtime`;
const STATIC_CACHE = `${CACHE_VERSION}-static`;
const FONT_CACHE = `${CACHE_VERSION}-fonts`;
const IMAGE_CACHE = `${CACHE_VERSION}-images`;

// Legacy v1 caches to clean up
const LEGACY_CACHES = [
  'full-circle-v1-app',
  'full-circle-v1-runtime',
  'full-circle-v1-static',
  'full-circle-v1-fonts',
];

const APP_SHELL = [
  '/offline.html',
  '/manifest.webmanifest',
  '/robots.txt',
  '/browserconfig.xml',
  '/icons/fullcircle-dove-clean.png',
  '/icons/apple-touch-icon.png',
  '/icons/icon-72.png',
  '/icons/icon-96.png',
  '/icons/icon-128.png',
  '/icons/icon-144.png',
  '/icons/icon-152.png',
  '/icons/icon-167.png',
  '/icons/icon-192.png',
  '/icons/icon-384.png',
  '/icons/icon-512.png',
  '/icons/maskable-72.png',
  '/icons/maskable-96.png',
  '/icons/maskable-128.png',
  '/icons/maskable-144.png',
  '/icons/maskable-152.png',
  '/icons/maskable-192.png',
  '/icons/maskable-384.png',
  '/icons/maskable-512.png',
  '/icons/apple-splash-640x1136.png',
  '/icons/apple-splash-750x1334.png',
  '/icons/apple-splash-828x1792.png',
  '/icons/apple-splash-1125x2436.png',
  '/icons/apple-splash-1242x2688.png',
  '/icons/apple-splash-1242x2208.png',
  '/icons/apple-splash-2048x2732.png',
  '/icons/apple-splash-1668x2388.png',
  '/icons/apple-splash-1668x2224.png',
  '/icons/apple-splash-1536x2048.png',
];

const MAX_RUNTIME_ENTRIES = 50;
const MAX_IMAGE_ENTRIES = 100;
const RUNTIME_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const IMAGE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

// ── Install Event ──
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(APP_CACHE)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => {
        // Clean up legacy v1 caches on install
        return Promise.all(
          LEGACY_CACHES.map((name) =>
            caches.delete(name).catch(() => false)
          )
        );
      })
      // Activate the repaired worker as soon as installation finishes. We do
      // not claim or reload an open page, so an in-progress session keeps its
      // current bundle and the fresh release is picked up on the next launch.
      .then(() => self.skipWaiting()),
  );
});

// ── Activate Event ──
self.addEventListener('activate', (event) => {
  const expectedCaches = new Set([
    APP_CACHE,
    RUNTIME_CACHE,
    STATIC_CACHE,
    FONT_CACHE,
    IMAGE_CACHE,
    ...LEGACY_CACHES, // Will be cleaned up anyway
  ]);

  event.waitUntil(
    caches
      .keys()
      .then((cacheNames) =>
        Promise.all(
          cacheNames.map((cacheName) => {
            // Delete any cache not in the expected set
            if (!expectedCaches.has(cacheName)) {
              return caches.delete(cacheName);
            }
            // Delete legacy caches explicitly
            if (LEGACY_CACHES.includes(cacheName)) {
              return caches.delete(cacheName);
            }
            return Promise.resolve();
          }),
        ),
      )
      .then(async () => {
        if (self.registration.navigationPreload) {
          await self.registration.navigationPreload.enable().catch(() => undefined);
        }
      }),
  );
});

// ── Message Event ──
self.addEventListener('message', (event) => {
  if (!event.data) return;
  const { type } = event.data;

  switch (type) {
    case 'SKIP_WAITING':
      self.skipWaiting();
      break;
    case 'CLEAR_CACHES':
      event.waitUntil(clearAllCaches());
      break;
    case 'GET_CACHE_STATUS':
      event.waitUntil(getCacheStatus(event));
      break;
  }
});

// ── Fetch Event ──
self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Only handle GET requests
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Skip API requests entirely (network-only, no caching)
  if (isApiRequest(url)) {
    return;
  }

  // Navigation requests: network-first with offline fallback
  if (request.mode === 'navigate') {
    event.respondWith(networkFirstNavigation(request, event.preloadResponse));
    return;
  }

  // Vite gives application chunks content-hashed filenames. Reusing an already
  // downloaded chunk is safe and makes installed-app reloads dramatically
  // faster; new HTML automatically points at new filenames after a deployment.
  if (url.origin === self.location.origin && isStaticAsset(url)) {
    event.respondWith(cacheFirstStaticAsset(request));
    return;
  }

  // Images (non-icon): cache-first with separate cache and TTL
  if (isImageRequest(url)) {
    event.respondWith(cacheFirstWithTTL(request, IMAGE_CACHE, IMAGE_TTL_MS));
    return;
  }

  // Google Fonts: stale-while-revalidate
  if (isGoogleFont(url)) {
    event.respondWith(staleWhileRevalidate(request, FONT_CACHE));
    return;
  }

  // Everything else (CDN, etc.): network-first
  event.respondWith(networkFirst(request));
});

// ── Push Notification Event Handlers ──
self.addEventListener('push', (event) => {
  if (!event.data) return;

  try {
    const data = event.data.json();
    const title = data.title || 'Full Circle';
    const options = {
      body: data.body || '',
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-96.png',
      vibrate: [200, 100, 200],
      data: {
        url: data.url || '/',
        dateOfArrival: Date.now(),
      },
      actions: data.actions || [],
      tag: data.tag || 'default',
      renotify: data.renotify || false,
      requireInteraction: data.requireInteraction || false,
    };

    event.waitUntil(self.registration.showNotification(title, options));
  } catch {
    // If not JSON, show raw text
    const title = 'Full Circle';
    const options = {
      body: event.data.text(),
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-96.png',
    };
    event.waitUntil(self.registration.showNotification(title, options));
  }
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const urlToOpen = event.notification.data?.url || '/';

  event.waitUntil(
    clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then((windowClients) => {
        // Check if there's already a window open at the URL
        for (const client of windowClients) {
          const clientUrl = new URL(client.url);
          const targetUrl = new URL(urlToOpen, self.location.origin);
          if (clientUrl.pathname === targetUrl.pathname && 'focus' in client) {
            return client.focus();
          }
        }
        // Check if any window is open, focus it and navigate
        if (windowClients.length > 0 && 'focus' in windowClients[0]) {
          return windowClients[0].focus().then(() => {
            if ('navigate' in windowClients[0]) {
              return windowClients[0].navigate(urlToOpen);
            }
          });
        }
        // If not, open a new window
        if (clients.openWindow) {
          return clients.openWindow(urlToOpen);
        }
      }),
  );
});

self.addEventListener('notificationclose', (event) => {
  // Placeholder for analytics or cleanup
  event.waitUntil(Promise.resolve());
});

// ── Helper Functions ──

function isApiRequest(url) {
  return (
    url.hostname.endsWith('.supabase.co') ||
    url.pathname.startsWith('/functions/v1/') ||
    url.pathname.startsWith('/auth/v1/') ||
    url.pathname.startsWith('/rest/v1/') ||
    url.pathname.startsWith('/storage/v1/')
  );
}

function isStaticAsset(url) {
  return (
    url.pathname.startsWith('/assets/') ||
    url.pathname.startsWith('/icons/') ||
    url.pathname === '/manifest.webmanifest' ||
    url.pathname === '/robots.txt' ||
    url.pathname === '/browserconfig.xml'
  );
}

function isImageRequest(url) {
  const imageExtensions = /\.(png|jpg|jpeg|gif|webp|avif|svg|ico)$/i;
  return imageExtensions.test(url.pathname) && !url.pathname.startsWith('/icons/');
}

function isGoogleFont(url) {
  return url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com';
}

async function networkFirstNavigation(request, preloadResponsePromise) {
  const cache = await caches.open(RUNTIME_CACHE);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);

  try {
    const preloadedResponse = preloadResponsePromise ? await preloadResponsePromise : null;
    const networkResponse = preloadedResponse || await fetch(request, {
        credentials: 'same-origin',
        signal: controller.signal,
      });

    return networkResponse;
  } catch (error) {
    // Do not serve stale app HTML. If the phone is online but the server is
    // slow, failing loudly is better than booting an old instructor/cadet shell.
    const offlineResponse = await caches.match('/offline.html');
    if (offlineResponse) return offlineResponse;

    // If nothing cached, return a basic offline response
    return new Response(
      '<!DOCTYPE html><html><head><title>Offline</title><meta charset="utf-8"></head><body><h1>You are offline</h1><p>Please check your connection.</p></body></html>',
      {
        status: 503,
        statusText: 'Service Unavailable',
        headers: new Headers({
          'Content-Type': 'text/html; charset=utf-8',
        }),
      },
    );
  } finally {
    clearTimeout(timeout);
  }
}

async function cacheFirst(request, cacheName) {
  const cachedResponse = await caches.match(request);
  if (cachedResponse) return cachedResponse;

  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(cacheName);
      // Manage cache size
      const keys = await cache.keys();
      if (keys.length >= MAX_RUNTIME_ENTRIES) {
        await cache.delete(keys[0]);
      }
      cache.put(request, response.clone());
    }
    return response;
  } catch (error) {
    // If fetch fails for a navigation document, return offline fallback
    if (request.destination === 'document') {
      const offlineResponse = await caches.match('/offline.html');
      if (offlineResponse) return offlineResponse;
    }
    throw error;
  }
}

function isValidStaticAssetResponse(request, response) {
  if (!response.ok) return false;
  const contentType = response.headers.get('content-type') || '';
  if (request.destination === 'script') return /javascript|ecmascript|text\/plain/i.test(contentType);
  if (request.destination === 'style') return /text\/css/i.test(contentType);
  return true;
}

async function cacheFirstStaticAsset(request) {
  const cache = await caches.open(STATIC_CACHE);
  const cachedResponse = await cache.match(request);
  if (cachedResponse && isValidStaticAssetResponse(request, cachedResponse)) {
    return cachedResponse;
  }

  try {
    const response = await fetch(request);
    // Some static hosts return index.html with a 200 status for a missing old
    // chunk. Never serve that HTML as JavaScript/CSS.
    if (isValidStaticAssetResponse(request, response)) {
      await cache.put(request, response.clone());
      return response;
    }
  } catch {
    // Return the controlled error below so the app never executes stale code.
  }
  return new Response('', { status: 404, statusText: 'App asset unavailable' });
}

async function cacheFirstWithTTL(request, cacheName, ttl) {
  const cache = await caches.open(cacheName);
  const cachedResponse = await cache.match(request);

  if (cachedResponse) {
    const cachedTime = new Date(cachedResponse.headers.get('sw-cached-time') || 0).getTime();
    const now = Date.now();

    if (now - cachedTime < ttl) {
      return cachedResponse;
    }

    // Expired: delete and fetch fresh
    await cache.delete(request);
  }

  try {
    const response = await fetch(request);
    if (response.ok) {
      // Clone response to add custom header for TTL tracking
      const clonedResponse = response.clone();
      const headers = new Headers(clonedResponse.headers);
      headers.set('sw-cached-time', new Date().toISOString());

      const newResponse = new Response(clonedResponse.body, {
        status: clonedResponse.status,
        statusText: clonedResponse.statusText,
        headers,
      });

      // Manage cache size (LRU eviction)
      const keys = await cache.keys();
      if (keys.length >= MAX_IMAGE_ENTRIES) {
        await cache.delete(keys[0]);
      }

      await cache.put(request, newResponse);
    }
    return response;
  } catch (error) {
    // If fetch fails, return expired cached version rather than nothing
    if (cachedResponse) return cachedResponse;
    throw error;
  }
}

async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cachedResponse = await cache.match(request);

  // Fire-and-forget network update
  const networkResponse = fetch(request)
    .then((response) => {
      if (response.ok) {
        // Manage cache size
        cache.keys().then((keys) => {
          if (keys.length >= MAX_RUNTIME_ENTRIES) {
            cache.delete(keys[0]);
          }
        });
        cache.put(request, response.clone());
      }
      return response;
    })
    .catch(() => undefined);

  // Return cached immediately, or wait for network if nothing cached
  return cachedResponse || networkResponse;
}

async function networkFirst(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(RUNTIME_CACHE);
      // Manage cache size (LRU eviction)
      const keys = await cache.keys();
      if (keys.length >= MAX_RUNTIME_ENTRIES) {
        await cache.delete(keys[0]);
      }
      cache.put(request, response.clone());
    }
    return response;
  } catch (error) {
    const cachedResponse = await caches.match(request);
    if (cachedResponse) return cachedResponse;
    throw error;
  }
}

async function clearAllCaches() {
  const cacheNames = await caches.keys();
  await Promise.all(cacheNames.map((name) => caches.delete(name)));
}

async function getCacheStatus(event) {
  const cacheNames = await caches.keys();
  const status = {};
  for (const name of cacheNames) {
    const cache = await caches.open(name);
    const keys = await cache.keys();
    status[name] = keys.length;
  }
  event.source?.postMessage({ type: 'CACHE_STATUS', status });
}
