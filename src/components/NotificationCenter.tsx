import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, Bell, CheckCheck, CheckCircle2, Loader2, MessageCircle } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { fetchUserNotifications, markAllNotificationsRead, markNotificationRead } from '../lib/queries';
import { supabase } from '../lib/supabase';
import { playNotificationSound } from '../lib/soundscape';
import { DoveMark } from './Dove';
import type { UserNotification } from '../lib/types';
import { scriptureTargetFromMetadata, scriptureTargetUrl, storeScriptureTarget } from '../lib/scriptureNavigation';
import { useSubscriptionAccess } from '../context/SubscriptionAccessContext';
import { publicAsset } from '../lib/publicAsset';
import { isDoveArrival } from '../lib/notificationArrival';

const DEVICE_NOTIFICATIONS_KEY = 'full-circle-browser-notifications-enabled';

type Props = { onNavigate?: (actionKey: string, metadata?: Record<string, unknown>) => void };

function notificationTone(notification: UserNotification) {
  const status = String(notification.metadata?.status || '').toLowerCase();
  if (notification.notification_type === 'payment' && ['rejected', 'failed', 'cancelled'].includes(status)) return 'warning';
  if (['payment', 'purchase', 'relic', 'economy', 'award'].includes(notification.notification_type)) return 'success';
  return 'info';
}

function notificationSymbol(type: string) {
  const key = String(type || '').toLowerCase();
  if (['message', 'direct_message', 'message_mention'].includes(key)) return publicAsset('notification-symbols/message.svg');
  if (key === 'award') return publicAsset('notification-symbols/award.svg');
  if (key === 'arena' || key.startsWith('arena_')) return publicAsset('notification-symbols/arena.svg');
  if (key === 'streak') return publicAsset('notification-symbols/streak.svg');
  if (['relic', 'reward', 'treasure'].includes(key)) return publicAsset('notification-symbols/relic.svg');
  if (['payment', 'purchase', 'economy'].includes(key)) return publicAsset('notification-symbols/payment.svg');
  if (['challenge', 'dove_question', 'mine', 'quiz', 'quiz_release', 'weekly_quiz_reminder'].includes(key)) return publicAsset('notification-symbols/challenge.svg');
  return publicAsset('notification-symbols/reading.svg');
}

function isProtectedMessageNotification(notification: UserNotification) {
  return ['message', 'direct_message', 'message_mention'].includes(
    String(notification.notification_type || '').toLowerCase(),
  );
}

async function showDeviceNotification(notification: UserNotification) {
  if (typeof window === 'undefined' || !('Notification' in window) || Notification.permission !== 'granted') return;
  try {
    if (window.localStorage.getItem(DEVICE_NOTIFICATIONS_KEY) !== 'true') return;
  } catch {
    return;
  }
  const options = {
    body: notification.body || 'You have a new update.',
    icon: publicAsset('icons/icon-192.png'),
    badge: publicAsset('icons/icon-96.png'),
    image: notificationSymbol(notification.notification_type),
    tag: `full-circle-${notification.id}`,
    data: { url: scriptureTargetUrl(notification.action_key, notification.metadata) },
  };
  try {
    const registration = await navigator.serviceWorker?.ready;
    if (registration) await registration.showNotification(notification.title || 'Full Circle', options);
    else new Notification(notification.title || 'Full Circle', options);
  } catch {
    // The in-app centre remains available when a browser blocks a toast.
  }
}

/** A role-neutral, resilient notification bell backed by public.user_notifications. */
export function NotificationCenter({ onNavigate }: Props) {
  const { profile } = useAuth();
  const { requireSubscription } = useSubscriptionAccess();
  const [notifications, setNotifications] = useState<UserNotification[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<UserNotification | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    if (!profile) { setNotifications([]); setLoading(false); return; }
    try { setNotifications(await fetchUserNotifications(profile.id, 30)); } catch { /* keep the last successful list */ } finally { setLoading(false); }
  }, [profile]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (!profile) return;
    const refreshWhenVisible = () => { if (document.visibilityState === 'visible') void load(); };
    const interval = window.setInterval(refreshWhenVisible, 30_000);
    window.addEventListener('focus', refreshWhenVisible);
    document.addEventListener('visibilitychange', refreshWhenVisible);
    return () => { window.clearInterval(interval); window.removeEventListener('focus', refreshWhenVisible); document.removeEventListener('visibilitychange', refreshWhenVisible); };
  }, [load, profile]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 6500);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    if (!profile) return;
    const channel = supabase.channel(`notification_center_${profile.id}`).on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'user_notifications', filter: `recipient_id=eq.${profile.id}` },
      (payload) => {
        if (payload.eventType === 'INSERT') {
          const notification = payload.new as UserNotification;
          if (!isDoveArrival(notification)) setToast(notification);
          void showDeviceNotification(notification);
          void playNotificationSound(notification.notification_type, String(notification.metadata?.status || ''));
        }
        void load();
      },
    ).subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [load, profile]);

  useEffect(() => {
    if (!open) return;
    const closeOnOutsideClick = (event: MouseEvent) => { if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false); };
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', closeOnOutsideClick);
    document.addEventListener('keydown', closeOnEscape);
    return () => { document.removeEventListener('mousedown', closeOnOutsideClick); document.removeEventListener('keydown', closeOnEscape); };
  }, [open]);

  const markRead = async (notification: UserNotification, navigate = false) => {
    if (navigate && isProtectedMessageNotification(notification) && !requireSubscription()) {
      setOpen(false);
      setToast(null);
      return;
    }
    if (!notification.read_at) {
      setNotifications((current) => current.map((item) => item.id === notification.id ? { ...item, read_at: new Date().toISOString() } : item));
      await markNotificationRead(notification.id).catch(() => void load());
    }
    if (navigate && notification.action_key && onNavigate) {
      storeScriptureTarget(scriptureTargetFromMetadata(notification.metadata));
      onNavigate(notification.action_key, notification.metadata);
      setOpen(false);
    }
  };

  const markAllRead = async () => {
    if (!profile || !notifications.some((notification) => !notification.read_at)) return;
    setNotifications((current) => current.map((item) => ({ ...item, read_at: item.read_at || new Date().toISOString() })));
    await markAllNotificationsRead(profile.id).catch(() => void load());
  };

  const unreadCount = notifications.filter((notification) => !notification.read_at).length;
  return (
    <div className="relative z-[70]" ref={rootRef}>
      {toast && (
        <button type="button" onClick={() => void markRead(toast, true)} className="fixed bottom-5 left-1/2 z-[160] flex w-[min(92vw,25rem)] -translate-x-1/2 items-center gap-3 rounded-2xl border border-border-bright bg-surface/95 px-3.5 py-3 text-left shadow-2xl backdrop-blur-md animate-slide-up">
          <DoveMark size={28} className="shrink-0" />
          <span className="min-w-0 flex-1"><strong className="block truncate text-xs font-bold text-ink">{toast.title}</strong><span className="mt-0.5 block truncate text-[11px] text-stone">{toast.body}</span></span>
          <img src={notificationSymbol(toast.notification_type)} alt="" className="h-7 w-7 shrink-0 rounded-full border border-border bg-surface-2 p-1.5" />
        </button>
      )}
      <button type="button" onClick={() => setOpen((shown) => !shown)} className="relative flex h-9 w-9 items-center justify-center rounded-full border border-border bg-surface-2 transition-colors hover:border-border-bright" aria-label={unreadCount ? `${unreadCount} unread notifications` : 'Notifications'} aria-expanded={open}>
        <Bell size={16} className="text-ink" />
        {unreadCount > 0 && <span className="notification-badge-ring absolute -right-0.5 -top-0.5 flex h-5 min-w-5 items-center justify-center rounded-full border-2 bg-coral px-1 text-[10px] font-bold text-white">{unreadCount > 9 ? '9+' : unreadCount}</span>}
      </button>
      {open && <><button type="button" aria-label="Close notifications" onClick={() => setOpen(false)} className="fixed inset-0 z-[80] cursor-default bg-ink/45" /><div className="fixed right-3 top-[7.1rem] z-[100] w-[calc(100vw-1.5rem)] max-w-sm overflow-hidden rounded-xl border border-border bg-surface shadow-2xl animate-fade-in md:absolute md:right-0 md:top-full md:mt-2 md:w-[22rem]">
        <div className="flex items-center justify-between gap-3 border-b border-border bg-surface-2 px-4 py-2.5"><div><span className="text-xs font-semibold text-ink">Notifications</span><p className="mt-0.5 text-[10px] text-stone">{unreadCount ? `${unreadCount} unread` : 'All read'}</p></div><button type="button" onClick={() => void markAllRead()} disabled={!unreadCount} className="inline-flex items-center gap-1.5 rounded-full border border-border-bright bg-surface px-2.5 py-1 text-[10px] font-bold text-ink transition-colors hover:border-sage/40 hover:text-sage disabled:cursor-not-allowed disabled:opacity-45"><CheckCheck size={12} /> Mark all as read</button></div>
        <div className="max-h-96 overflow-y-auto">
          {loading ? <div className="flex justify-center px-4 py-6"><Loader2 size={18} className="animate-spin text-peri" /></div> : notifications.length === 0 ? <div className="px-4 py-6 text-center text-xs text-stone">You're all caught up</div> : notifications.map((notification) => {
            const tone = notificationTone(notification);
            return <div key={notification.id} className={`flex gap-2.5 border-b border-border px-4 py-3 last:border-0 ${notification.read_at ? 'opacity-70' : ''}`}>
              {tone === 'success' ? <CheckCircle2 size={16} className="mt-0.5 flex-shrink-0 text-sage" /> : tone === 'warning' ? <AlertTriangle size={16} className="mt-0.5 flex-shrink-0 text-coral" /> : notification.notification_type === 'message' ? <MessageCircle size={16} className="mt-0.5 flex-shrink-0 text-royal" /> : <Bell size={16} className="mt-0.5 flex-shrink-0 text-royal" />}
              <div className="min-w-0 flex-1"><div className="flex items-start gap-2"><p className="text-xs font-semibold leading-snug text-ink">{notification.title}</p>{!notification.read_at && <span className="mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-coral" />}</div><p className="mt-0.5 text-xs leading-relaxed text-stone">{notification.body}</p>{(notification.action_key && onNavigate) ? <button type="button" onClick={() => void markRead(notification, true)} className="mt-2 inline-flex items-center gap-1 rounded-full border border-border-bright bg-surface-2 px-2.5 py-1 text-[10px] font-bold text-ink transition-colors hover:border-sage/40 hover:text-sage"><CheckCheck size={11} /> {notification.read_at ? 'Open' : 'Open and mark read'}</button> : !notification.read_at && <button type="button" onClick={() => void markRead(notification)} className="mt-2 inline-flex items-center gap-1 rounded-full border border-border-bright bg-surface-2 px-2.5 py-1 text-[10px] font-bold text-ink transition-colors hover:border-sage/40 hover:text-sage"><CheckCheck size={11} /> Mark as read</button>}</div>
            </div>;
          })}
        </div>
      </div></>}
    </div>
  );
}
