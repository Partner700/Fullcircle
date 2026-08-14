const RECOVERY_KEY = 'full-circle-stale-bundle-recovery-at';
const RECOVERY_WINDOW_MS = 20_000;

const staleBundlePattern = /failed to fetch dynamically imported module|importing a module script failed|loading chunk|vite:preloaderror|preload/i;

export function recoverFromStaleBundle(error?: unknown): boolean {
  if (typeof window === 'undefined') return false;

  const message = error instanceof Error ? error.message : String(error || 'vite:preloadError');
  if (!staleBundlePattern.test(message)) return false;

  const lastRecovery = Number(window.sessionStorage.getItem(RECOVERY_KEY) || 0);
  if (Number.isFinite(lastRecovery) && Date.now() - lastRecovery < RECOVERY_WINDOW_MS) return false;

  window.sessionStorage.setItem(RECOVERY_KEY, String(Date.now()));

  void (async () => {
    if ('caches' in window) {
      const cacheNames = await window.caches.keys();
      await Promise.all(
        cacheNames
          .filter((cacheName) => cacheName.startsWith('full-circle-'))
          .map((cacheName) => window.caches.delete(cacheName)),
      );
    }

    const registration = await navigator.serviceWorker?.getRegistration().catch(() => null);
    registration?.active?.postMessage({ type: 'CLEAR_CACHES' });

    window.location.reload();
  })().catch(() => window.location.reload());

  return true;
}
