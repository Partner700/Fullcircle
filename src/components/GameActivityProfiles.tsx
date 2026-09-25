import { useMemo } from 'react';
import { Gamepad2, Loader2, Swords } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import type { GameActivityPlayer } from '../lib/types';
import { cn } from '../lib/utils';
import { CurrentUserAvatarMarker } from './CurrentUserAvatarMarker';
import { UserAvatar } from './UserAvatar';

export function GameActivityProfiles({
  activity,
  players: allPlayers,
  loading = false,
  variant = 'compact',
  className,
}: {
  activity: GameActivityPlayer['activity'];
  players: GameActivityPlayer[];
  loading?: boolean;
  variant?: 'compact' | 'card';
  className?: string;
}) {
  const { profile } = useAuth();

  const players = useMemo(
    () => allPlayers.filter((player) => player.activity === activity),
    [activity, allPlayers],
  );
  const Icon = activity === 'arena' ? Swords : Gamepad2;
  const label = activity === 'arena' ? 'Arena players' : 'Daily Game players';

  const playerRow = players.length > 0 ? (
    <div className="game-activity-profile-scroll flex min-h-9 items-center gap-1.5 overflow-x-auto pb-1 pt-0.5" aria-label={`${players.length} ${label.toLowerCase()} today`}>
      {players.map((player) => (
        <span
          key={`${player.activity}:${player.user_id}`}
          title={`${player.display_name} played today`}
          className="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-full"
        >
          <UserAvatar
            userId={player.user_id}
            name={player.display_name}
            avatarUrl={player.avatar_url}
            className="h-full w-full border border-white/55 shadow-sm"
          />
          <CurrentUserAvatarMarker isCurrentUser={player.user_id === profile?.id} compact />
        </span>
      ))}
    </div>
  ) : (
    <p className="min-h-9 py-2 text-[10px] font-medium text-stone">
      {loading ? 'Checking today\'s players...' : 'No one has played today yet.'}
    </p>
  );

  if (variant === 'card') {
    return (
      <section className={cn('card min-w-0 p-4', className)} aria-live="polite">
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-peri-soft text-peri"><Icon size={15} /></span>
            <div className="min-w-0">
              <p className="eyebrow text-stone">Today&apos;s activity</p>
              <h3 className="truncate font-display text-sm font-semibold text-ink">{label}</h3>
            </div>
          </div>
          {loading && players.length === 0
            ? <Loader2 size={15} className="shrink-0 animate-spin text-brass" />
            : <span className="text-sm font-black tabular-nums text-moss">{players.length}</span>}
        </div>
        <div className="mt-2">{playerRow}</div>
      </section>
    );
  }

  return (
    <div className={cn('mt-3 min-w-0 border-t border-border/60 pt-2.5', className)} aria-live="polite">
      <div className="flex items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-[9px] font-black uppercase text-stone"><Icon size={11} /> Played today</p>
        {!loading || players.length > 0 ? <span className="text-[10px] font-black tabular-nums text-ink">{players.length}</span> : null}
      </div>
      {playerRow}
    </div>
  );
}
