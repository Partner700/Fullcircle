// Hashed release assets are safe to retain, while page navigation remains
// network-first. This lets installed phones open through a weak carrier or
// Wi-Fi handoff without allowing an old HTML shell to pin a stale release.
const CACHE_VERSION = 'full-circle-v142';
const SHELL_CACHE = `${CACHE_VERSION}-shell`;
const ASSET_CACHE = `${CACHE_VERSION}-assets`;
const RECOVERY_MARKER = '135';
const NAVIGATION_FALLBACK_DELAY_MS = 4_500;

const NOTIFICATION_SYMBOLS = {
  message: 'notification-symbols/message.svg',
  direct_message: 'notification-symbols/message.svg',
  message_mention: 'notification-symbols/message.svg',
  tent_join_request: 'notification-symbols/message.svg',
  audio_call: 'notification-symbols/call.svg',
  award: 'notification-symbols/award.svg',
  arena: 'notification-symbols/arena.svg',
  streak: 'notification-symbols/streak.svg',
  relic: 'notification-symbols/relic.svg',
  reward: 'notification-symbols/relic.svg',
  treasure: 'notification-symbols/relic.svg',
  purchase: 'notification-symbols/payment.svg',
  payment: 'notification-symbols/payment.svg',
  economy: 'notification-symbols/payment.svg',
  challenge: 'notification-symbols/challenge.svg',
  dove_question: 'notification-symbols/challenge.svg',
  mine: 'notification-symbols/challenge.svg',
  quiz: 'notification-symbols/challenge.svg',
  quiz_release: 'notification-symbols/challenge.svg',
  weekly_quiz_reminder: 'notification-symbols/challenge.svg',
  scripture_alarm: 'notification-symbols/challenge.svg',
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

function isFullCircleCache(cacheName) {
  return cacheName.startsWith('full-circle-');
}

async function clearRetiredFullCircleCaches() {
  const cacheNames = await caches.keys();
  await Promise.all(
    cacheNames
      .filter((cacheName) => isFullCircleCache(cacheName) && cacheName !== SHELL_CACHE && cacheName !== ASSET_CACHE)
      .map((cacheName) => caches.delete(cacheName)),
  );
}

async function fetchAndCache(cache, url, options) {
  try {
    const response = await fetch(url, options);
    if (response.ok) await cache.put(url, response.clone());
    return response;
  } catch {
    return null;
  }
}

async function readReleaseManifest() {
  const manifestUrl = scopedUrl('.vite/manifest.json');
  const response = await fetch(manifestUrl, { cache: 'no-store' });
  if (!response.ok) throw new Error('Release manifest is unavailable.');
  return response.json();
}

function filesForEntry(manifest, entryKey, visited) {
  if (!entryKey || visited.has(entryKey)) return [];
  visited.add(entryKey);
  const entry = manifest[entryKey];
  if (!entry) return [];
  const files = [entry.file, ...(entry.css || []), ...(entry.assets || [])].filter(Boolean);
  for (const importedKey of entry.imports || []) {
    files.push(...filesForEntry(manifest, importedKey, visited));
  }
  return files;
}

function allCurrentReleaseFiles(manifest) {
  const files = new Set();
  Object.keys(manifest).forEach((key) => {
    const entry = manifest[key];
    [entry.file, ...(entry.css || []), ...(entry.assets || [])]
      .filter(Boolean)
      .forEach((file) => files.add(file));
  });
  return [...files];
}

function settleAll(promises) {
  return Promise.all(promises.map((promise) => Promise.resolve(promise).catch(() => null)));
}

async function warmAppShell(includeAllReleaseFiles = false) {
  const shell = await caches.open(SHELL_CACHE);
  const rootUrl = scopedUrl('');
  const indexUrl = scopedUrl('index.html');
  const coreUrls = [
    rootUrl,
    indexUrl,
    scopedUrl('offline.html'),
    scopedUrl('manifest.webmanifest'),
  ];
  if (includeAllReleaseFiles) {
    coreUrls.push(
      ...['72', '96', '128', '144', '152', '192', '384', '512'].map((size) => scopedUrl(`icons/icon-${size}.png`)),
      scopedUrl('icons/apple-touch-icon.png'),
      scopedUrl('icons/fullcircle-dove-clean.png'),
    );
  }
  await settleAll(coreUrls.map((url) => fetchAndCache(shell, url, { cache: 'reload' })));

  try {
    const manifest = await readReleaseManifest();
    const releaseFiles = includeAllReleaseFiles
      ? allCurrentReleaseFiles(manifest)
      : filesForEntry(manifest, 'index.html', new Set());
    const assets = await caches.open(ASSET_CACHE);
    await settleAll(
      [...new Set(releaseFiles)].map((file) => fetchAndCache(assets, scopedUrl(file), { cache: 'reload' })),
    );
  } catch {
    // A partial install remains valid; normal requests fill the cache later.
  }
}

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    await warmAppShell(false);
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    await clearRetiredFullCircleCaches();
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
    await settleAll(windowClients.map(refreshInstalledClient));
  })());
});

async function refreshInstalledClient(client) {
  if (!client || typeof client.navigate !== 'function') return;
  const target = new URL(client.url);
  if (target.origin !== self.location.origin) return;

  const previousWorker = target.searchParams.get('fc-worker');
  if (previousWorker === RECOVERY_MARKER) return;

  // Refresh every same-origin application window once. Some installed copies
  // have lost their original start_url query, so checking only fc-launch can
  // leave those clients pinned to an older GitHub Pages shell indefinitely.
  target.searchParams.set('fc-worker', RECOVERY_MARKER);
  target.searchParams.set('fc-refreshed-at', String(Date.now()));
  await client.navigate(target.href);
}

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
    event.waitUntil(clearRetiredFullCircleCaches());
  } else if (event.data.type === 'WARM_APP_SHELL') {
    event.waitUntil(warmAppShell(true));
  } else if (event.data.type === 'OFFLINE_FALLBACK_VISIBLE') {
    event.waitUntil((async () => {
      await warmAppShell(false);
      await recoverFallbackClient(event.source);
    })());
  } else if (event.data.type === 'GET_CACHE_STATUS') {
    event.waitUntil((async () => {
      const cacheNames = await caches.keys();
      if (event.source) event.source.postMessage({ type: 'CACHE_STATUS', status: { cacheNames, worker: CACHE_VERSION } });
    })());
  }
});

async function cachedAppShell() {
  const cache = await caches.open(SHELL_CACHE);
  return (await cache.match(scopedUrl('index.html'), { ignoreVary: true }))
    || (await cache.match(scopedUrl(''), { ignoreVary: true }))
    || (await cache.match(scopedUrl('offline.html'), { ignoreVary: true }));
}

async function networkFirstNavigation(request) {
  const shell = await caches.open(SHELL_CACHE);
  const networkRequest = fetch(request, { cache: 'no-store' }).then(async (response) => {
    if (response.ok) {
      await shell.put(scopedUrl('index.html'), response.clone());
      await shell.put(scopedUrl(''), response.clone());
    }
    return response;
  });

  const fallbackAfterDelay = new Promise((resolve, reject) => {
    setTimeout(() => {
      void cachedAppShell().then((cached) => {
        if (cached) resolve(cached);
        else reject(new Error('No cached application shell is available.'));
      });
    }, NAVIGATION_FALLBACK_DELAY_MS);
  });

  try {
    return await Promise.race([networkRequest, fallbackAfterDelay]);
  } catch {
    const cached = await cachedAppShell();
    if (cached) return cached;
    return networkRequest;
  }
}

async function cacheFirstAsset(request) {
  const cache = await caches.open(ASSET_CACHE);
  const cached = await cache.match(request, { ignoreVary: true });
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) await cache.put(request, response.clone());
  return response;
}

async function cacheFirstShellFile(request) {
  const cache = await caches.open(SHELL_CACHE);
  const cached = await cache.match(request, { ignoreSearch: true, ignoreVary: true });
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) await cache.put(request, response.clone());
  return response;
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(networkFirstNavigation(request));
    return;
  }

  const scopePath = new URL(self.registration.scope).pathname;
  if (!url.pathname.startsWith(scopePath)) return;
  if (/\/assets\/[^/]+-[A-Za-z0-9_-]+\.(?:js|css|png|jpe?g|webp|svg|woff2?)$/i.test(url.pathname)) {
    event.respondWith(cacheFirstAsset(request));
  } else if (url.pathname.includes('/icons/')) {
    event.respondWith(cacheFirstShellFile(request));
  }
});

self.addEventListener('push', (event) => {
  if (!event.data) return;

  try {
    const data = event.data.json();
    const title = data.title || 'Full Circle';
    const notificationType = String(data.type || data.notification_type || '').toLowerCase();
    const isScriptureAlarm = notificationType === 'scripture_alarm';
    const isAudioCall = notificationType === 'audio_call';
    const isUrgent = isScriptureAlarm || isAudioCall;
    if (isUrgent && data.metadata && data.metadata.expires_at
      && Date.parse(data.metadata.expires_at) <= Date.now()) return;
    const options = {
      body: data.body || '',
      icon: scopedUrl('icons/icon-192.png'),
      badge: scopedUrl('icons/icon-96.png'),
      image: data.image || notificationSymbol(data.type || data.notification_type),
      vibrate: isAudioCall
        ? [900, 150, 900, 150, 1200]
        : isScriptureAlarm ? [1200, 120, 1200, 120, 1600] : [200, 100, 200],
      data: {
        url: data.url ? scopedUrl(data.url) : self.registration.scope,
        dateOfArrival: Date.now(),
      },
      actions: data.actions || [],
      tag: data.tag || 'default',
      renotify: isUrgent || data.renotify || false,
      requireInteraction: isUrgent || data.requireInteraction || false,
      silent: false,
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
  const urlToOpen = (event.notification.data && event.notification.data.url) || self.registration.scope;

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
