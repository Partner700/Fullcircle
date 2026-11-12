import { useEffect, useState } from 'react';
import { Trophy } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabase';
import { cn } from '../lib/utils';
import { UserAvatar } from './UserAvatar';

const GAME_NAMES = {
  daily_game: 'Daily Trivia',
  puzzle_trivia: 'Puzzle Trivia',
  story_mode: 'Story Mode',
  standard: 'Classic Trivia',
  journey: 'Biblical Journey',
  ludo: 'The Road Home',
  prelude: 'The Prelude',
} as const;

type Game = keyof typeof GAME_NAMES;

type Player = {
  user_id: string;
  display_name: string;
  avatar_url?: string | null;
};

type Leader = Player & { player_number: number | null; points: number };
type Points = { leaders: Leader[]; totals: Record<string, number> };

const EMPTY: Points = { leaders: [], totals: {} };
const PLAYER_ID = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;

function PlayerPoints({ player, points }: { player: Player; points?: number }) {
  return (
    <div className="flex min-w-14 max-w-24 flex-col items-center gap-1 text-center" title={player.display_name}>
      <UserAvatar userId={player.user_id} name={player.display_name} avatarUrl={player.avatar_url} className="h-8 w-8" />
      <span className="text-[10px] font-bold tabular-nums text-ink">{points == null ? '—' : `${points.toLocaleString()} pts`}</span>
      <span className="max-w-full truncate text-[10px] text-stone">{player.display_name}</span>
    </div>
  );
}

export function GamePoints({ game, players, showCurrentPlayer = false, limit = 1, revision, className }: {
  game?: Game;
  players?: Player[];
  showCurrentPlayer?: boolean;
  limit?: 1 | 3;
  revision?: string | boolean;
  className?: string;
}) {
  const { profile } = useAuth();
  const userId = profile?.id;
  const [result, setResult] = useState<{ game?: Game; userId: string; points: Points } | null>(null);
  const points = result && result.game === game && result.userId === userId ? result.points : null;
  const leaderLimit = game ? 1 : limit;
  const title = game ? `${GAME_NAMES[game]} leader` : leaderLimit === 3 ? 'Top 3 overall' : 'Overall leader';
  const currentPlayer = profile && showCurrentPlayer
    ? [{ user_id: profile.id, display_name: profile.display_name, avatar_url: profile.avatar_url }]
    : [];
  const participants = (players ?? currentPlayer).filter(player => PLAYER_ID.test(player.user_id));
  const playerKey = [...new Set(participants.map(player => player.user_id))].sort().join(',');

  useEffect(() => {
    if (!userId) return;
    let active = true;
    let pending = false;
    const refresh = async () => {
      if (pending || document.visibilityState === 'hidden') return;
      pending = true;
      try {
        const { data, error } = await supabase.rpc('get_game_points', {
          p_game: game ?? null,
          p_players: playerKey ? playerKey.split(',') : [],
        });
        if (active && !error) setResult({ game, userId, points: data ?? EMPTY });
      } catch {
        // A leaderboard request should never interrupt a game.
      } finally {
        pending = false;
      }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 30_000);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      active = false;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [game, playerKey, revision, userId]);

  if (!userId || (!participants.length && !points?.leaders.length)) return null;
  const leaders = points?.leaders.slice(0, leaderLimit) ?? [];
  return (
    <section aria-label={title} className={cn('rounded-lg border border-border bg-surface px-3 py-2 text-ink', className)}>
      {leaders.length > 0 && (
        <div>
          <p className="mb-1.5 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide text-stone">
            <Trophy size={13} className="text-gold" /> {title}
          </p>
          <ol className={cn('grid gap-1.5', leaderLimit === 3 && 'grid-cols-3')}>
            {leaders.map(leader => (
              <li key={leader.user_id} className={cn('flex min-w-0 items-center gap-2', leaderLimit === 3 && 'flex-col gap-1 text-center')}>
                <UserAvatar userId={leader.user_id} name={leader.display_name} avatarUrl={leader.avatar_url} className="h-8 w-8 shrink-0" />
                <div className="min-w-0 max-w-full">
                  <p className="truncate text-xs font-bold" title={leader.display_name}>{leader.display_name}</p>
                  <p className="text-[10px] tabular-nums text-stone">
                    {leader.player_number != null && <>#{String(leader.player_number).padStart(3, '0')} · </>}
                    {leader.points.toLocaleString()} {game ? 'pts in this game' : 'pts'}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      )}
      {participants.length > 0 && (
        <div className={cn(leaders.length > 0 && 'mt-2 border-t border-border pt-2')}>
          <p className="mb-1.5 text-[10px] font-semibold text-stone">Players’ lifetime points</p>
          <div className="flex flex-wrap gap-2">
            {participants.map(player => <PlayerPoints key={player.user_id} player={player} points={points ? points.totals[player.user_id] ?? 0 : undefined} />)}
          </div>
        </div>
      )}
    </section>
  );
}
