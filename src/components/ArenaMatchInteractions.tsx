import { useEffect, useRef, useState } from 'react';
import { BellRing, Heart, UserRound } from 'lucide-react';
import { postPublicArenaComment, sendArenaRoomMessage } from '../lib/queries';
import { playSoundEffect } from '../lib/soundscape';
import { supabase } from '../lib/supabase';

const HEART_MESSAGE = '❤️';

type HeartProps = {
  roomId: string;
  userId: string;
  guestKey?: string;
};

export function ArenaHeartReaction({ roomId, userId, guestKey }: HeartProps) {
  const [hearts, setHearts] = useState<number[]>([]);
  const [error, setError] = useState('');
  const nextHeart = useRef(0);
  const lastSent = useRef(0);
  const pending = useRef(false);
  const timers = useRef<number[]>([]);

  useEffect(() => {
    return () => {
      timers.current.forEach((timer) => window.clearTimeout(timer));
      timers.current = [];
    };
  }, [roomId]);

  const burst = () => {
    const ids = Array.from({ length: 5 }, () => ++nextHeart.current);
    setHearts((previous) => [...previous.slice(-20), ...ids]);
    const timeout = window.setTimeout(() => {
      setHearts((previous) => previous.filter((id) => !ids.includes(id)));
    }, 2000);
    timers.current.push(timeout);
  };

  useEffect(() => {
    const channel = supabase
      .channel(`arena-heart-reactions-${roomId}`)
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'arena_room_messages', filter: `room_id=eq.${roomId}`,
      }, (payload) => {
        const message = payload.new as { body?: string; sender_id?: string | null };
        if (message.body !== HEART_MESSAGE) return;
        // The sender has already seen an instant optimistic reaction.
        if (message.sender_id === userId && Date.now() - lastSent.current < 4000) return;
        burst();
      })
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [roomId, userId]);

  const sendHeart = async () => {
    if (pending.current || Date.now() - lastSent.current < 850) return;
    if (!guestKey && !userId) return;
    pending.current = true;
    lastSent.current = Date.now();
    setError('');
    burst();
    try {
      if (guestKey) await postPublicArenaComment(roomId, guestKey, HEART_MESSAGE);
      else await sendArenaRoomMessage(roomId, userId, HEART_MESSAGE);
    } catch {
      setError('Could not send your heart. Try again.');
    } finally {
      pending.current = false;
    }
  };

  return (
    <>
      <div className="fixed left-4 z-[2147483011]" style={{ bottom: 'calc(env(safe-area-inset-bottom, 0px) + 1rem)' }}>
        <button
          type="button"
          className="flex h-12 w-12 items-center justify-center rounded-full border-2 border-rose-300 bg-rose-900 text-rose-100 shadow-xl transition-transform active:scale-90"
          onClick={() => void sendHeart()}
          aria-label="Send a heart reaction to the match"
          title="Send love to the players"
        >
          <Heart size={26} fill="currentColor" aria-hidden="true" />
        </button>
        {error && <span className="absolute bottom-14 left-0 w-48 rounded-md border border-coral bg-bg px-2 py-1.5 text-xs text-coral shadow-lg" role="alert">{error}</span>}
      </div>
      <div aria-hidden="true" className="pointer-events-none fixed bottom-16 left-4 z-[2147483012] h-64 w-24 overflow-visible">
        {hearts.map((id, index) => (
          <span key={id} className="fc-arena-heart-float absolute bottom-0 left-3 text-2xl"
            style={{ '--heart-drift': `${(id % 5 - 2) * 14}px`, animationDelay: `${index % 5 * 0.06}s` } as React.CSSProperties}>
            {HEART_MESSAGE}
          </span>
        ))}
      </div>
    </>
  );
}

type TurnProps = {
  roomId: string;
  userId: string;
  activePlayerId?: string | null;
  activePlayerName?: string | null;
  prompt?: string;
  spectator?: boolean;
};

export function ArenaTurnAlert({
  roomId, userId, activePlayerId, activePlayerName, prompt = 'Play now', spectator = false,
}: TurnProps) {
  const previousTurn = useRef<string | null>(null);
  useEffect(() => { previousTurn.current = null; }, [roomId]);
  useEffect(() => {
    if (spectator || !activePlayerId) return;
    const preceding = previousTurn.current;
    previousTurn.current = activePlayerId;
    if (preceding && preceding !== activePlayerId && activePlayerId === userId && document.visibilityState === 'visible') {
      void playSoundEffect('sound_arena_round', 0.65);
      if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') navigator.vibrate(120);
    }
  }, [activePlayerId, spectator, userId]);
  if (spectator || !activePlayerId) return null;

  const mine = activePlayerId === userId;
  return (
    <div role="status" aria-live="polite"
      className={mine
        ? 'flex items-center gap-3 rounded-lg border-2 border-gold bg-gold-soft px-4 py-3 text-ink shadow-md'
        : 'flex items-center gap-3 rounded-lg border border-border bg-surface-2 px-4 py-2.5 text-stone'}>
      {mine ? <BellRing size={23} className="shrink-0 text-gold" aria-hidden="true" />
        : <UserRound size={19} className="shrink-0 text-brass" aria-hidden="true" />}
      <div className="min-w-0">
        <p className={mine ? 'font-display text-base font-black text-ink' : 'text-sm font-semibold text-ink'}>
          {mine ? 'YOUR TURN TO PLAY!' : `${activePlayerName || 'Another player'}'s turn`}
        </p>
        <p className="text-xs">{mine ? prompt : 'Watch the game. You will be alerted when it is your turn.'}</p>
      </div>
    </div>
  );
}
