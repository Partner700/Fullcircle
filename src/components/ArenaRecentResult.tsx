import { useEffect, useState } from 'react';
import { Dices, RotateCw, Swords } from 'lucide-react';
import { fetchArenaFinalScorecard, type ArenaFinalScorecard } from '../lib/queries';
import { TentHouseSymbol } from './TentHouseSymbol';

const scoreCache = new Map<string, ArenaFinalScorecard>();

function PlayerSymbol({ player }: { player: ArenaFinalScorecard['players'][number] }) {
  if (player.tent_house_id) return <TentHouseSymbol houseId={player.tent_house_id} size={23} />;
  return player.display_name === 'The Scribe'
    ? <Dices size={21} className="shrink-0 text-gold" aria-label="The Scribe" />
    : <Swords size={21} className="shrink-0 text-peri" aria-label="No tent" />;
}

export function ArenaRecentResult({ roomId }: { roomId: string }) {
  const [score, setScore] = useState<ArenaFinalScorecard | null>(() => scoreCache.get(roomId) || null);
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let active = true;
    const cached = scoreCache.get(roomId);
    if (cached) {
      setScore(cached);
      setFailed(false);
      return () => { active = false; };
    }
    void fetchArenaFinalScorecard(roomId).then((result) => {
      if (!active) return;
      if (!result) {
        setFailed(true);
        return;
      }
      scoreCache.set(roomId, result);
      setScore(result);
      setFailed(false);
    }).catch(() => { if (active) setFailed(true); });
    return () => { active = false; };
  }, [roomId, retry]);

  const players = score?.players || [];
  return <div className="card min-w-0 bg-surface/70 p-3" aria-label="Recent Arena result">
    {players.length === 2 ? <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2">
      <div className="flex min-w-0 items-center justify-end gap-1.5">
        <span className="min-w-0 truncate text-right text-xs font-semibold text-ink" title={players[0].display_name}>{players[0].display_name}</span>
        <PlayerSymbol player={players[0]} />
      </div>
      <span className="whitespace-nowrap font-display text-base font-bold tabular-nums text-ink" aria-label={`${players[0].correct_count} to ${players[1].correct_count}`}>
        {Math.max(0, Number(players[0].correct_count) || 0)} <span className="text-stone">-</span> {Math.max(0, Number(players[1].correct_count) || 0)}
      </span>
      <div className="flex min-w-0 items-center gap-1.5">
        <PlayerSymbol player={players[1]} />
        <span className="min-w-0 truncate text-xs font-semibold text-ink" title={players[1].display_name}>{players[1].display_name}</span>
      </div>
    </div> : players.length > 0 ? <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2">
      {players.map((player) => <div key={player.user_id} className="flex min-w-0 max-w-full items-center gap-1.5 text-xs font-semibold text-ink">
        <span className="truncate" title={player.display_name}>{player.display_name}</span>
        <PlayerSymbol player={player} />
        <span className="font-display font-bold tabular-nums">{Math.max(0, Number(player.correct_count) || 0)}</span>
      </div>)}
    </div> : failed ? <div className="flex items-center justify-center gap-2 text-xs text-stone">
      <span>Score unavailable</span>
      <button type="button" className="btn-ghost h-7 w-7 p-0" title="Retry score" aria-label="Retry score" onClick={() => { setFailed(false); setRetry((value) => value + 1); }}><RotateCw size={14} /></button>
    </div> : <div className="h-6 animate-pulse rounded bg-surface-2" aria-label="Loading score" />}
  </div>;
}
