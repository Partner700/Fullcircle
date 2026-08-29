// This worker is intentionally notification-only. Application requests must
// always go to the network so an installed phone cannot be trapped on a stale
// offline document or an obsolete JavaScript bundle.
const CACHE_VERSION = 'full-circle-v98';
const RECOVERY_MARKER = '98';

const NOTIFICATION_SYMBOLS = {
  message: 'notification-symbols/message.svg',
  direct_message: 'notification-symbols/message.svg',
  message_mention: 'notification-symbols/message.svg',
  award: 'notification-symbols/award.svg',
  arena: 'notification-symbols/arena.svg',
  streak: 'notification-symbols/streak.svg',
  relic: 'notification-symbols/relic.svg',
  reward: 'notification-symbols/relic.svg',
  purchase: 'notification-symbols/payment.svg',
  payment: 'notification-symbols/payment.svg',
  economy: 'notification-symbols/payment.svg',
  challenge: 'notification-symbols/challenge.svg',
  scripture: 'notification-symbols/reading.svg',
  reading: 'notification-symbols/reading.svg',
};

function scopedUrl(path) {
  const value = String(path || '');
  const scope = new URL(self.registration.scope);
  if (/^https?:\/\//i.test(value)) return new URL(value).href;
  if (value.startsWith(scope.pathname)) return new URL(value, scope.origin).href;
  return new URL(value.replace(/^\/+/, ''), scope).href;
}

function notificationSymbol(type) {
  const key = String(type || '').toLowerCase();
  if (key === 'arena' || key.startsWith('arena_')) return scopedUrl('notification-symbols/arena.svg');
  return scopedUrl(NOTIFICATION_SYMBOLS[key] || 'notification-symbols/reading.svg');
}

async function clearFullCircleCaches() {
  const cacheNames = await caches.keys();
  await Promise.all(
    cacheNames
      .filter((cacheName) => cacheName.startsWith('full-circle-'))
      .map((cacheName) => caches.delete(cacheName)),
  );
}

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    await clearFullCircleCaches();
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    await clearFullCircleCaches();
    if (self.registration.navigationPreload) {
      await self.registration.navigationPreload.disable().catch(() => undefined);
    }
    await self.clients.claim();

    // Tell fallback pages that a network-only worker now controls them. Healthy
    // application screens are deliberately left untouched so an update cannot
    // cause a mid-session reload on a phone.
    const windowClients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    windowClients.forEach((client) => {
      client.postMessage({ type: 'FULL_CIRCLE_RECOVERY_READY', worker: CACHE_VERSION });
    });
  })());
});

async function recoverFallbackClient(client) {
  if (!client || typeof client.navigate !== 'function') return;
  try {
    const target = new URL(client.url);
    if (target.origin !== self.location.origin) return;
    target.pathname = new URL(self.registration.scope).pathname;
    target.search = '';
    target.searchParams.set('fc-worker', RECOVERY_MARKER);
    target.searchParams.set('fc-recovered-at', String(Date.now()));
    await client.navigate(target.href);
  } catch {
    // A closed fallback tab must not affect recovery for other clients.
  }
}

self.addEventListener('message', (event) => {
  if (!event.data) return;
  if (event.data.type === 'SKIP_WAITING') {
    event.waitUntil(self.skipWaiting());
  } else if (event.data.type === 'CLEAR_CACHES') {
    event.waitUntil(clearFullCircleCaches());
  } else if (event.data.type === 'OFFLINE_FALLBACK_VISIBLE') {
    event.waitUntil((async () => {
      await clearFullCircleCaches();
      await recoverFallbackClient(event.source);
    })());
  } else if (event.data.type === 'GET_CACHE_STATUS') {
    event.waitUntil((async () => {
      const cacheNames = await caches.keys();
      event.source?.postMessage({ type: 'CACHE_STATUS', status: { cacheNames, worker: CACHE_VERSION } });
    })());
  }
});

// Deliberately no fetch event. Push notifications do not require this worker
// to intercept the Full Circle application itself.

self.addEventListener('push', (event) => {
  if (!event.data) return;

  try {
    const data = event.data.json();
    const title = data.title || 'Full Circle';
    const options = {
      body: data.body || '',
      icon: scopedUrl('icons/icon-192.png'),
      badge: scopedUrl('icons/icon-96.png'),
      image: data.image || notificationSymbol(data.type || data.notification_type),
      vibrate: [200, 100, 200],
      data: {
        url: data.url ? scopedUrl(data.url) : self.registration.scope,
        dateOfArrival: Date.now(),
      },
      actions: data.actions || [],
      tag: data.tag || 'default',
      renotify: data.renotify || false,
      requireInteraction: data.requireInteraction || false,
    };

    event.waitUntil(self.registration.showNotification(title, options));
  } catch {
    event.waitUntil(self.registration.showNotification('Full Circle', {
      body: event.data.text(),
      icon: scopedUrl('icons/icon-192.png'),
      badge: scopedUrl('icons/icon-96.png'),
      image: notificationSymbol('message'),
    }));
  }
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const urlToOpen = event.notification.data?.url || self.registration.scope;

  event.waitUntil((async () => {
    const windowClients = await clients.matchAll({ type: 'window', includeUncontrolled: true });
    const targetUrl = new URL(urlToOpen, self.registration.scope);

    for (const client of windowClients) {
      if (new URL(client.url).pathname !== targetUrl.pathname) continue;
      await client.focus();
      if ('navigate' in client && client.url !== targetUrl.href) await client.navigate(targetUrl.href);
      return;
    }

    if (windowClients.length > 0) {
      await windowClients[0].focus();
      if ('navigate' in windowClients[0]) await windowClients[0].navigate(targetUrl.href);
      return;
    }

    if (clients.openWindow) await clients.openWindow(targetUrl.href);
  })());
});

self.addEventListener('notificationclose', (event) => {
  event.waitUntil(Promise.resolve());
});
