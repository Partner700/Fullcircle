export function registerServiceWorker() {
  if (!('serviceWorker' in navigator) || import.meta.env.DEV) return;

  const reloadKey = 'full-circle-last-service-worker-reload';

  // A new worker takes control after it is installed. Reload once into its
  // matching bundle, but throttle the guard so an update can never trap a
  // device in a refresh loop.
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    const lastReload = Number(window.sessionStorage.getItem(reloadKey) || 0);
    if (Date.now() - lastReload < 10_000) return;
    window.sessionStorage.setItem(reloadKey, String(Date.now()));
    window.location.reload();
  });

  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/sw.js')
      .then((registration) => {
        const activateUpdate = () => {
          // The current worker also calls skipWaiting during install. This
          // explicit message covers browsers that leave a worker waiting.
          registration.waiting?.postMessage({ type: 'SKIP_WAITING' });
        };

        // Check and apply updates every time the app opens.
        void registration.update().then(activateUpdate).catch(() => undefined);

        if (registration.waiting) activateUpdate();
        registration.addEventListener('updatefound', () => {
          const worker = registration.installing;
          worker?.addEventListener('statechange', () => {
            if (worker.state === 'installed') activateUpdate();
          });
        });

        // Periodically check for updates (every hour)
        setInterval(() => {
          void registration.update().then(activateUpdate).catch(() => undefined);
        }, 60 * 60 * 1000);

        // Listen for messages from the service worker
        navigator.serviceWorker.addEventListener('message', (event) => {
          if (event.data?.type === 'CACHE_STATUS') {
            if (import.meta.env.DEV) {
              console.log('SW Cache Status:', event.data.status);
            }
          }
        });
      })
      .catch((error) => {
        console.warn('Service worker registration failed:', error);
      });
  });
}

/**
 * Check if the app is running in standalone/PWA mode
 */
export function isRunningStandalone(): boolean {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    (window.navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

/**
 * Get the service worker registration if available
 */
export async function getServiceWorkerRegistration(): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator)) return null;
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    return reg ?? null;
  } catch {
    return null;
  }
}

/**
 * Clear all service worker caches
 */
export async function clearAllCaches(): Promise<void> {
  const registration = await getServiceWorkerRegistration();
  if (registration?.active) {
    registration.active.postMessage({ type: 'CLEAR_CACHES' });
  }
}
