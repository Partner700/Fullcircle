import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, Bell, CheckCheck, CheckCircle2, Loader2, MessageCircle } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { fetchUserNotifications, markAllNotificationsRead, markNotificationRead } from '../lib/queries';
import { supabase } from '../lib/supabase';
import { playSoundEffect } from '../lib/soundscape';
import type { UserNotification } from '../lib/types';

const DEVICE_NOTIFICATIONS_KEY = 'full-circle-browser-notifications-enabled';

type Props = { onNavigate?: (actionKey: string) => void };

function notificationTone(notification: UserNotification) {
  const status = String(notification.metadata?.status || '').toLowerCase();
  if (notification.notification_type === 'payment' && ['rejected', 'failed', 'cancelled'].includes(status)) return 'warning';
  if (['payment', 'purchase', 'relic', 'economy', 'award'].includes(notification.notification_type)) return 'success';
  return 'info';
}

async function showDeviceNotification(notification: UserNotification) {
  if (typeof window === 'undefined' || !('Notification' in window) || Notification.permission !== 'granted') return;
  if (window.localStorage.getItem(DEVICE_NOTIFICATIONS_KEY) !== 'true') return;
  const options = { body: notification.body || 'You have a new update.', icon: '/icons/icon-192.png', badge: '/icons/icon-96.png', tag: `full-circle-${notification.id}`, data: { url: '/' } };
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
  const [notifications, setNotifications] = useState<UserNotification[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(true);
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
    if (!profile) return;
    const channel = supabase.channel(`notification_center_${profile.id}`).on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'user_notifications', filter: `recipient_id=eq.${profile.id}` },
      (payload) => {
        if (payload.eventType === 'INSERT') {
          const notification = payload.new as UserNotification;
          void showDeviceNotification(notification);
          // Purchases and awards already have their own intentional completion
          // feedback. A second generic notification sound makes the UI feel as
          // though the action fired twice.
          const quietlyHandledTypes = new Set(['payment', 'purchase', 'relic', 'economy', 'award']);
          if (!quietlyHandledTypes.has(notification.notification_type)) {
            void playSoundEffect(notification.notification_type === 'message' ? 'sound_message' : 'sound_notification', 0.62);
          }
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
    if (!notification.read_at) {
      setNotifications((current) => current.map((item) => item.id === notification.id ? { ...item, read_at: new Date().toISOString() } : item));
      await markNotificationRead(notification.id).catch(() => void load());
    }
    if (navigate && notification.action_key && onNavigate) { onNavigate(notification.action_key); setOpen(false); }
  };

  const markAllRead = async () => {
    if (!profile || !notifications.some((notification) => !notification.read_at)) return;
    setNotifications((current) => current.map((item) => ({ ...item, read_at: item.read_at || new Date().toISOString() })));
    await markAllNotificationsRead(profile.id).catch(() => void load());
  };

  const unreadCount = notifications.filter((notification) => !notification.read_at).length;
  return (
    <div className="relative z-[70]" ref={rootRef}>
      <button type="button" onClick={() => setOpen((shown) => !shown)} className="relative flex h-9 w-9 items-center justify-center rounded-full border border-border bg-surface-2 transition-colors hover:border-border-bright" aria-label={unreadCount ? `${unreadCount} unread notifications` : 'Notifications'} aria-expanded={open}>
        <Bell size={16} className="text-ink" />
        {unreadCount > 0 && <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-coral px-1 text-[10px] font-bold text-white">{unreadCount > 9 ? '9+' : unreadCount}</span>}
      </button>
      {open && <div className="fixed right-3 top-[7.1rem] z-[100] w-[calc(100vw-1.5rem)] max-w-sm overflow-hidden rounded-xl border border-border bg-surface shadow-2xl animate-fade-in md:absolute md:right-0 md:top-full md:mt-2 md:w-[22rem]">
        <div className="flex items-center justify-between gap-3 border-b border-border bg-surface-2 px-4 py-2.5"><div><span className="text-xs font-semibold text-ink">Notifications</span><p className="mt-0.5 text-[10px] text-stone">{unreadCount ? `${unreadCount} unread` : 'All read'}</p></div><button type="button" onClick={() => void markAllRead()} disabled={!unreadCount} className="inline-flex items-center gap-1.5 rounded-full border border-border-bright bg-surface px-2.5 py-1 text-[10px] font-bold text-ink transition-colors hover:border-sage/40 hover:text-sage disabled:cursor-not-allowed disabled:opacity-45"><CheckCheck size={12} /> Mark all as read</button></div>
        <div className="max-h-96 overflow-y-auto">
          {loading ? <div className="flex justify-center px-4 py-6"><Loader2 size={18} className="animate-spin text-peri" /></div> : notifications.length === 0 ? <div className="px-4 py-6 text-center text-xs text-stone">You're all caught up</div> : notifications.map((notification) => {
            const tone = notificationTone(notification);
            return <div key={notification.id} className={`flex gap-2.5 border-b border-border px-4 py-3 last:border-0 ${notification.read_at ? 'opacity-70' : ''}`}>
              {tone === 'success' ? <CheckCircle2 size={16} className="mt-0.5 flex-shrink-0 text-sage" /> : tone === 'warning' ? <AlertTriangle size={16} className="mt-0.5 flex-shrink-0 text-coral" /> : notification.notification_type === 'message' ? <MessageCircle size={16} className="mt-0.5 flex-shrink-0 text-royal" /> : <Bell size={16} className="mt-0.5 flex-shrink-0 text-royal" />}
              <div className="min-w-0 flex-1"><div className="flex items-start gap-2"><p className="text-xs font-semibold leading-snug text-ink">{notification.title}</p>{!notification.read_at && <span className="mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-coral" />}</div><p className="mt-0.5 text-xs leading-relaxed text-stone">{notification.body}</p>{!notification.read_at && <button type="button" onClick={() => void markRead(notification, Boolean(notification.action_key && onNavigate))} className="mt-2 inline-flex items-center gap-1 rounded-full border border-border-bright bg-surface-2 px-2.5 py-1 text-[10px] font-bold text-ink transition-colors hover:border-sage/40 hover:text-sage"><CheckCheck size={11} /> {notification.action_key && onNavigate ? 'Open and mark read' : 'Mark as read'}</button>}</div>
            </div>;
          })}
        </div>
      </div>}
    </div>
  );
}
