import { useEffect, useState } from 'react';
import { Dices, RotateCw, Swords } from 'lucide-react';
import { fetchArenaFinalScorecard, type ArenaFinalScorecard } from '../lib/queries';
import { shortestArenaName, arenaPlayerScore } from '../lib/arenaScorecard';
import { TentHouseSymbol } from './TentHouseSymbol';
import { PanelImageBackdrop } from './PanelImageBackdrop';
import type { PanelImageSetting } from '../lib/types';

const scoreCache = new Map<string, ArenaFinalScorecard>();

function PlayerSymbol({ player }: { player: ArenaFinalScorecard['players'][number] }) {
  if (player.tent_house_id) return <TentHouseSymbol houseId={player.tent_house_id} size={23} />;
  return player.display_name === 'The Scribe'
    ? <Dices size={21} className="shrink-0 text-gold" aria-label="The Scribe" />
    : <Swords size={21} className="shrink-0 text-peri" aria-label="No tent" />;
}

export function ArenaRecentResult({ roomId, arenaImage }: { roomId: string; arenaImage: PanelImageSetting | null }) {
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
  const columns = players.length >= 4 ? 'grid-cols-4' : players.length === 3 ? 'grid-cols-3' : 'grid-cols-2';
  return <div data-artwork-theme={arenaImage?.url ? 'night' : undefined} className="card relative min-w-0 overflow-hidden bg-navy-2 p-3 text-white" aria-label="Recent Arena result">
    <PanelImageBackdrop image={arenaImage} opacityOverride={80} veilClassName="arena-scorecard-veil" simple />
    <div className="relative z-10">
    {players.length === 2 ? <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2">
      <div className="flex min-w-0 items-center justify-end gap-1.5">
        <span className="min-w-0 truncate text-right text-xs font-semibold text-white" title={players[0].display_name}>{shortestArenaName(players[0].display_name)}</span>
        <PlayerSymbol player={players[0]} />
      </div>
      <span className="whitespace-nowrap font-display text-base font-bold tabular-nums text-white" aria-label={`${arenaPlayerScore(players[0])} to ${arenaPlayerScore(players[1])}`}>
        {arenaPlayerScore(players[0])} <span className="text-white/65">-</span> {arenaPlayerScore(players[1])}
      </span>
      <div className="flex min-w-0 items-center gap-1.5">
        <PlayerSymbol player={players[1]} />
        <span className="min-w-0 truncate text-xs font-semibold text-white" title={players[1].display_name}>{shortestArenaName(players[1].display_name)}</span>
      </div>
    </div> : players.length > 0 ? <div className={`grid min-w-0 ${columns} gap-x-1 gap-y-3`}>
      {players.map((player) => <div key={player.user_id} className="flex min-w-0 flex-col items-center text-center text-white" title={player.display_name}>
        <span className="flex h-6 items-center justify-center"><PlayerSymbol player={player} /></span>
        <span className="font-display text-base font-bold tabular-nums">{arenaPlayerScore(player)}</span>
        <span className="block w-full truncate text-[10px] font-semibold leading-tight">{shortestArenaName(player.display_name)}</span>
      </div>)}
    </div> : failed ? <div className="flex items-center justify-center gap-2 text-xs text-white/70">
      <span>Score unavailable</span>
      <button type="button" className="btn-ghost h-7 w-7 p-0" title="Retry score" aria-label="Retry score" onClick={() => { setFailed(false); setRetry((value) => value + 1); }}><RotateCw size={14} /></button>
    </div> : <div className="h-6 animate-pulse rounded bg-white/15" aria-label="Loading score" />}
    </div>
  </div>;
}
