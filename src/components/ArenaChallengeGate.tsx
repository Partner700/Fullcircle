import { useCallback, useEffect, useMemo, useState } from 'react';
import { CalendarClock, Coins, Loader2, ShieldX, Swords } from 'lucide-react';
import {
  fetchArenaChatGameCalls,
  respondArenaChatChallenge,
} from '../lib/queries';
import type { ArenaChallengeResponse, ArenaChatGameCall } from '../lib/queries';
import { supabase } from '../lib/supabase';
import { formatDenarii } from '../lib/utils';
import { UserAvatar } from './UserAvatar';

type Props = {
  roomId: string;
  userId: string;
  onAccepted: (targetRoomId: string) => Promise<void> | void;
};

function challengeErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object' && 'message' in error) return String(error.message);
  return 'Your Arena challenge response could not be saved.';
}

export function ArenaChallengeGate({ roomId, userId, onAccepted }: Props) {
  const [calls, setCalls] = useState<ArenaChatGameCall[]>([]);
  const [responding, setResponding] = useState<ArenaChallengeResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setCalls(await fetchArenaChatGameCalls(roomId));
    } catch (loadError) {
      console.error('Arena challenge gate load failed', loadError);
    }
  }, [roomId]);

  useEffect(() => {
    void load();
    let refreshTimer: number | null = null;
    const refreshSoon = () => {
      if (refreshTimer !== null) window.clearTimeout(refreshTimer);
      refreshTimer = window.setTimeout(() => { void load(); }, 120);
    };
    const channel = supabase
      .channel(`arena-challenge-gate-${roomId}-${userId}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'arena_chat_game_calls',
        filter: `source_room_id=eq.${roomId}`,
      }, refreshSoon)
      .subscribe();
    const interval = window.setInterval(() => {
      if (document.visibilityState === 'visible') void load();
    }, 20_000);
    return () => {
      if (refreshTimer !== null) window.clearTimeout(refreshTimer);
      window.clearInterval(interval);
      void supabase.removeChannel(channel);
    };
  }, [load, roomId, userId]);

  const challenge = useMemo(() => calls.find((gameCall) => (
    gameCall.challenged_user_id === userId
      && gameCall.challenge_status === 'pending'
      && gameCall.room_status === 'waiting'
  )) || null, [calls, userId]);

  if (!challenge) return null;

  const respond = async (response: ArenaChallengeResponse) => {
    if (responding) return;
    setResponding(response);
    setError(null);
    try {
      const targetRoomId = await respondArenaChatChallenge(challenge.target_room_id, response);
      if (response === 'accept') {
        await onAccepted(targetRoomId);
      } else {
        await load();
      }
    } catch (responseError) {
      setError(challengeErrorMessage(responseError));
    } finally {
      setResponding(null);
    }
  };

  const machineMatch = challenge.source_play_mode === 'machine';

  return (
    <div className="fixed inset-0 z-[190] flex items-center justify-center bg-ink/78 px-4 py-6 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="arena-challenge-title">
      <div className="w-full max-w-sm rounded-lg border border-gold/55 bg-surface p-5 shadow-2xl animate-slide-up">
        <div className="flex items-start gap-3">
          <UserAvatar
            userId={challenge.creator_id}
            name={challenge.creator_name}
            avatarUrl={challenge.creator_avatar_url}
            className="h-12 w-12 flex-shrink-0 border-2 border-gold/55"
          />
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-bold uppercase tracking-widest text-gold">Arena challenge</p>
            <h2 id="arena-challenge-title" className="mt-1 text-lg font-display font-bold text-ink">
              {challenge.creator_name} challenged you
            </h2>
            <p className="mt-1 text-xs leading-relaxed text-stone">Choose before your next move.</p>
          </div>
        </div>

        <div className="mt-4 flex items-center justify-between gap-3 rounded-lg border border-border bg-surface-2 px-3 py-2.5 text-xs font-semibold text-ink">
          <span className="flex items-center gap-1.5"><Swords size={14} className="text-brass" /> {challenge.game_type === 'ludo' ? 'Ludo Trivia' : 'Standard Trivia'}</span>
          <span className="flex items-center gap-1.5"><Coins size={14} className="text-gold" /> {formatDenarii(challenge.stake_amount)} denarii</span>
        </div>

        {machineMatch ? (
          <p className="mt-3 text-[11px] leading-relaxed text-stone">Accepting forfeits this machine match and immediately restarts the Arena with your challenger. Everyone watching stays with the game.</p>
        ) : (
          <p className="mt-3 text-[11px] leading-relaxed text-stone">Finish your current player match first. You can decline or reserve this as your next match.</p>
        )}

        {error && <p className="mt-3 rounded-md border border-coral/30 bg-coral-soft px-3 py-2 text-xs text-coral" role="alert">{error}</p>}

        <div className="mt-5 grid grid-cols-2 gap-2">
          <button type="button" onClick={() => void respond('decline')} disabled={Boolean(responding)} className="btn-secondary min-h-[2.75rem] text-xs">
            {responding === 'decline' ? <Loader2 size={15} className="animate-spin" /> : <ShieldX size={15} />}
            Decline
          </button>
          <button type="button" onClick={() => void respond('schedule')} disabled={Boolean(responding)} className="btn-secondary min-h-[2.75rem] text-xs">
            {responding === 'schedule' ? <Loader2 size={15} className="animate-spin" /> : <CalendarClock size={15} />}
            Schedule next
          </button>
          {machineMatch && (
            <button type="button" onClick={() => void respond('accept')} disabled={Boolean(responding)} className="btn-primary col-span-2 min-h-[2.75rem] text-xs">
              {responding === 'accept' ? <Loader2 size={15} className="animate-spin" /> : <Swords size={15} />}
              Accept and restart match
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
