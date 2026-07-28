import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import { AuthProvider } from './context/AuthContext.tsx';
<<<<<<< HEAD
import { registerServiceWorker } from './registerServiceWorker.ts';
=======
import { AppErrorBoundary } from './components/AppErrorBoundary.tsx';
>>>>>>> 2efd354e1e3e325fe8d80f8c7607cb248656885f
import './index.css';

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
