export function registerServiceWorker() {
  if (!('serviceWorker' in navigator) || import.meta.env.DEV) return;

  let refreshing = false;

  // Handle service worker updates - this fires when SKIP_WAITING is sent
  // and the new SW takes control. The PWAUpdateNotification component
  // triggers this via user action ("Refresh Now").
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (refreshing) return;
    refreshing = true;
    // Reload to get new content from the updated service worker
    window.location.reload();
  });

  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/sw.js')
      .then((registration) => {
        // Check for updates on page load
        registration.update();

        // Periodically check for updates (every hour)
        setInterval(() => {
          registration.update();
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