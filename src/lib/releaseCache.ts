const RELEASE_CACHE_KEY = 'full-circle-release-cache-version';
const RELEASE_CACHE_VERSION = '2026-08-18-v52';

export function prepareFreshReleaseCache() {
  if (typeof window === 'undefined') return;

  const currentVersion = window.localStorage.getItem(RELEASE_CACHE_KEY);
  if (currentVersion === RELEASE_CACHE_VERSION) return;

  window.localStorage.setItem(RELEASE_CACHE_KEY, RELEASE_CACHE_VERSION);

  if (!('caches' in window)) return;

  void window.caches
    .keys()
    .then((cacheNames) =>
      Promise.all(
        cacheNames
          .filter((cacheName) => cacheName.startsWith('full-circle-') && !cacheName.startsWith('full-circle-v52'))
          .map((cacheName) => window.caches.delete(cacheName)),
      ),
    )
    .catch(() => undefined);
}
