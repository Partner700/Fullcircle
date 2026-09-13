import { useEffect, useState } from 'react';
import { BellRing, Loader2, X } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import {
  enableWebPush,
  isInstalledApp,
  isIOSDevice,
  supportsWebPush,
  syncExistingWebPush,
} from '../lib/pushNotifications';

const DISMISSED_KEY = 'full-circle-background-alert-prompt-dismissed';
const ONE_DAY = 24 * 60 * 60 * 1000;

function recentlyDismissed() {
  try { return Date.now() - Number(window.localStorage.getItem(DISMISSED_KEY) || 0) < ONE_DAY; }
  catch { return false; }
}

export function BackgroundAlertPrompt() {
  const { profile } = useAuth();
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!profile?.id || recentlyDismissed() || !supportsWebPush()) return;
    if (isIOSDevice() && !isInstalledApp()) return;
    let active = true;
    const timer = window.setTimeout(() => {
      if (Notification.permission === 'denied') return;
      if (Notification.permission === 'default') {
        if (active) setVisible(true);
        return;
      }
      void syncExistingWebPush()
        .then((subscription) => { if (active) setVisible(!subscription); })
        .catch(() => { if (active) { setMessage('Background alerts need repair on this phone.'); setVisible(true); } });
    }, 1_800);
    return () => { active = false; window.clearTimeout(timer); };
  }, [profile?.id]);

  const dismiss = () => {
    try { window.localStorage.setItem(DISMISSED_KEY, String(Date.now())); } catch { /* Session dismissal still applies. */ }
    setVisible(false);
  };

  const enable = async () => {
    setBusy(true);
    setMessage('');
    try {
      await enableWebPush();
      try { window.localStorage.setItem('full-circle-browser-notifications-enabled', 'true'); } catch { /* Permission remains enabled. */ }
      setVisible(false);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Background alerts could not be enabled.');
    } finally {
      setBusy(false);
    }
  };

  if (!visible) return null;
  return (
    <aside className="fixed bottom-4 left-1/2 z-[1000] w-[min(92vw,25rem)] -translate-x-1/2 rounded-lg border border-peri/45 bg-surface/96 p-3 shadow-2xl backdrop-blur-xl" role="status">
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-peri/15 text-peri"><BellRing size={19} /></span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold text-ink">Enable alarms and calls</p>
          <p className="mt-0.5 text-xs leading-relaxed text-stone">Allow Full Circle to reach this phone while the app is closed.</p>
          {message && <p className="mt-1 text-xs font-semibold text-coral">{message}</p>}
          <button type="button" onClick={() => void enable()} disabled={busy} className="btn-primary mt-2 px-3 py-1.5 text-xs">
            {busy ? <Loader2 size={14} className="animate-spin" /> : <BellRing size={14} />} Turn on
          </button>
        </div>
        <button type="button" onClick={dismiss} className="icon-btn h-8 w-8 shrink-0" aria-label="Dismiss background alert setup"><X size={15} /></button>
      </div>
    </aside>
  );
}
