import { useEffect, useRef, useState } from 'react';
import { BellRing, Heart, UserRound } from 'lucide-react';
import { postPublicArenaComment, sendArenaRoomMessage } from '../lib/queries';
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
type FlyingHeart = { id: number; size: number; drift: number; delay: number; left: number };

export function ArenaHeartReaction({ roomId, userId, guestKey, spectator = false, players = [] }: HeartProps) {
  const [hearts, setHearts] = useState<FlyingHeart[]>([]);
  const [glowing, setGlowing] = useState<string | null>(null);
  const [error, setError] = useState('');
  const counter = useRef(0);
  const lastSent = useRef(0);
  const pending = useRef(false);
  const timers = useRef<number[]>([]);
  const glowTimer = useRef<number | null>(null);

  useEffect(() => {
    setHearts([]);
    setGlowing(null);
    return () => {
      timers.current.forEach(id => window.clearTimeout(id));
      timers.current = [];
      if (glowTimer.current !== null) window.clearTimeout(glowTimer.current);
    };
  }, [roomId]);

  const burst = (targetId = '') => {
    const index = players.findIndex(p => p.user_id === targetId);
    const origin = index < 0 ? 22 : 78 + (index * 44);
    const ids: FlyingHeart[] = Array.from({ length: 3 + ((++counter.current) % 2) }, (_, i) => ({
      id: ++counter.current,
      size: [13, 22, 17, 27][i],
      drift: [-19, 14, -8, 24][i],
      delay: i * 65,
      left: origin,
    }));
    setHearts(previous => [...previous.slice(-32), ...ids]);
    const timeout = window.setTimeout(() => {
      setHearts(previous => previous.filter(heart => !ids.some(item => item.id === heart.id)));
    }, 1600);
    timers.current.push(timeout);
    if (spectator) {
      setGlowing(targetId || 'heart');
      if (glowTimer.current !== null) window.clearTimeout(glowTimer.current);
      glowTimer.current = window.setTimeout(() => setGlowing(null), 1050);
    }
  };

  useEffect(() => {
    const channel = supabase.channel(`arena-heart-reactions-${roomId}`)
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'arena_room_messages', filter: `room_id=eq.${roomId}`,
      }, payload => {
        const message = payload.new as { body?: string; sender_id?: string | null };
        if (message.body !== HEART_MESSAGE) return;
        if (message.sender_id === userId && Date.now() - lastSent.current < 4000) return;
        burst();
      }).subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [roomId, userId]);

  const sendHeart = async (targetId = '') => {
    // Only witnesses may send: participants see the floating hearts, not controls.
    if (!spectator || pending.current || Date.now() - lastSent.current < 850) return;
    if (!guestKey && !userId) return;
    pending.current = true;
    lastSent.current = Date.now();
    setError('');
    burst(targetId);
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
    {spectator && <div className="fixed left-3 z-[2147483011] flex max-w-[min(92vw,390px)] items-end gap-2 rounded-xl border border-white/15 bg-[#0b1730]/90 p-2 shadow-2xl"
      style={{ bottom: 'calc(env(safe-area-inset-bottom, 0px) + 1rem)' }} aria-label="Witness reactions">
      <button type="button" onClick={() => void sendHeart()} aria-label="Send yellow hearts to the match"
        title="Cheer for the match" className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full border-2 transition-all active:scale-90 ${glowing === 'heart' ? 'border-yellow-300 bg-yellow-300/20 text-yellow-300 shadow-[0_0_22px_6px_rgba(250,204,21,.8)]' : 'border-white/70 bg-white/10 text-white'}`}>
        <Heart size={25} fill="currentColor" aria-hidden="true"/>
      </button>
      <div className="flex min-w-0 gap-2 overflow-x-auto" aria-label="Cheer for a specific player">
        {players.filter(p => p.user_id !== '00000000-0000-0000-0000-000000000000' && p.user_id !== 'arena-machine').map(player => (
          <button type="button" key={player.user_id} onClick={() => void sendHeart(player.user_id)} title={`Cheer for ${player.display_name}`}
            aria-label={`Send hearts for ${player.display_name}`}
            className={`relative h-11 w-11 shrink-0 overflow-hidden rounded-full border-2 bg-[#142849] text-white transition-all active:scale-90 ${glowing === player.user_id ? 'border-yellow-300 shadow-[0_0_22px_5px_rgba(250,204,21,.75)]' : 'border-white/50'}`}>
            {player.avatar_url ? <img src={player.avatar_url} alt="" className="h-full w-full object-cover"/> : <span className="flex h-full w-full items-center justify-center text-sm font-black">{player.display_name.slice(0,1).toUpperCase()}</span>}
          </button>
        ))}
      </div>
      {error && <span role="alert" className="absolute bottom-full left-0 mb-2 rounded-md bg-[#401b1b] p-2 text-xs text-white">{error}</span>}
    </div>}
    <div aria-hidden="true" className="pointer-events-none fixed bottom-16 left-3 z-[2147483012] h-52 w-[min(92vw,390px)] overflow-visible">
      {hearts.map(heart => <Heart key={heart.id} fill="#facc15" stroke="#fde047" className="fc-yellow-heart-float absolute bottom-0"
        style={{ left: heart.left, width: heart.size, height: heart.size,
          '--fc-drift': `${heart.drift}px`, animationDelay: `${heart.delay}ms`,
        } as React.CSSProperties}/>)}
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
