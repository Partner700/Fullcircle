import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Flame, Gift, Sparkles, X } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { fetchUnreadFoundersGiftNotification, markNotificationRead } from '../lib/queries';
import { supabase } from '../lib/supabase';
import type { UserNotification } from '../lib/types';

const GIFT_KEY = 'first_fcx_founders_gift_2026';

function isFoundersGift(notification: UserNotification) {
  return notification.metadata?.gift_key === GIFT_KEY && notification.read_at === null;
}

export function FoundersGiftPopup() {
  const { profile } = useAuth();
  const [notification, setNotification] = useState<UserNotification | null>(null);

  const load = useCallback(async () => {
    if (!profile) {
      setNotification(null);
      return;
    }
    try {
      setNotification(await fetchUnreadFoundersGiftNotification(profile.id));
    } catch (error) {
      console.warn('Founder gift notice is waiting to reconnect:', error);
    }
  }, [profile]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (!profile) return;
    const channel = supabase
      .channel(`founders_gift_${profile.id}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'user_notifications', filter: `recipient_id=eq.${profile.id}` },
        (payload) => {
          const incoming = payload.new as UserNotification;
          if (isFoundersGift(incoming)) setNotification(incoming);
        },
      )
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [profile]);

  if (!notification || typeof document === 'undefined') return null;

  const restoredStreak = Number(notification.metadata?.restored_streak || 0);
  const close = async () => {
    const id = notification.id;
    setNotification(null);
    await markNotificationRead(id).catch(() => void load());
  };

  return createPortal(
    <div className="fixed inset-0 z-[240] flex items-center justify-center bg-ink/55 p-4" role="dialog" aria-modal="true" aria-labelledby="founders-gift-title">
      <div className="relative w-full max-w-sm overflow-hidden rounded-xl border-2 border-brass/55 bg-surface/95 px-6 py-7 text-center shadow-2xl backdrop-blur-xl animate-scale-in">
        {Array.from({ length: 22 }, (_, index) => (
          <span
            key={index}
            className="animate-confetti-fall absolute top-0 h-2 w-1.5 rounded-full"
            style={{
              left: `${5 + ((index * 41) % 90)}%`,
              animationDelay: `${(index % 7) * 65}ms`,
              backgroundColor: ['#e8b958', '#dc6a6a', '#6fbf92', '#8896cc'][index % 4],
            }}
          />
        ))}
        <button type="button" onClick={() => void close()} aria-label="Close Founder gift" className="absolute right-3 top-3 flex h-8 w-8 items-center justify-center rounded-full text-stone transition-colors hover:bg-surface-2 hover:text-ink">
          <X size={17} />
        </button>
        <span className="mx-auto flex h-16 w-16 items-center justify-center rounded-full border border-brass/40 bg-brass/10 text-brass shadow-lg">
          <Gift size={31} />
        </span>
        <p className="mt-4 flex items-center justify-center gap-1.5 text-[11px] font-black uppercase text-brass">
          <Sparkles size={14} /> First FCX
        </p>
        <h2 id="founders-gift-title" className="mt-1 font-display text-2xl font-bold text-ink">Founder&apos;s Gift</h2>
        <p className="mt-3 text-sm leading-relaxed text-stone">{notification.body}</p>
        {restoredStreak > 0 && (
          <div className="mx-auto mt-5 inline-flex items-center gap-2 rounded-full border border-coral/35 bg-coral/10 px-4 py-2 text-coral">
            <Flame size={19} fill="currentColor" />
            <strong className="text-sm tabular-nums">{restoredStreak} day streak</strong>
          </div>
        )}
        <button type="button" onClick={() => void close()} className="btn-primary mt-6 w-full justify-center">
          Continue
        </button>
      </div>
    </div>,
    document.body,
  );
}

