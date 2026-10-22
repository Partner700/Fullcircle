import { arenaPlayerScore } from '../lib/arenaScorecard';
import { Dices, Swords } from 'lucide-react';
import { UserAvatar } from './UserAvatar';
import { TentHouseSymbol } from './TentHouseSymbol';
import { shortArenaName, type ArenaMatchupPlayer } from '../lib/arenaMatchup';

function PlayerSide({ player, reverse = false }: { player?: ArenaMatchupPlayer; reverse?: boolean }) {
  if (!player) return <div className="min-w-0 text-center text-xs text-stone">Waiting</div>;
  const symbol = player.tent_house_id
    ? <TentHouseSymbol houseId={player.tent_house_id} size={22} />
    : player.display_name === 'The Scribe'
      ? <Dices size={20} className="shrink-0 text-gold" />
      : null;
  return <div className={`flex min-w-0 items-center gap-1.5 ${reverse ? 'flex-row-reverse' : ''}`}>
    <UserAvatar userId={player.user_id} name={player.display_name} avatarUrl={player.avatar_url} className="h-8 w-8 shrink-0" />
    <span className="min-w-0 truncate text-xs font-bold text-ink" title={player.display_name}>{shortArenaName(player.display_name)}</span>
    {symbol}
  </div>;
}

export function ArenaMatchup({ players, playing = false }: { players: ArenaMatchupPlayer[]; playing?: boolean }) {
  const [first, second] = players;
  return <div className="min-w-0" aria-label="Arena players and scores" aria-live={playing ? 'polite' : 'off'}>
    <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2">
      <PlayerSide player={first} />
      <span className="flex min-w-12 items-center justify-center whitespace-nowrap font-display text-base font-bold tabular-nums text-ink">
        {playing
          ? `${arenaPlayerScore(first)} - ${arenaPlayerScore(second)}`
          : <Swords size={19} className="text-gold" aria-label="versus" />}
      </span>
      <PlayerSide player={second} reverse />
    </div>
    {players.length > 2 && <div className="mt-2 flex flex-wrap items-center justify-center gap-x-3 gap-y-1">
      {players.slice(2).map((player) => <span key={player.user_id} className="flex min-w-0 max-w-[8rem] items-center gap-1 text-[11px] font-semibold text-stone">
        {player.tent_house_id && <TentHouseSymbol houseId={player.tent_house_id} size={18} />}
        <span className="truncate">{shortArenaName(player.display_name)}</span>
        {playing && <strong className="text-ink">{arenaPlayerScore(player)}</strong>}
      </span>)}
    </div>}
  </div>;
}
