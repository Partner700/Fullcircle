const RELEASE_CACHE_KEY = 'full-circle-release-cache-version';
const RELEASE_CACHE_VERSION = '2026-10-01-v157';
const RETAINED_CACHE_PREFIXES = ['full-circle-v147-v157', 'full-circle-v147-v156', 'full-circle-v147-v155', 'full-circle-v147-v154', 'full-circle-v147-v153', 'full-circle-v147-v152', 'full-circle-v147-v151', 'full-circle-v147-v150'];

export function prepareFreshReleaseCache() {
  if (typeof window === 'undefined') return;

  try {
    const currentVersion = window.localStorage.getItem(RELEASE_CACHE_KEY);
    if (currentVersion === RELEASE_CACHE_VERSION) return;
    window.localStorage.setItem(RELEASE_CACHE_KEY, RELEASE_CACHE_VERSION);
  } catch {
    // Cache cleanup must still run when a mobile privacy mode blocks storage.
  }

  if (!('caches' in window)) return;

  void window.caches
    .keys()
    .then((cacheNames) =>
      Promise.all(
        cacheNames
          .filter((cacheName) => (
            cacheName.startsWith('full-circle-')
            && !RETAINED_CACHE_PREFIXES.some((prefix) => cacheName === prefix || cacheName.startsWith(`${prefix}-`))
          ))
          .map((cacheName) => window.caches.delete(cacheName)),
      ),
    )
    .catch(() => undefined);
}
