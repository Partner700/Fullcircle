// This cache namespace belongs only to the restored Supabase project. Never
// reuse a pre-cutover shell: those bundles still address the restricted
// project and can make an online phone appear permanently offline.
const CACHE_VERSION = 'full-circle-target-v177';
const CACHE_STORAGE_VERSION = 'full-circle-target-v177';
const SHELL_CACHE = `${CACHE_STORAGE_VERSION}-shell`;
const ASSET_CACHE = `${CACHE_STORAGE_VERSION}-assets`;
const RECOVERY_MARKER = '177';
const MINIMUM_SAFE_RELEASE = 177;
const RECOVERY_QUERY_KEYS = [
  'fc-asset-recovery',
  'fc-emergency',
  'fc-hard-recovery',
  'fc-recovered',
  'fc-release',
  'fc-repair',
  'fc-worker',
];
const NAVIGATION_FALLBACK_DELAY_MS = 1_200;
const MOBILE_DATA_FALLBACK_DELAY_MS = 3_000;
const SECONDARY_MIRROR_DELAY_MS = 1_200;
const NETWORK_ATTEMPT_TIMEOUT_MS = 18_000;
const MOBILE_DATA_FALLBACK_BASES = [
  'https://cdn.jsdelivr.net/gh/TNSorganization/Full-Circle@gh-pages/',
  'https://raw.githack.com/TNSorganization/Full-Circle/gh-pages/',
];

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

async function clearAllFullCircleCaches() {
  const cacheNames = await caches.keys();
  const fullCircleCacheNames = cacheNames.filter(isFullCircleCache);
  await Promise.all(fullCircleCacheNames.map((cacheName) => caches.delete(cacheName)));
  lastWarmAt = 0;
  return fullCircleCacheNames;
}

function wait(delayMs) {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

async function fetchWithDeadline(request, options = {}, timeoutMs = NETWORK_ATTEMPT_TIMEOUT_MS) {
  const controller = new AbortController();
  const signal = options && options.signal;
  let timedOut = false;
  const abort = () => controller.abort();
  if (signal) {
    if (signal.aborted) abort();
    else signal.addEventListener('abort', abort, { once: true });
  }
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  try {
    const response = await fetch(request, { ...options, signal: controller.signal });
    // fetch resolves at headers. Validate that the complete release body can be
    // read before choosing this route and aborting a potentially healthy copy.
    if (response.body) await response.clone().arrayBuffer();
    return response;
  } catch (error) {
    if (timedOut) throw new Error('The network request timed out.');
    throw error;
  } finally {
    clearTimeout(timeout);
    if (signal) signal.removeEventListener('abort', abort);
  }
}

function fallbackReleaseUrl(requestOrUrl, fallbackBase) {
  const requestedUrl = new URL(
    typeof requestOrUrl === 'string' ? requestOrUrl : requestOrUrl.url,
    self.registration.scope,
  );
  const scopePath = new URL(self.registration.scope).pathname;
  const relativePath = requestedUrl.pathname.startsWith(scopePath)
    ? requestedUrl.pathname.slice(scopePath.length)
    : requestedUrl.pathname.replace(/^\/+/, '');
  return new URL(relativePath || 'index.html', fallbackBase).href;
}

async function fetchMobileDataFallback(requestOrUrl, signal) {
  return new Promise((resolve, reject) => {
    const controllers = MOBILE_DATA_FALLBACK_BASES.map(() => new AbortController());
    let finished = false;
    let started = 0;
    let failures = 0;
    let secondaryTimer;
    const abortAll = () => controllers.forEach((controller) => controller.abort());
    const cleanup = () => {
      clearTimeout(secondaryTimer);
      if (signal) signal.removeEventListener('abort', abortAll);
    };
    const succeed = (winner, response) => {
      if (finished) return;
      finished = true;
      cleanup();
      controllers.forEach((controller, index) => { if (index !== winner) controller.abort(); });
      resolve(response);
    };
    const fail = () => {
      failures += 1;
      if (started < MOBILE_DATA_FALLBACK_BASES.length) start(started);
      if (!finished && started === MOBILE_DATA_FALLBACK_BASES.length && failures === started) {
        finished = true;
        cleanup();
        reject(new Error('Every independent release copy is unavailable.'));
      }
    };
    const start = (index) => {
      if (finished || index >= MOBILE_DATA_FALLBACK_BASES.length || index < started) return;
      started = index + 1;
      const fallbackBase = MOBILE_DATA_FALLBACK_BASES[index];
      const fallbackUrl = fallbackReleaseUrl(requestOrUrl, fallbackBase);
      fetchWithDeadline(fallbackUrl, { mode: 'cors', signal: controllers[index].signal }).then(async (response) => {
        if (await validReleaseResponse(response, requestOrUrl)) succeed(index, response);
        else fail();
      }, fail).catch(fail);
    };
    if (signal) {
      if (signal.aborted) abortAll();
      else signal.addEventListener('abort', abortAll, { once: true });
    }
    start(0);
    secondaryTimer = setTimeout(() => start(1), SECONDARY_MIRROR_DELAY_MS);
  });
}

async function validReleaseResponse(response, requestOrUrl) {
  const path = new URL(typeof requestOrUrl === 'string' ? requestOrUrl : requestOrUrl.url, self.registration.scope).pathname;
  const contentType = response.headers.get('content-type') || '';
  const documentRequest = (typeof requestOrUrl !== 'string' && requestOrUrl && requestOrUrl.mode === 'navigate')
    || /\.html?$/i.test(path);
  if (!response.ok) return false;
  // A document navigation must never render a JavaScript or CSS response as
  // text. It must also contain this release's marker: generic CDN, proxy and
  // hosting error pages are HTML too, but are never valid application shells.
  if (documentRequest) {
    if (!/text\/html|application\/xhtml\+xml/i.test(contentType)) return false;
    try {
      const html = await response.clone().text();
      return releaseDocumentVersion(html) >= MINIMUM_SAFE_RELEASE && /id=["']root["']/.test(html);
    } catch {
      return false;
    }
  }
  // Some hosts serve their SPA HTML for missing chunks. Require the actual
  // browser MIME for executable/style assets so markup can never become code.
  if (/\.(?:js|mjs)$/i.test(path)) return /(?:java|ecma)script/i.test(contentType);
  if (/\.css$/i.test(path)) return /text\/css/i.test(contentType);
  if (/\.json$/i.test(path)) return /application\/(?:json|manifest\+json)/i.test(contentType);
  if (/\.(?:png|jpe?g|gif|webp|svg)$/i.test(path)) return /image\//i.test(contentType);
  return !/text\/html/i.test(contentType);
}

function releaseDocumentVersion(html) {
  const tags = String(html || '').match(/<meta\b[^>]*>/gi) || [];
  const releaseTag = tags.find((tag) => /\bname=["']full-circle-release["']/i.test(tag));
  const release = releaseTag && releaseTag.match(/\bcontent=["'](\d+)["']/i);
  return release ? Number(release[1]) : 0;
}

function isRecoveryNavigation(url) {
  const target = new URL(url, self.registration.scope);
  return RECOVERY_QUERY_KEYS.some((key) => target.searchParams.has(key));
}

function isReleaseAssetPath(pathname) {
  return /\/assets\//i.test(pathname)
    || /\.(?:js|mjs|css|json|map|png|jpe?g|gif|webp|svg|woff2?|ttf|otf)$/i.test(pathname);
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
  const pathname = new URL(requestedUrl).pathname;
  if (/\.js$/i.test(pathname)) headers.set('content-type', 'text/javascript; charset=utf-8');
  else if (/\.css$/i.test(pathname)) headers.set('content-type', 'text/css; charset=utf-8');
  else if (/\.json$/i.test(pathname)) headers.set('content-type', 'application/json; charset=utf-8');
  else if (/\.html?$/i.test(pathname)) headers.set('content-type', 'text/html; charset=utf-8');
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

function fetchReleaseWithFallback(requestOrUrl, options = {}) {
  return new Promise((resolve, reject) => {
    const controllers = [new AbortController(), new AbortController()];
    let finished = false;
    let fallbackStarted = false;
    let failures = 0;
    const complete = async (index, response) => {
      if (finished) return;
      const valid = await validReleaseResponse(response, requestOrUrl);
      if (finished) return;
      if (!valid) {
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
        (response) => complete(1, response).catch(() => failed(1)), () => failed(1),
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
      (response) => complete(0, response).catch(() => failed(0)), () => failed(0),
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
  const response = await fetchReleaseWithFallback(manifestUrl, { cache: 'no-cache' });
  if (!response.ok) throw new Error('Release manifest is unavailable.');
  return response.json();
}

function filesForEntry(manifest, entryKey, visited) {
  if (!entryKey || visited.has(entryKey)) return [];
  visited.add(entryKey);
  const entry = manifest[entryKey];
  if (!entry) return [];
  const files = [entry.file, ...(entry.assets || [])].filter(Boolean);
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
    const files = ['index.html', 'offline.html', 'manifest.webmanifest', 'full-circle-release.css', ...criticalReleaseFiles(manifest)];
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
    if (
      !target.pathname.startsWith(scopePath)
      || target.pathname.endsWith('/offline.html')
      || isReleaseAssetPath(target.pathname)
    ) {
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
    event.waitUntil(clearAllFullCircleCaches().catch(() => undefined));
  } else if (event.data.type === 'CLEAR_RETIRED_CACHES') {
    event.waitUntil(clearRetiredFullCircleCaches().catch(() => undefined));
  } else if (event.data.type === 'RESET_APP_SHELL') {
    event.waitUntil(clearAllFullCircleCaches().catch(() => undefined));
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
    if (!response || !await validReleaseResponse(response, scopedUrl('index.html'))) return null;
    return localReleaseResponse(response, scopedUrl('index.html'));
  });
}

async function networkFirstNavigation(request, event) {
  const requestedPath = new URL(request.url).pathname;
  const releaseRequest = isReleaseAssetPath(requestedPath) ? scopedUrl('index.html') : request;
  const forceNetwork = isRecoveryNavigation(request.url);
  const cached = forceNetwork ? null : await cachedAppShell();
  const networkRequest = fetchReleaseWithFallback(releaseRequest, { cache: 'no-store' }).then((response) => {
    keepAlive(event, safeCachePut(SHELL_CACHE, scopedUrl('index.html'), response.clone()));
    return response;
  });
  keepAlive(event, networkRequest);
  // Returning the verified local shell immediately keeps an installed app in
  // place when a phone resumes it. The fresh release is still fetched and
  // cached in the background for the next launch.
  if (cached) return cached;
  const fallbackAfterDelay = wait(NAVIGATION_FALLBACK_DELAY_MS).then(cachedAppShell);
  try {
    const first = await Promise.race([networkRequest, fallbackAfterDelay]);
    return first || await networkRequest;
  } catch {
    const recovered = await cachedAppShell();
    if (recovered) return recovered;
    const offline = await cacheRead(() => caches.match(scopedUrl('offline.html'), { ignoreVary: true }));
    return offline ? localReleaseResponse(offline, scopedUrl('offline.html')) : emergencyRecoveryResponse();
  }
}

function emergencyRecoveryResponse() {
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="theme-color" content="#0f2037"><title>Full Circle</title><style>html,body{min-height:100%;margin:0;background:#0f2037;color:#fff;font-family:system-ui,-apple-system,sans-serif}main{min-height:100vh;display:flex;align-items:center;justify-content:center;box-sizing:border-box;padding:24px;text-align:center}div{width:min(100%,360px)}button{margin-top:18px;border:0;border-radius:8px;padding:12px 18px;background:#ffd83d;color:#0f2037;font:800 14px system-ui}</style></head><body><main><div><h1 style="font-size:18px">Full Circle is reconnecting.</h1><p style="color:#cbd5e1;font-size:13px;line-height:1.5">Your account and progress are safe.</p><button id="retry" type="button">Try Again</button></div></main><script>document.getElementById('retry').onclick=async function(){this.disabled=true;this.textContent='Reconnecting...';try{if('caches'in window){var names=await caches.keys();await Promise.all(names.filter(function(name){return name.indexOf('full-circle-')===0}).map(function(name){return caches.delete(name)}))}if(navigator.serviceWorker&&navigator.serviceWorker.controller)navigator.serviceWorker.controller.postMessage({type:'RESET_APP_SHELL'})}catch(e){}var target=new URL('./',location.href);target.searchParams.set('fc-emergency','${RECOVERY_MARKER}');target.searchParams.set('ts',String(Date.now()));location.replace(target.href)};<\/script></body></html>`;
  return new Response(html, {
      status: 503,
      headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

async function cacheFirstAsset(request, event) {
  const cached = await cacheRead(() => caches.match(request, { ignoreSearch: true, ignoreVary: true }));
  if (cached && await validReleaseResponse(cached, request)) return localReleaseResponse(cached, request);
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
  if (/\/assets\/[^/]+-[A-Za-z0-9_-]+\.(?:js|css|png|jpe?g|webp|svg|woff2?)$/i.test(url.pathname)
    || url.pathname.endsWith('/full-circle-release.css')) {
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
        url: safeAppNavigationUrl(data.url),
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
    const targetUrl = new URL(safeAppNavigationUrl(urlToOpen));

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

function safeAppNavigationUrl(value) {
  const scopeUrl = new URL(self.registration.scope);
  try {
    const target = new URL(value || scopeUrl.href, scopeUrl);
    if (
      target.origin !== scopeUrl.origin
      || !target.pathname.startsWith(scopeUrl.pathname)
      || target.pathname.endsWith('/offline.html')
      || isReleaseAssetPath(target.pathname)
    ) return scopeUrl.href;
    return target.href;
  } catch {
    return scopeUrl.href;
  }
}

self.addEventListener('notificationclose', (event) => {
  event.waitUntil(Promise.resolve());
});
