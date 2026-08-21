// Bump this whenever the bundle-loading strategy changes. It forces installed
// copies to discard any old HTML/chunk pairing left by a previous deployment.
const CACHE_VERSION = 'full-circle-v74';
const APP_CACHE = `${CACHE_VERSION}-app`;
const RUNTIME_CACHE = `${CACHE_VERSION}-runtime`;
const STATIC_CACHE = `${CACHE_VERSION}-static`;
const FONT_CACHE = `${CACHE_VERSION}-fonts`;
const IMAGE_CACHE = `${CACHE_VERSION}-images`;
const RETAINED_CACHE_PREFIXES = [CACHE_VERSION];

// Legacy v1 caches to clean up
const LEGACY_CACHES = [
  'full-circle-v1-app',
  'full-circle-v1-runtime',
  'full-circle-v1-static',
  'full-circle-v1-fonts',
];

const MAX_RUNTIME_ENTRIES = 50;
const MAX_IMAGE_ENTRIES = 100;
const RUNTIME_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const IMAGE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const NOTIFICATION_SYMBOLS = {
  message: '/notification-symbols/message.svg',
  direct_message: '/notification-symbols/message.svg',
  message_mention: '/notification-symbols/message.svg',
  award: '/notification-symbols/award.svg',
  arena: '/notification-symbols/arena.svg',
  streak: '/notification-symbols/streak.svg',
  relic: '/notification-symbols/relic.svg',
  reward: '/notification-symbols/relic.svg',
  purchase: '/notification-symbols/payment.svg',
  payment: '/notification-symbols/payment.svg',
  economy: '/notification-symbols/payment.svg',
  challenge: '/notification-symbols/challenge.svg',
  scripture: '/notification-symbols/reading.svg',
  reading: '/notification-symbols/reading.svg',
};

function notificationSymbol(type) {
  const key = String(type || '').toLowerCase();
  if (key === 'arena' || key.startsWith('arena_')) return '/notification-symbols/arena.svg';
  return NOTIFICATION_SYMBOLS[key] || '/notification-symbols/reading.svg';
}

// ── Install Event ──
self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    // Installation performs no network work. A slow icon or splash-screen
    // request must never keep an older, broken phone worker in control.
    await Promise.all(LEGACY_CACHES.map((name) => caches.delete(name).catch(() => false)));
    await self.skipWaiting();
  })());
});

// ── Activate Event ──
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((cacheNames) =>
        Promise.all(
          cacheNames.map((cacheName) => {
            if (LEGACY_CACHES.includes(cacheName)) {
              return caches.delete(cacheName);
            }
            // The worker no longer serves application requests. Remove every
            // retired Full Circle response so a phone cannot be trapped on an
            // old offline page or a mismatched application bundle.
            if (cacheName.startsWith('full-circle-')) {
              return caches.delete(cacheName);
            }
            return Promise.resolve();
          }),
        ),
      )
      .then(async () => {
        if (self.registration.navigationPreload) {
          await self.registration.navigationPreload.disable().catch(() => undefined);
        }
        // Replace legacy navigation workers immediately. The repaired worker
        // never intercepts documents, so claiming an open phone page is safe.
        await self.clients.claim();
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

// Deliberately no fetch handler. Push notifications still use this worker, but
// the browser owns every document, script, image, and API request. This keeps
// an installed phone app from reporting "offline" while the network is live.

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
      image: data.image || notificationSymbol(data.type || data.notification_type),
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
      image: notificationSymbol('message'),
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
            return client.focus().then(() => {
              if ('navigate' in client && client.url !== targetUrl.href) return client.navigate(targetUrl.href);
            });
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
