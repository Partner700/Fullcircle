const RECOVERY_KEY = 'full-circle-stale-bundle-recovery-at';
const RECOVERY_WINDOW_MS = 300_000;
const RELEASE_MARKER = '166';
const CURRENT_CACHE_PREFIX = 'full-circle-target-v166';
let lastRecoveryInMemory = 0;

const staleBundlePattern = /failed to fetch dynamically imported module|error loading dynamically imported module|importing a module script failed|failed to load module script|chunkloaderror|loading chunk|vite:preloaderror|unable to preload css/i;

export async function reloadFreshApp(): Promise<void> {
  if (typeof window === 'undefined') return;

  const currentUrl = new URL(window.location.href);
  if ('serviceWorker' in navigator) {
    void navigator.serviceWorker.getRegistration().then((registration) => {
      registration?.waiting?.postMessage({ type: 'SKIP_WAITING' });
      registration?.active?.postMessage({ type: 'CLEAR_CACHES' });
      void registration?.update().catch(() => undefined);
    }).catch(() => undefined);
  }
  if ('caches' in window) {
    void window.caches.keys().then((cacheNames) => Promise.all(
      cacheNames
        .filter((cacheName) => cacheName.startsWith('full-circle-') && !cacheName.startsWith(CURRENT_CACHE_PREFIX))
        .map((cacheName) => window.caches.delete(cacheName)),
    )).catch(() => undefined);
  }

  const freshUrl = currentUrl;
  freshUrl.searchParams.set('fc-release', RELEASE_MARKER);
  freshUrl.searchParams.set('fc-retry-at', String(Date.now()));
  window.location.replace(freshUrl.toString());
}

export function recoverFromStaleBundle(error?: unknown): boolean {
  if (typeof window === 'undefined') return false;

  const message = error instanceof Error ? error.message : String(error || 'vite:preloadError');
  if (!staleBundlePattern.test(message)) return false;

  let lastRecovery = lastRecoveryInMemory;
  // The URL survives reloads even when Safari denies session storage.
  const retryAt = Number(new URL(window.location.href).searchParams.get('fc-retry-at'));
  try {
    lastRecovery = Math.max(lastRecovery, Number(window.sessionStorage.getItem(RECOVERY_KEY)) || 0);
  } catch {
    // Keep the loop guard in memory when session storage is unavailable.
  }
  if (Number.isFinite(retryAt)) lastRecovery = Math.max(lastRecovery, retryAt);
  if (lastRecovery && Date.now() - lastRecovery < RECOVERY_WINDOW_MS) return false;

  lastRecoveryInMemory = Date.now();
  try {
    window.sessionStorage.setItem(RECOVERY_KEY, String(lastRecoveryInMemory));
  } catch {
    // The in-memory guard above still prevents reload loops.
  }

  void reloadFreshApp().catch(() => window.location.reload());

  return true;
}
