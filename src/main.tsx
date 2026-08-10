import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import { AuthProvider } from './context/AuthContext.tsx';
import { registerServiceWorker } from './registerServiceWorker.ts';
import { AppErrorBoundary } from './components/AppErrorBoundary.tsx';
import { recoverFromStaleBundle } from './lib/staleBundleRecovery.ts';
import './index.css';

// Vite reports a missing lazy-loaded chunk before React renders its error boundary.
// A single quiet retry picks up the current deployment instead of showing an error page.
window.addEventListener('vite:preloadError', (event) => {
  event.preventDefault();
  recoverFromStaleBundle((event as Event & { payload?: unknown }).payload);
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppErrorBoundary>
      <AuthProvider>
        <App />
      </AuthProvider>
    </AppErrorBoundary>
  </StrictMode>
);

registerServiceWorker();
