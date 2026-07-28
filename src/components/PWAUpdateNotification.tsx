import { useState, useEffect, useCallback } from 'react';
import { RefreshCw, X } from 'lucide-react';

interface PWAUpdateNotificationState {
  show: boolean;
  registration: ServiceWorkerRegistration | null;
}

export function PWAUpdateNotification() {
  const [state, setState] = useState<PWAUpdateNotificationState>({
    show: false,
    registration: null,
  });
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;

    let hideTimeout: ReturnType<typeof setTimeout>;

    const handleStateChange = (
      registration: ServiceWorkerRegistration,
      worker: ServiceWorker,
    ) => {
      worker.addEventListener('statechange', () => {
        if (worker.state === 'installed' && navigator.serviceWorker.controller) {
          // New version available - show notification after brief delay
          // to avoid flashing during initial install
          hideTimeout = setTimeout(() => {
            setState({ show: true, registration });
          }, 2000);
        }
      });
    };

    // Watch for updates on the active registration
    navigator.serviceWorker.ready.then((registration) => {
      // Check if there's already a waiting worker
      if (registration.waiting && navigator.serviceWorker.controller) {
        hideTimeout = setTimeout(() => {
          setState({ show: true, registration });
        }, 2000);
      }

      // Listen for new updates
      registration.addEventListener('updatefound', () => {
        const worker = registration.installing;
        if (worker) {
          handleStateChange(registration, worker);
        }
      });
    });

    // Listen for controller change to detect updates via periodic checks
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      // A new SW has taken over, reload to get fresh content
      window.location.reload();
    });

    return () => {
      clearTimeout(hideTimeout);
    };
  }, []);

  const handleRefresh = useCallback(async () => {
    const { registration } = state;
    if (!registration || !registration.waiting) return;

    // Send SKIP_WAITING message to activate the new service worker
    registration.waiting.postMessage({ type: 'SKIP_WAITING' });

    // The controllerchange event will trigger the reload
    // But as a fallback, reload after a timeout
    setTimeout(() => {
      window.location.reload();
    }, 1000);
  }, [state]);

  const handleDismiss = useCallback(() => {
    setState((prev) => ({ ...prev, show: false }));
    setDismissed(true);

    // Re-enable detection after 24 hours
    setTimeout(() => {
      setDismissed(false);
    }, 24 * 60 * 60 * 1000);
  }, []);

  if (!state.show || dismissed) return null;

  return (
    <div className="fixed top-4 left-4 right-4 z-50 max-w-md mx-auto animate-slide-up">
      <div className="card p-4 border-peri/30 bg-navy-2 shadow-xl shadow-ink/20">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-peri-soft flex items-center justify-center flex-shrink-0">
            <RefreshCw size={20} className="text-peri" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold text-peri">Update Available</p>
            <p className="text-xs text-peri-dim mt-0.5 leading-relaxed">
              A new version of the app is available. Refresh to get the latest features and improvements.
            </p>
          </div>
          <button
            onClick={handleDismiss}
            className="flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center text-peri-dim hover:text-peri hover:bg-navy-3 transition-colors"
            aria-label="Dismiss update notification"
          >
            <X size={16} />
          </button>
        </div>
        <div className="flex items-center gap-2 mt-3">
          <button
            onClick={handleRefresh}
            className="flex-1 btn-primary text-sm py-2.5"
          >
            <RefreshCw size={16} />
            Refresh Now
          </button>
          <button
            onClick={handleDismiss}
            className="btn-ghost text-sm py-2.5"
          >
            Later
          </button>
        </div>
      </div>
    </div>
  );
}