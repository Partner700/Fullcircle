import { useCallback, useEffect, useRef, useState } from 'react';
import { Share, PlusSquare, X } from 'lucide-react';
import { Dove } from './Dove';

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

const SESSION_KEY = 'pwa_install_prompt_seen';

function isStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches
    || (window.navigator as Navigator & { standalone?: boolean }).standalone === true;
}

function isIOSDevice() {
  const { userAgent, platform, maxTouchPoints } = navigator;
  return /iPad|iPhone|iPod/.test(userAgent) || (platform === 'MacIntel' && maxTouchPoints > 1);
}

function isIOSSafari() {
  return isIOSDevice() && /Safari/.test(navigator.userAgent) && !/CriOS|FxiOS|EdgiOS|OPiOS/.test(navigator.userAgent);
}

/** A single install surface for Chromium's native prompt and Safari's Home Screen guide. */
export function PWAInstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [visible, setVisible] = useState(false);
  const [installed, setInstalled] = useState(false);
  const [iosGuide, setIosGuide] = useState(false);
  const installButtonRef = useRef<HTMLButtonElement>(null);

  const canShow = useCallback(() => !isStandalone()
    && !window.sessionStorage.getItem(SESSION_KEY), []);

  const showSoon = useCallback(() => {
    if (!canShow()) return;
    window.setTimeout(() => {
      if (canShow() && !isStandalone()) {
        window.sessionStorage.setItem(SESSION_KEY, '1');
        setVisible(true);
      }
    }, 2600);
  }, [canShow]);

  useEffect(() => {
    setInstalled(isStandalone());
    if (!isStandalone() && isIOSDevice()) showSoon();
  }, [showSoon]);

  useEffect(() => {
    const handlePrompt = (event: BeforeInstallPromptEvent) => {
      event.preventDefault();
      setDeferredPrompt(event);
      if (!isStandalone()) showSoon();
    };
    window.addEventListener('beforeinstallprompt', handlePrompt);
    return () => window.removeEventListener('beforeinstallprompt', handlePrompt);
  }, [showSoon]);

  useEffect(() => {
    const handleInstalled = () => {
      window.localStorage.setItem('pwa_install_completed', String(Date.now()));
      setInstalled(true);
      setVisible(false);
      setDeferredPrompt(null);
    };
    window.addEventListener('appinstalled', handleInstalled);
    return () => window.removeEventListener('appinstalled', handleInstalled);
  }, []);

  useEffect(() => {
    if (!visible) return;
    installButtonRef.current?.focus();
    const handleKeydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') dismiss();
    };
    window.addEventListener('keydown', handleKeydown);
    return () => window.removeEventListener('keydown', handleKeydown);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const dismiss = useCallback(() => {
    setVisible(false);
    setIosGuide(false);
  }, []);

  const install = useCallback(async () => {
    if (isIOSDevice()) {
      setIosGuide(true);
      return;
    }
    if (!deferredPrompt) return;
    await deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    setDeferredPrompt(null);
    setVisible(false);
    if (outcome === 'accepted') window.localStorage.setItem('pwa_install_completed', String(Date.now()));
  }, [deferredPrompt]);

  if (!visible || installed || (!deferredPrompt && !isIOSDevice())) return null;

  return (
    <div className="fixed inset-0 z-[120] flex items-end justify-center bg-black/45 p-3 sm:items-center" role="presentation">
      <section className="card w-full max-w-sm border-border-bright p-5 shadow-2xl animate-slide-up" role="dialog" aria-modal="true" aria-labelledby="install-app-title">
        <button onClick={dismiss} className="absolute right-4 top-4 inline-flex h-8 w-8 items-center justify-center rounded-full text-stone hover:bg-surface-2 hover:text-ink" aria-label="Close install prompt">
          <X size={17} />
        </button>
        <div className="flex items-center gap-3 pr-8">
          <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-navy-3">
            <Dove size={42} />
          </div>
          <div>
            <h2 id="install-app-title" className="font-display text-xl font-bold text-ink">Install the App</h2>
            <p className="mt-0.5 text-sm text-stone">Faster, easier access from your device.</p>
          </div>
        </div>

        {iosGuide ? (
          <div className="mt-5 space-y-3 text-sm text-ink">
            <p className="font-semibold">Install this app on your iPhone or iPad:</p>
            <ol className="space-y-2 text-stone">
              {!isIOSSafari() && <li className="rounded-lg border border-brass/30 bg-brass/10 p-3 font-semibold text-ink">First open this website in Safari. Installation from WhatsApp, Instagram, Facebook, or another in-app browser may not be available.</li>}
              <li className="flex gap-2"><Share size={17} className="mt-0.5 flex-shrink-0 text-brass" /> In Safari, tap the Share button.</li>
              <li className="flex gap-2"><PlusSquare size={17} className="mt-0.5 flex-shrink-0 text-brass" /> Select <span className="font-semibold text-ink">Add to Home Screen</span>.</li>
              <li className="pl-6">Tap <span className="font-semibold text-ink">Add</span>.</li>
            </ol>
            <p className="rounded-lg border border-border bg-surface-2 p-3 text-xs text-stone">
              If Add to Home Screen is hidden, scroll down in the Share menu and choose <span className="font-semibold text-ink">Edit Actions</span>. Full Circle opens without Safari bars after installation.
            </p>
            <button onClick={dismiss} className="btn-primary mt-2 w-full">Done</button>
          </div>
        ) : (
          <div className="mt-5 flex gap-2">
            <button ref={installButtonRef} onClick={install} className="btn-primary flex-1 text-sm">Install App</button>
            <button onClick={dismiss} className="btn-ghost px-4 text-sm">Not Now</button>
          </div>
        )}
      </section>
    </div>
  );
}
