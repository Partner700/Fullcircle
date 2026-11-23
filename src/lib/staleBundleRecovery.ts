const RECOVERY_KEY = 'full-circle-stale-bundle-recovery-at';
const RECOVERY_WINDOW_MS = 300_000;
let lastRecoveryInMemory = 0;

const staleBundlePattern = /failed to fetch dynamically imported module|error loading dynamically imported module|importing a module script failed|failed to load module script|chunkloaderror|loading chunk|vite:preloaderror|unable to preload css/i;

export async function reloadFreshApp(): Promise<void> {
  if (typeof window === 'undefined') return;

  const currentUrl = new URL(window.location.href);
  const release = document.querySelector<HTMLMetaElement>('meta[name="full-circle-release"]')?.content ?? 'current';

  // Verify a current HTML shell from the network before deleting the only
  // working offline cache on a phone with intermittent connectivity.
  let currentShellReachable = false;
  try {
    const probe = new URL('index.html', document.baseURI);
    probe.searchParams.set('fc-repair', release);
    probe.searchParams.set('fc-refresh', String(Date.now()));
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 5_000);
    try {
      const response = await fetch(probe.toString(), { cache: 'reload', signal: controller.signal });
      if (response.ok && /html/i.test(response.headers.get('content-type') || '')) {
        const html = await response.text();
        const version = html.match(/<meta[^>]*name=["']full-circle-release["'][^>]*content=["'](\\d+)["']/i)?.[1];
        currentShellReachable = Boolean(version && Number(version) >= Number(release) && /id=["']root["']/.test(html));
      }
    } finally {
      window.clearTimeout(timer);
    }
  } catch {
    // Retain a usable offline release if the online shell is unreachable.
  }

  const operations: Promise<unknown>[] = [];
  if ('serviceWorker' in navigator) {
    operations.push(navigator.serviceWorker.getRegistration().then(async (registration) => {
      registration?.waiting?.postMessage({ type: 'SKIP_WAITING' });
      registration?.active?.postMessage({ type: 'RESET_APP_SHELL' });
      await registration?.update().catch(() => undefined);
    }).catch(() => undefined));
  }
  if (currentShellReachable && 'caches' in window) {
    operations.push(window.caches.keys().then((names) => Promise.all(
      names.filter((name) => name.startsWith('full-circle-'))
        .map((name) => window.caches.delete(name)),
    )).catch(() => undefined));
  }

  // Previous code triggered cache deletion asynchronously and reloaded
  // immediately, allowing the stale worker to serve the same broken files.
  await Promise.race([
    Promise.allSettled(operations),
    new Promise<void>((resolve) => window.setTimeout(resolve, 4_000)),
  ]);

  currentUrl.searchParams.set('fc-repair', release);
  currentUrl.searchParams.set('fc-release', release);
  currentUrl.searchParams.set('fc-retry-at', String(Date.now()));
  window.location.replace(currentUrl.toString());
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
