// This cache namespace belongs only to the restored Supabase project. Never
// reuse a pre-cutover shell: those bundles still address the restricted
// project and can make an online phone appear permanently offline.
const CACHE_VERSION = 'full-circle-target-v161';
const CACHE_STORAGE_VERSION = 'full-circle-target-v161';
const SHELL_CACHE = `${CACHE_STORAGE_VERSION}-shell`;
const ASSET_CACHE = `${CACHE_STORAGE_VERSION}-assets`;
const RECOVERY_MARKER = '161';
const NAVIGATION_FALLBACK_DELAY_MS = 1_200;
const MOBILE_DATA_FALLBACK_DELAY_MS = 2_500;
const NETWORK_ATTEMPT_TIMEOUT_MS = 10_000;
const MOBILE_DATA_FALLBACK_BASE = 'https://raw.githack.com/TNSorganization/Full-Circle/gh-pages/';

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
  const retiredCacheNames = cacheNames.filter((cacheName) => (
    isFullCircleCache(cacheName)
    && cacheName !== SHELL_CACHE
    && cacheName !== ASSET_CACHE
  ));
  await Promise.all(
    retiredCacheNames.map((cacheName) => caches.delete(cacheName)),
  );
  return retiredCacheNames;
}

function wait(delayMs) {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

function fetchWithDeadline(request, options, timeoutMs = NETWORK_ATTEMPT_TIMEOUT_MS) {
  const controller = new AbortController();
  const signal = options && options.signal;
  const abort = () => controller.abort();
  if (signal) {
    if (signal.aborted) abort();
    else signal.addEventListener('abort', abort, { once: true });
  }
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timeout);
      if (signal) signal.removeEventListener('abort', abort);
    };
    const timeout = setTimeout(() => {
      controller.abort();
      reject(new Error('The network request timed out.'));
    }, timeoutMs);
    fetch(request, { ...options, signal: controller.signal }).then(
      (response) => {
        // Once headers arrive, a slow but valid response body must not be aborted.
        cleanup();
        resolve(response);
      },
      (error) => {
        cleanup();
        reject(error);
      },
    );
  });
}

function fallbackReleaseUrl(requestOrUrl) {
  const requestedUrl = new URL(
    typeof requestOrUrl === 'string' ? requestOrUrl : requestOrUrl.url,
    self.registration.scope,
  );
  const scopePath = new URL(self.registration.scope).pathname;
  const relativePath = requestedUrl.pathname.startsWith(scopePath)
    ? requestedUrl.pathname.slice(scopePath.length)
    : requestedUrl.pathname.replace(/^\/+/, '');
  return new URL(relativePath || 'index.html', MOBILE_DATA_FALLBACK_BASE).href;
}

async function fetchMobileDataFallback(requestOrUrl, signal) {
  const fallbackUrl = fallbackReleaseUrl(requestOrUrl);
  return fetchWithDeadline(fallbackUrl, { mode: 'cors', signal });
}

function validReleaseResponse(response, requestOrUrl) {
  const path = new URL(typeof requestOrUrl === 'string' ? requestOrUrl : requestOrUrl.url, self.registration.scope).pathname;
  // Some hosts serve their SPA HTML for missing chunks. Never cache it as JS/CSS.
  return response.ok && !(/\.(?:js|css|json|png|jpe?g|webp|svg|woff2?)$/i.test(path)
    && /text\/html/i.test(response.headers.get('content-type') || ''));
}

function localReleaseResponse(response, requestOrUrl) {
  const requestedUrl = new URL(typeof requestOrUrl === 'string' ? requestOrUrl : requestOrUrl.url, self.registration.scope).href;
  if (!response.url || response.url === requestedUrl) return response;
  // A fetched mirror URL becomes the base for module imports unless removed.
  // Re-wrap cached responses too: older workers stored that foreign base URL.
  // The body is already decoded by fetch, so discard transport-only headers.
  const headers = new Headers(response.headers);
  headers.delete('content-encoding');
  headers.delete('content-length');
  headers.delete('transfer-encoding');
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

function fetchReleaseWithFallback(requestOrUrl, options = {}) {
  return new Promise((resolve, reject) => {
    const controllers = [new AbortController(), new AbortController()];
    let finished = false;
    let fallbackStarted = false;
    let failures = 0;
    const complete = (index, response) => {
      if (finished) return;
      if (!validReleaseResponse(response, requestOrUrl)) {
        failed(index);
        return;
      }
      finished = true;
      clearTimeout(hedgeTimer);
      controllers[1 - index].abort();
      resolve(localReleaseResponse(response, requestOrUrl));
    };
    const startFallback = () => {
      if (finished || fallbackStarted) return;
      fallbackStarted = true;
      fetchMobileDataFallback(requestOrUrl, controllers[1].signal).then(
        (response) => complete(1, response), () => failed(1),
      );
    };
    const failed = (index) => {
      if (finished) return;
      failures += 1;
      if (index === 0) startFallback();
      if (failures === 2) {
        finished = true;
        clearTimeout(hedgeTimer);
        reject(new Error('The primary and mobile-data release copies are unavailable.'));
      }
    };
    const hedgeTimer = setTimeout(startFallback, MOBILE_DATA_FALLBACK_DELAY_MS);
    fetchWithDeadline(requestOrUrl, { ...options, signal: controllers[0].signal }).then(
      (response) => complete(0, response), () => failed(0),
    );
  });
}

async function cacheRead(read) {
  // Safari storage can be unavailable or stalled. It must not block the network.
  let timer;
  try {
    return await Promise.race([
      Promise.resolve().then(read).catch(() => null),
      new Promise((resolve) => { timer = setTimeout(() => resolve(null), 200); }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function safeCachePut(cacheName, url, response) {
  try {
    const cache = await caches.open(cacheName);
    await cache.put(url, response);
  } catch {
    // Quota and private-browsing failures must never discard a valid response.
  }
}

function keepAlive(event, promise) {
  const settled = promise.catch(() => undefined);
  if (event) event.waitUntil(settled);
}

async function readReleaseManifest() {
  // Read this host's manifest: another host may use different build hashes.
  const manifestUrl = scopedUrl('release-manifest.json');
  const response = await fetchWithDeadline(manifestUrl, { cache: 'no-cache' });
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

function criticalReleaseFiles(manifest) {
  return [...new Set(filesForEntry(manifest, 'index.html', new Set()))];
}

let warming = null;
let lastWarmAt = 0;
function warmAppShell() {
  if (warming) return warming;
  if (lastWarmAt && Date.now() - lastWarmAt < 300_000) return Promise.resolve();
  warming = (async () => {
    const manifest = await readReleaseManifest();
    const files = ['index.html', 'offline.html', 'manifest.webmanifest', ...criticalReleaseFiles(manifest)];
    // Two background fetches at most, and never fetch already-cached chunks.
    let next = 0;
    const fill = async () => {
      while (next < files.length) {
        const file = files[next++];
        const url = scopedUrl(file);
        if (await cacheRead(() => caches.match(url, { ignoreVary: true }))) continue;
        try {
          const response = await fetchReleaseWithFallback(url);
          await safeCachePut(file.startsWith('assets/') ? ASSET_CACHE : SHELL_CACHE, url, response);
        } catch {
          // Normal requests can fill a partially warmed cache later.
        }
      }
    };
    await Promise.all([fill(), fill()]);
    lastWarmAt = Date.now();
  })().catch(() => undefined).finally(() => { warming = null; });
  return warming;
}

self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const retiredCaches = await clearRetiredFullCircleCaches().catch(() => []);
    if (self.registration.navigationPreload) {
      await self.registration.navigationPreload.disable().catch(() => undefined);
    }
    await self.clients.claim();

    // Only clients carrying a retired release are refreshed. A normal worker
    // update never interrupts an active quiz or draft.
    const windowClients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    await Promise.all(windowClients.map(async (client) => {
      if (retiredCaches.length > 0) await recoverFallbackClient(client);
      client.postMessage({
        type: 'FULL_CIRCLE_RECOVERY_READY',
        worker: CACHE_VERSION,
        retiredReleaseRemoved: retiredCaches.length > 0,
      });
    }));
  })());
});

async function recoverFallbackClient(client) {
  if (!client || typeof client.navigate !== 'function') return;
  try {
    const target = new URL(client.url);
    if (target.origin !== self.location.origin) return;
    const scopePath = new URL(self.registration.scope).pathname;
    if (!target.pathname.startsWith(scopePath) || target.pathname.endsWith('/offline.html')) {
      target.pathname = scopePath;
      target.search = '';
      target.hash = '';
    }
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
    event.waitUntil(clearRetiredFullCircleCaches().catch(() => undefined));
  } else if (event.data.type === 'WARM_APP_SHELL') {
    // Warm only the entry shell. Fetching every lazy game and admin screen at
    // launch can saturate a mobile connection and delay the screen being used.
    event.waitUntil(warmAppShell());
  } else if (event.data.type === 'OFFLINE_FALLBACK_VISIBLE') {
    event.waitUntil((async () => {
      await warmAppShell();
      if (await cachedAppShell()) await recoverFallbackClient(event.source);
    })());
  } else if (event.data.type === 'GET_CACHE_STATUS') {
    event.waitUntil((async () => {
      const cacheNames = await caches.keys();
      if (event.source) event.source.postMessage({ type: 'CACHE_STATUS', status: { cacheNames, worker: CACHE_VERSION } });
    })());
  }
});

async function cachedAppShell() {
  return cacheRead(async () => {
    const cache = await caches.open(SHELL_CACHE);
    const response = (await cache.match(scopedUrl('index.html'), { ignoreVary: true }))
      || (await cache.match(scopedUrl(''), { ignoreVary: true }));
    return response ? localReleaseResponse(response, scopedUrl('index.html')) : null;
  });
}

async function networkFirstNavigation(request, event) {
  const networkRequest = fetchReleaseWithFallback(request, { cache: 'no-store' }).then((response) => {
    keepAlive(event, safeCachePut(SHELL_CACHE, scopedUrl('index.html'), response.clone()));
    return response;
  });
  keepAlive(event, networkRequest);
  const fallbackAfterDelay = wait(NAVIGATION_FALLBACK_DELAY_MS).then(cachedAppShell);
  try {
    const first = await Promise.race([networkRequest, fallbackAfterDelay]);
    return first || await networkRequest;
  } catch {
    const cached = await cachedAppShell();
    if (cached) return cached;
    const offline = await cacheRead(() => caches.match(scopedUrl('offline.html'), { ignoreVary: true }));
    return offline ? localReleaseResponse(offline, scopedUrl('offline.html')) : new Response('Full Circle is reconnecting. Please try again.', {
      status: 503,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }
}

async function cacheFirstAsset(request, event) {
  const cached = await cacheRead(() => caches.match(request, { ignoreSearch: true, ignoreVary: true }));
  if (cached && validReleaseResponse(cached, request)) return localReleaseResponse(cached, request);
  const response = await fetchReleaseWithFallback(request);
  keepAlive(event, safeCachePut(ASSET_CACHE, request, response.clone()));
  return response;
}

async function cacheFirstShellFile(request, event) {
  const cached = await cacheRead(() => caches.match(request, { ignoreSearch: true, ignoreVary: true }));
  if (cached) return localReleaseResponse(cached, request);
  const response = await fetchReleaseWithFallback(request);
  keepAlive(event, safeCachePut(SHELL_CACHE, request, response.clone()));
  return response;
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(networkFirstNavigation(request, event));
    return;
  }

  const scopePath = new URL(self.registration.scope).pathname;
  if (!url.pathname.startsWith(scopePath)) return;
  if (/\/assets\/[^/]+-[A-Za-z0-9_-]+\.(?:js|css|png|jpe?g|webp|svg|woff2?)$/i.test(url.pathname)) {
    event.respondWith(cacheFirstAsset(request, event));
  } else if (url.pathname.includes('/icons/')) {
    event.respondWith(cacheFirstShellFile(request, event));
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
