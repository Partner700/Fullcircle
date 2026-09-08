import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, FileQuestion, Loader2, Mail, ShieldQuestion, UserPlus, X } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { fetchCampMentionCandidates, fetchUserNotifications, markNotificationRead, reviewTentJoinRequest } from '../lib/queries';
import { supabase } from '../lib/supabase';
import type { Profile, UserNotification } from '../lib/types';
import { isDoveArrival, isMessageArrival, isQuizArrival, isTentJoinRequestArrival } from '../lib/notificationArrival';
import { Dove } from './Dove';
import { TentGroupMessenger, TentMessenger } from './TentMessenger';

type Props = {
  onNavigate: (actionKey: string, metadata?: Record<string, unknown>) => void;
};

function messageSenderId(notification: UserNotification) {
  return String(notification.metadata?.sender_id || notification.actor_id || '').trim();
}

function directMessageArrival(notification: UserNotification) {
  const sourceTable = String(notification.metadata?.source_table || '').toLowerCase();
  return String(notification.notification_type).toLowerCase() === 'direct_message'
    || sourceTable === 'direct_messages'
    || sourceTable === 'tent_messages';
}

export function DoveNotificationArrival({ onNavigate }: Props) {
  const { profile } = useAuth();
  const [arrival, setArrival] = useState<UserNotification | null>(null);
  const [opening, setOpening] = useState(false);
  const [reviewing, setReviewing] = useState<'accept' | 'reject' | null>(null);
  const [conversation, setConversation] = useState<{ recipient: Profile; tentId?: string } | null>(null);
  const [groupChat, setGroupChat] = useState<{ tentId: string; tentName: string } | null>(null);
  const surfacedRef = useRef(new Set<string>());
  const queuedRef = useRef<UserNotification[]>([]);

  const surface = useCallback((notification: UserNotification) => {
    if (!isDoveArrival(notification) || surfacedRef.current.has(notification.id)) return;
    surfacedRef.current.add(notification.id);
    setArrival((current) => {
      if (!current) return notification;
      queuedRef.current.push(notification);
      return current;
    });
  }, []);

  const advanceArrival = useCallback(() => {
    setArrival(queuedRef.current.shift() || null);
  }, []);

  useEffect(() => {
    if (!profile?.id) return;
    let active = true;
    const initial = window.setTimeout(() => {
      void fetchUserNotifications(profile.id, 20).then((notifications) => {
        if (!active) return;
        const recentBoundary = Date.now() - 48 * 60 * 60 * 1000;
        const latest = notifications.find((notification) => (
          !notification.read_at
          && isDoveArrival(notification)
          && new Date(notification.created_at).getTime() >= recentBoundary
        ));
        if (latest) surface(latest);
      }).catch(() => undefined);
    }, 900);

    const channel = supabase.channel(`dove_arrivals_${profile.id}`).on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'user_notifications', filter: `recipient_id=eq.${profile.id}` },
      (payload) => surface(payload.new as UserNotification),
    ).subscribe();

    return () => {
      active = false;
      window.clearTimeout(initial);
      void supabase.removeChannel(channel);
    };
  }, [profile?.id, surface]);

  useEffect(() => {
    if (!arrival || !isTentJoinRequestArrival(arrival) || !('vibrate' in navigator)) return;
    navigator.vibrate([700, 120, 700, 120, 900]);
    return () => { navigator.vibrate(0); };
  }, [arrival]);

  const reviewTentApplication = async (approve: boolean) => {
    if (!arrival || reviewing) return;
    const requestId = String(arrival.metadata?.request_id || '');
    if (!requestId) return;
    setReviewing(approve ? 'accept' : 'reject');
    try {
      await reviewTentJoinRequest(requestId, approve);
      await markNotificationRead(arrival.id).catch(() => undefined);
      advanceArrival();
      onNavigate('cadets', arrival.metadata);
    } catch (error) {
      window.alert(error instanceof Error ? error.message : 'This tent application could not be reviewed.');
    } finally {
      setReviewing(null);
    }
  };

  const openArrival = async () => {
    if (!arrival || !profile || opening) return;
    setOpening(true);
    await markNotificationRead(arrival.id).catch(() => undefined);

    try {
      if (isQuizArrival(arrival)) {
        advanceArrival();
        onNavigate('quiz', arrival.metadata);
        return;
      }

      if (isMessageArrival(arrival) && directMessageArrival(arrival)) {
        const senderId = messageSenderId(arrival);
        if (senderId) {
          const candidates = await fetchCampMentionCandidates().catch(() => []);
          const sender = candidates.find((candidate) => candidate.user_id === senderId);
          setConversation({
            recipient: {
              id: senderId,
              display_name: sender?.display_name || 'Full Circle member',
              email: null,
              avatar_url: sender?.avatar_url || null,
              whatsapp_number: null,
              created_at: arrival.created_at,
            },
            tentId: String(arrival.metadata?.source_table || '').toLowerCase() === 'tent_messages'
              ? String(arrival.metadata?.tent_id || '') || undefined
              : undefined,
          });
          advanceArrival();
          return;
        }
      }

      const tentId = String(arrival.metadata?.tent_id || '').trim();
      if (tentId) {
        setGroupChat({ tentId, tentName: arrival.title || 'Tent chat' });
        advanceArrival();
        return;
      }

      advanceArrival();
      onNavigate(arrival.action_key || 'tent', arrival.metadata);
    } finally {
      setOpening(false);
    }
  };

  const tentApplication = arrival ? isTentJoinRequestArrival(arrival) : false;
  const prompt = arrival && typeof document !== 'undefined' ? createPortal(
    <aside className="fixed bottom-5 left-1/2 z-[2147483200] w-[min(92vw,26rem)] -translate-x-1/2 overflow-hidden rounded-lg border border-peri/45 bg-surface/96 shadow-2xl backdrop-blur-xl animate-slide-up" role="status" aria-live="polite">
      <div className="flex w-full items-center gap-3 px-4 py-3 pr-12 text-left">
        <span className="relative flex h-16 w-16 shrink-0 items-center justify-center">
          <Dove size={62} className="animate-float" />
          <span className="absolute -bottom-0.5 -right-0.5 flex h-7 w-7 items-center justify-center rounded-full border-2 border-surface bg-peri text-white shadow-md">
            {tentApplication ? <UserPlus size={15} /> : isQuizArrival(arrival) ? <FileQuestion size={15} /> : <Mail size={15} />}
          </span>
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[10px] font-black uppercase text-peri">Delivered by the Dove</span>
          <strong className="mt-0.5 block text-sm font-bold text-ink">{arrival.title}</strong>
          <span className="mt-0.5 block line-clamp-2 text-xs leading-relaxed text-stone">{arrival.body}</span>
          {tentApplication ? (
            <span className="mt-2 flex flex-wrap gap-2">
              <button type="button" disabled={!!reviewing} onClick={() => void reviewTentApplication(true)} className="btn-primary px-3 py-1.5 text-[11px]">
                {reviewing === 'accept' ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />} Accept
              </button>
              <button type="button" disabled={!!reviewing} onClick={() => void reviewTentApplication(false)} className="btn-secondary px-3 py-1.5 text-[11px] text-coral">
                {reviewing === 'reject' ? <Loader2 size={13} className="animate-spin" /> : <X size={13} />} Reject
              </button>
            </span>
          ) : (
            <button type="button" onClick={() => void openArrival()} disabled={opening} className="mt-1.5 inline-flex items-center gap-1 text-[10px] font-bold text-peri">
              {opening ? <Loader2 size={11} className="animate-spin" /> : isQuizArrival(arrival) ? <FileQuestion size={11} /> : <Mail size={11} />}
              {opening ? 'Opening...' : isQuizArrival(arrival) ? 'Open Weekly Quiz' : 'Open message'}
            </button>
          )}
        </span>
        {tentApplication && <ShieldQuestion size={18} className="shrink-0 text-gold" />}
      </div>
      <button type="button" onClick={advanceArrival} className="absolute right-2 top-2 flex h-8 w-8 items-center justify-center rounded-md text-stone hover:bg-surface-2 hover:text-ink" aria-label="Dismiss notification"><X size={16} /></button>
    </aside>,
    document.body,
  ) : null;

  return (
    <>
      {prompt}
      {conversation && profile && (
        <TentMessenger recipient={conversation.recipient} senderId={profile.id} tentId={conversation.tentId} onClose={() => setConversation(null)} />
      )}
      {groupChat && profile && (
        <TentGroupMessenger tentId={groupChat.tentId} senderId={profile.id} tentName={groupChat.tentName} onClose={() => setGroupChat(null)} />
      )}
    </>
  );
}
