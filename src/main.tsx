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

const bootWindow = window as Window & { __fullCircleBootWatchdog?: number };
if (bootWindow.__fullCircleBootWatchdog !== undefined) {
  window.clearTimeout(bootWindow.__fullCircleBootWatchdog);
}

prepareFreshReleaseCache();

// Vite reports a missing lazy-loaded chunk before React renders its error boundary.
// A single quiet retry picks up the current deployment instead of showing an error page.
window.addEventListener('vite:preloadError', (event) => {
  event.preventDefault();
  recoverFromStaleBundle((event as Event & { payload?: unknown }).payload);
});

window.addEventListener('error', (event) => {
  recoverFromStaleBundle(event.error || event.message);
});

window.addEventListener('unhandledrejection', (event) => {
  if (recoverFromStaleBundle(event.reason)) event.preventDefault();
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppErrorBoundary>
      <AuthProvider>
        <MessagingProvider>
          <App />
        </MessagingProvider>
      </AuthProvider>
    </AppErrorBoundary>
  </StrictMode>
);

registerServiceWorker();
