const RECOVERY_KEY = 'full-circle-stale-bundle-recovery-at';
const RECOVERY_WINDOW_MS = 20_000;
const MOBILE_DATA_COPY = 'https://raw.githack.com/TNSorganization/Full-Circle/gh-pages/index.html';
const RELEASE_MARKER = '125';
let lastRecoveryInMemory = 0;

const staleBundlePattern = /failed to fetch dynamically imported module|error loading dynamically imported module|importing a module script failed|failed to load module script|chunkloaderror|loading chunk|load failed|vite:preloaderror|preload/i;

function canLeaveCurrentOrigin(currentUrl: URL) {
  const sensitiveHash = /(?:access_token|refresh_token|type=recovery)/i.test(currentUrl.hash);
  return !currentUrl.searchParams.has('code') && !sensitiveHash;
}

function mobileDataCopyUrl() {
  const current = new URL(window.location.href);
  const target = new URL(MOBILE_DATA_COPY);
  ['share', 'date', 'id', 'signup', 'fc-access'].forEach((key) => {
    const value = current.searchParams.get(key);
    if (value) target.searchParams.set(key, value);
  });
  target.searchParams.set('fc-origin-recovery', current.hostname);
  target.searchParams.set('fc-release', RELEASE_MARKER);
  if (!/(?:access_token|refresh_token|type=recovery)/i.test(current.hash)) target.hash = current.hash;
  return target.toString();
}

export async function reloadFreshApp(useMobileDataCopy = false): Promise<void> {
  if (typeof window === 'undefined') return;

  const currentUrl = new URL(window.location.href);
  if (useMobileDataCopy
      && canLeaveCurrentOrigin(currentUrl)
      && currentUrl.hostname !== new URL(MOBILE_DATA_COPY).hostname) {
    window.location.replace(mobileDataCopyUrl());
    return;
  }

  if ('serviceWorker' in navigator) {
    const registration = await navigator.serviceWorker.getRegistration().catch(() => undefined);
    registration?.active?.postMessage({ type: 'WARM_APP_SHELL' });
    void registration?.update().catch(() => undefined);
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
  try {
    lastRecovery = Number(window.sessionStorage.getItem(RECOVERY_KEY) || lastRecoveryInMemory);
  } catch {
    // Keep the loop guard in memory when session storage is unavailable.
  }
  if (Number.isFinite(lastRecovery) && Date.now() - lastRecovery < RECOVERY_WINDOW_MS) {
    void reloadFreshApp(true).catch(() => window.location.reload());
    return true;
  }

  lastRecoveryInMemory = Date.now();
  try {
    window.sessionStorage.setItem(RECOVERY_KEY, String(lastRecoveryInMemory));
  } catch {
    // The in-memory guard above still prevents reload loops.
  }

  void reloadFreshApp().catch(() => window.location.reload());

  return true;
}
