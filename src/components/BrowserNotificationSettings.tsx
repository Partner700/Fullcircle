import { useEffect, useState } from 'react';
import { Bell, BellRing, Loader2 } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { enableWebPush, getCurrentPushSubscription, isInstalledApp, isIOSDevice, supportsWebPush } from '../lib/pushNotifications';

const ENABLED_KEY = 'full-circle-browser-notifications-enabled';

/** Device notification permission and durable Web Push subscription. */
export function BrowserNotificationSettings() {
  const [permission, setPermission] = useState<NotificationPermission | 'unsupported'>('default');
  const [subscribed, setSubscribed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!supportsWebPush()) {
      setPermission('unsupported');
      return;
    }
    setPermission(Notification.permission);
    void getCurrentPushSubscription().then((subscription) => setSubscribed(Boolean(subscription))).catch(() => setSubscribed(false));
  }, []);

  const enable = async () => {
    if (!supportsWebPush()) {
      setMessage(isIOSDevice() && !isInstalledApp()
        ? 'Install Full Circle from Safari first. Notifications become available inside the installed app.'
        : 'Notifications are not supported by this browser.');
      return;
    }
    setSaving(true);
    setMessage('');
    try {
      await enableWebPush();
      setPermission(Notification.permission);
      setSubscribed(true);
    } catch (error) {
      setPermission('Notification' in window ? Notification.permission : 'unsupported');
      setMessage(error instanceof Error ? error.message : 'Notifications could not be enabled.');
      setSaving(false);
      return;
    }

    localStorage.setItem(ENABLED_KEY, 'true');
    try {
      const { data, error } = await supabase.rpc('enable_browser_notifications');
      if (error) throw error;
      const reward = Boolean((data as { reward_granted?: boolean } | null)?.reward_granted);
      setMessage(reward ? 'Notifications enabled. 50 Denarii has been added to your account.' : 'Notifications enabled.');
    } catch {
      // Permission is still useful for foreground and future push messages even if the optional reward RPC is not deployed yet.
      setMessage('Notifications enabled.');
    }

    try {
      const registration = await navigator.serviceWorker?.ready;
      if (registration) {
        await registration.showNotification('Full Circle notifications are on', {
          body: 'You will hear from us when something needs your attention.',
          icon: '/icons/icon-192.png',
          badge: '/icons/icon-96.png',
          tag: 'full-circle-notification-confirmation',
        });
      }
    } catch { /* A visible confirmation is optional; permission remains enabled. */ }
    setSaving(false);
  };

  const enabled = permission === 'granted' && subscribed;
  const needsIOSInstall = isIOSDevice() && !isInstalledApp();
  return (
    <div className="card p-5 animate-slide-up">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-peri-soft text-peri">
          {enabled ? <BellRing size={19} /> : <Bell size={19} />}
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="font-display text-base font-semibold text-ink">Device Notifications</h3>
          <p className="mt-1 text-xs leading-relaxed text-stone">Receive reminders, tent messages, awards, and quiz updates even when Full Circle is closed.</p>
          {enabled ? (
            <p className="mt-3 text-xs font-semibold text-sage">Notifications are on for this device.</p>
          ) : (
            <button onClick={enable} disabled={saving || permission === 'denied' || needsIOSInstall} className="btn-primary mt-3 text-sm">
              {saving ? <Loader2 size={15} className="animate-spin" /> : <Bell size={15} />}
              Turn On Notifications
            </button>
          )}
          {needsIOSInstall && <p className="mt-3 text-xs font-semibold text-brass">On iPhone: open this site in Safari, tap Share, choose Add to Home Screen, then enable notifications from the installed app.</p>}
          {permission === 'denied' && <p className="mt-3 text-xs text-coral">Allow notifications for Full Circle from your browser settings, then return here.</p>}
          {message && <p className="mt-2 text-xs text-peri-dim">{message}</p>}
        </div>
      </div>
    </div>
  );
}
