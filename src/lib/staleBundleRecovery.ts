const RECOVERY_KEY = 'full-circle-stale-bundle-recovery-at';
const RECOVERY_WINDOW_MS = 20_000;

const staleBundlePattern = /failed to fetch dynamically imported module|error loading dynamically imported module|importing a module script failed|failed to load module script|chunkloaderror|loading chunk|load failed|vite:preloaderror|preload/i;

export async function reloadFreshApp(): Promise<void> {
  if (typeof window === 'undefined') return;

  if ('serviceWorker' in navigator) {
    const registration = await navigator.serviceWorker.getRegistration().catch(() => undefined);
    registration?.active?.postMessage({ type: 'CLEAR_CACHES' });
    void registration?.update().catch(() => undefined);
  }

  if ('caches' in window) {
    const cacheNames = await window.caches.keys();
    await Promise.all(
      cacheNames
        .filter((cacheName) => cacheName.startsWith('full-circle-'))
        .map((cacheName) => window.caches.delete(cacheName)),
    );
  }

  const freshUrl = new URL(window.location.href);
  freshUrl.searchParams.set('fc-release', '87');
  window.location.replace(freshUrl.toString());
}

export function recoverFromStaleBundle(error?: unknown): boolean {
  if (typeof window === 'undefined') return false;

  const message = error instanceof Error ? error.message : String(error || 'vite:preloadError');
  if (!staleBundlePattern.test(message)) return false;

  const lastRecovery = Number(window.sessionStorage.getItem(RECOVERY_KEY) || 0);
  if (Number.isFinite(lastRecovery) && Date.now() - lastRecovery < RECOVERY_WINDOW_MS) return false;

  window.sessionStorage.setItem(RECOVERY_KEY, String(Date.now()));

  void reloadFreshApp().catch(() => window.location.reload());

  return true;
}
