export function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;

  // A previously installed production worker can otherwise keep serving an
  // outdated bundle while the local Vite server is running on the same origin.
  // Development should always use the files Vite is serving right now.
  if (import.meta.env.DEV) {
    void navigator.serviceWorker
      .getRegistrations()
      .then(async (registrations) => {
        await Promise.all(registrations.map((registration) => registration.unregister()));

        if (!('caches' in window)) return;
        const cacheNames = await window.caches.keys();
        await Promise.all(
          cacheNames
            .filter((cacheName) => cacheName.startsWith('full-circle-'))
            .map((cacheName) => window.caches.delete(cacheName)),
        );
      })
      .catch(() => undefined);
    return;
  }

  const register = () => {
    navigator.serviceWorker
      .register('/sw.js?v=75', { updateViaCache: 'none' })
      .then((registration) => {
        // Check for a new worker at launch. The worker itself activates safely;
        // this client never forces a mid-session reload.
        void registration.update().catch(() => undefined);

        // Periodically check for updates (every hour)
        setInterval(() => {
          void registration.update().catch(() => undefined);
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
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', register, { once: true });
  } else {
    register();
  }
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
