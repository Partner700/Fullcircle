import { useEffect, useRef, useState } from 'react';
import { BellRing, Heart, UserRound } from 'lucide-react';
import { fetchArenaRoomMessages, postPublicArenaComment, sendArenaRoomMessage } from '../lib/queries';
import { playSoundEffect } from '../lib/soundscape';
import { supabase } from '../lib/supabase';

const HEART_MESSAGE = '❤️';
type ReactionPlayer = { user_id: string; display_name: string; avatar_url?: string | null };
type HeartProps = {
  roomId: string;
  userId: string;
  guestKey?: string;
  spectator?: boolean;
  players?: ReactionPlayer[];
};
type FlyingHeart = { id: number; size: number; drift: number; delay: number };

export function ArenaHeartReaction({ roomId, userId, guestKey, spectator = false, players = [] }: HeartProps) {
  const canSend = spectator && (!userId || !players.some(player => player.user_id === userId));
  const [hearts, setHearts] = useState<FlyingHeart[]>([]);
  const [glowing, setGlowing] = useState(false);
  const [error, setError] = useState('');
  const counter = useRef(0);
  const lastSent = useRef(0);
  const pending = useRef(false);
  const seenHeartIds = useRef(new Set<string>());
  const timers = useRef<number[]>([]);
  const glowTimer = useRef<number | null>(null);

  useEffect(() => {
    setHearts([]);
    setGlowing(false);
    seenHeartIds.current.clear();
    return () => {
      timers.current.forEach(id => window.clearTimeout(id));
      timers.current = [];
      if (glowTimer.current !== null) window.clearTimeout(glowTimer.current);
    };
  }, [roomId]);

  const burst = () => {
    const ids: FlyingHeart[] = Array.from({ length: 3 + Math.floor(Math.random() * 2) }, (_, i) => ({
      id: ++counter.current, size: [13, 22, 17, 27][i],
      drift: [-23, 16, -10, 28][i], delay: i * 65,
    }));
    setHearts(previous => [...previous.slice(-24), ...ids]);
    const timeout = window.setTimeout(() => {
      setHearts(previous => previous.filter(heart => !ids.some(item => item.id === heart.id)));
    }, 1600);
    timers.current.push(timeout);
    if (canSend) {
      setGlowing(true);
      if (glowTimer.current !== null) window.clearTimeout(glowTimer.current);
      glowTimer.current = window.setTimeout(() => setGlowing(false), 1050);
    }
  };

  useEffect(() => {
    const channel = supabase.channel(`arena-heart-reactions-${roomId}`)
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'arena_room_messages', filter: `room_id=eq.${roomId}`,
      }, payload => {
        const message = payload.new as { id?: string; body?: string; sender_id?: string | null };
        if (message.body !== HEART_MESSAGE) return;
        if (message.id && seenHeartIds.current.has(message.id)) return;
        if (message.id) seenHeartIds.current.add(message.id);
        if (message.sender_id === userId && Date.now() - lastSent.current < 4000) return;
        burst();
      }).subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [roomId, userId]);

  useEffect(() => {
    let active = true;
    let initialized = false;
    let inFlight = false;
    const sync = async () => {
      if (!active || inFlight || document.visibilityState === 'hidden') return;
      inFlight = true;
      try {
        const recent = await fetchArenaRoomMessages(roomId);
        if (!active) return;
        const now = Date.now();
        for (const entry of recent) {
          if (entry.body.trim() !== HEART_MESSAGE) continue;
          const known = seenHeartIds.current.has(entry.id);
          seenHeartIds.current.add(entry.id);
          if (!initialized || known || now - new Date(entry.created_at).getTime() > 12000) continue;
          if (entry.sender_id === userId && now - lastSent.current < 4000) continue;
          burst();
        }
        initialized = true;
      } catch { /* Realtime is the primary path. */ }
      finally { inFlight = false; }
    };
    void sync();
    const timer = window.setInterval(() => void sync(), 16_000);
    return () => { active = false; window.clearInterval(timer); };
  }, [roomId, userId]);

  const sendHeart = async () => {
    if (!canSend || pending.current || Date.now() - lastSent.current < (guestKey ? 8200 : 850)) return;
    if (!guestKey && !userId) return;
    pending.current = true;
    lastSent.current = Date.now();
    setError('');
    burst();
    try {
      if (guestKey) await postPublicArenaComment(roomId, guestKey, HEART_MESSAGE);
      else await sendArenaRoomMessage(roomId, userId, HEART_MESSAGE);
    } catch {
      setError('The reaction could not be sent.');
    } finally {
      pending.current = false;
    }
  };

  return (<>
    <style>{`
      @keyframes fc-yellow-hearts-rise {
        0% { transform: translate3d(0,0,0) scale(1.14); opacity: 0.97; filter: drop-shadow(0 0 8px #facc15); }
        55% { opacity: .84; }
        100% { transform: translate3d(var(--fc-drift),-125px,0) scale(.08); opacity: 0; filter: drop-shadow(0 0 0 transparent); }
      }
      .fc-yellow-heart-float { animation: fc-yellow-hearts-rise 1.35s ease-out forwards; }
      @media (prefers-reduced-motion: reduce) {
        .fc-yellow-heart-float { animation-duration: .25s; }
      }
    `}</style>
    <div className="relative mt-5 flex min-h-[58px] w-full items-center justify-center border-t border-border/50 pt-3 pb-1"
      aria-label="Arena heart reactions">
      {canSend && <button type="button" onClick={() => void sendHeart()}
        title="Cheer for the match" aria-label="Send yellow hearts"
        className={`relative z-10 flex h-11 w-11 items-center justify-center rounded-full border-2 transition-all active:scale-90 ${glowing
          ? 'border-yellow-300 bg-yellow-300/20 text-yellow-300 shadow-[0_0_22px_6px_rgba(250,204,21,.8)]'
          : 'border-white/70 bg-[#142849] text-white'}`}>
        <Heart size={25} fill="currentColor" aria-hidden="true" />
      </button>}
      <div aria-hidden="true" className="pointer-events-none absolute bottom-10 left-1/2 z-20 h-36 w-0 overflow-visible">
        {hearts.map(heart => <Heart key={heart.id} fill="#facc15" stroke="#fde047"
          className="fc-yellow-heart-float absolute bottom-0"
          style={{
            left: -heart.size / 2, width: heart.size, height: heart.size,
            '--fc-drift': `${heart.drift}px`, animationDelay: `${heart.delay}ms`,
          } as React.CSSProperties}/>)}
      </div>
      {error && <span role="alert" className="absolute bottom-full left-1/2 z-20 mb-2 -translate-x-1/2 rounded-md bg-[#401b1b] p-2 text-xs text-white">{error}</span>}
    </div>
  </>);
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
