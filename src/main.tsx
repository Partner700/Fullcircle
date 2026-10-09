import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import { AuthProvider } from './context/AuthContext.tsx';
import { MessagingProvider } from './context/MessagingContext.tsx';
import { registerServiceWorker } from './registerServiceWorker.ts';
import { AppErrorBoundary } from './components/AppErrorBoundary.tsx';
import { recoverFromStaleBundle } from './lib/staleBundleRecovery.ts';
import { prepareFreshReleaseCache } from './lib/releaseCache.ts';
import './index.css';

type FullCircleBootWindow = Window & {
  __fullCircleBootWatchdog?: number;
  __fullCircleStylesReady?: boolean;
  __showFullCircleRecovery?: () => void;
};

const RELEASE_STYLE_MARKER = '180';
const bootWindow = window as FullCircleBootWindow;
const appRoot = document.getElementById('root')!;
let appMounted = false;

prepareFreshReleaseCache();

// Vite reports a missing lazy-loaded chunk before React renders its error boundary.
// A single quiet retry picks up the current deployment instead of showing an error page.
window.addEventListener('vite:preloadError', (event) => {
  if (recoverFromStaleBundle('vite:preloadError')) event.preventDefault();
});

window.addEventListener('error', (event) => {
  recoverFromStaleBundle(event.error || event.message);
});

window.addEventListener('unhandledrejection', (event) => {
  if (recoverFromStaleBundle(event.reason)) event.preventDefault();
});

function releaseStylesAreReady() {
  if (import.meta.env.DEV) return true;
  const marker = window.getComputedStyle(document.documentElement)
    .getPropertyValue('--full-circle-release-style')
    .replace(/["']/g, '')
    .trim();
  return bootWindow.__fullCircleStylesReady === true && marker === RELEASE_STYLE_MARKER;
}

function mountFullCircle() {
  if (appMounted || !releaseStylesAreReady()) return;
  appMounted = true;
  if (bootWindow.__fullCircleBootWatchdog !== undefined) {
    window.clearTimeout(bootWindow.__fullCircleBootWatchdog);
  }
  appRoot.dataset.fcAppMounted = 'true';
  createRoot(appRoot).render(
    <StrictMode>
      <AppErrorBoundary>
        <AuthProvider>
          <AppErrorBoundary>
            <MessagingProvider>
              <App />
            </MessagingProvider>
          </AppErrorBoundary>
        </AuthProvider>
      </AppErrorBoundary>
    </StrictMode>,
  );
  registerServiceWorker();
}

if (releaseStylesAreReady()) {
  mountFullCircle();
} else {
  window.addEventListener('fullcircle:styles-ready', mountFullCircle, { once: true });
  window.setTimeout(() => {
    if (!appMounted) bootWindow.__showFullCircleRecovery?.();
  }, 24_000);
}
