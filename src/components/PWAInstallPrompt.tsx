import { useState, useEffect, useCallback } from 'react';

interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
  prompt(): Promise<void>;
}

declare global {
  interface WindowEventMap {
    beforeinstallprompt: BeforeInstallPromptEvent;
    appinstalled: Event;
  }
}

export function PWAInstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [showPrompt, setShowPrompt] = useState(false);
  const [isInstalled, setIsInstalled] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  // Check if already in standalone mode
  useEffect(() => {
    if (
      window.matchMedia('(display-mode: standalone)').matches ||
      (window.navigator as unknown as { standalone?: boolean }).standalone === true
    ) {
      setIsInstalled(true);
    }
  }, []);

  // Listen for install prompt
  useEffect(() => {
    const handler = (e: BeforeInstallPromptEvent) => {
      e.preventDefault();
      setDeferredPrompt(e);
      // Show prompt after a delay if not dismissed
      const timer = setTimeout(() => {
        if (!dismissed && !isInstalled) {
          setShowPrompt(true);
        }
      }, 30000); // Show after 30 seconds
      return () => clearTimeout(timer);
    };

    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, [dismissed, isInstalled]);

  // Listen for successful install
  useEffect(() => {
    const handler = () => {
      setIsInstalled(true);
      setShowPrompt(false);
      setDeferredPrompt(null);
    };
    window.addEventListener('appinstalled', handler);
    return () => window.removeEventListener('appinstalled', handler);
  }, []);

  const handleInstall = useCallback(async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') {
      setIsInstalled(true);
    }
    setDeferredPrompt(null);
    setShowPrompt(false);
  }, [deferredPrompt]);

  const handleDismiss = useCallback(() => {
    setShowPrompt(false);
    setDismissed(true);
    // Re-enable after 7 days
    setTimeout(() => setDismissed(false), 7 * 24 * 60 * 60 * 1000);
  }, []);

  if (!showPrompt || isInstalled) return null;

  return (
    <div className="fixed bottom-4 left-4 right-4 z-50 max-w-sm mx-auto animate-slide-up">
      <div className="card p-4 border-border-bright shadow-lg">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-navy-4 flex items-center justify-center flex-shrink-0">
            <svg width="24" height="24" viewBox="0 0 512 512" fill="none" xmlns="http://www.w3.org/2000/svg">
              <rect width="512" height="512" rx="112" fill="#DDE3FF"/>
              <path d="M269 267C310 250 344 266 353 301C361 343 326 373 288 363C258 351 239 314 269 267Z" fill="#4A6B9E"/>
              <path d="M289 287C312 276 335 291 337 315C340 338 318 354 294 346C275 338 269 308 289 287Z" fill="#3A5680" opacity="0.6"/>
              <ellipse cx="252" cy="315" rx="86" ry="70" fill="white"/>
              <circle cx="191" cy="225" r="55" fill="white"/>
              <path d="M183 203C206 203 207 222 198 232C189 241 171 235 171 219C171 209 176 203 183 203Z" fill="#1A2438"/>
              <circle cx="195" cy="214" r="6" fill="white"/>
              <path d="M143 232L99 248L143 264Z" fill="#D4A05A"/>
              <path d="M143 232L99 248L143 264Z" stroke="#B88540" stroke-width="3"/>
              <path d="M211 263C226 200 281 190 310 217C321 233 313 256 288 267C250 283 211 285 211 263Z" fill="white"/>
              <path d="M225 263C244 221 281 207 300 231" stroke="#D0D8E8" stroke-width="6" stroke-linecap="round"/>
              <ellipse cx="274" cy="340" rx="54" ry="39" fill="#E8EDF5" opacity="0.6"/>
              <rect x="239" y="373" width="17" height="34" rx="5" fill="#4A6B9E"/>
              <path d="M231 407H264L247 418Z" fill="#3A5680"/>
              <ellipse cx="286" cy="389" rx="14" ry="9" fill="#3A5680" opacity="0.4"/>
            </svg>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold text-peri">Install Full Circle</p>
            <p className="text-xs text-peri-dim mt-0.5">Add to your home screen for quick access</p>
          </div>
        </div>
        <div className="flex items-center gap-2 mt-3">
          <button
            onClick={handleInstall}
            className="flex-1 btn-primary text-sm py-2"
          >
            Install
          </button>
          <button
            onClick={handleDismiss}
            className="btn-ghost text-sm py-2"
          >
            Not now
          </button>
        </div>
      </div>
    </div>
  );
}