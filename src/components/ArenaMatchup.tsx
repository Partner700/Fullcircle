import { type CSSProperties, useLayoutEffect, useRef } from 'react';
import { Swords } from 'lucide-react';
import { arenaPlayerScore } from '../lib/arenaScorecard';
import { formatPlayerNumber } from '../lib/utils';
import { UserAvatar } from './UserAvatar';
import { TentHouseSymbol } from './TentHouseSymbol';
import { groupArenaMatchupSides, shortArenaName, type ArenaMatchupPlayer } from '../lib/arenaMatchup';

const LEADING_SCORE_COLOR = '#fbd56a';
const TRAILING_SCORE_COLOR = '#edf0fb';

function LiveScore({ player, leading }: { player: ArenaMatchupPlayer; leading: boolean }) {
  const numberRef = useRef<HTMLElement>(null);
  const score = arenaPlayerScore(player);
  const previousScore = useRef(score);
  const color = leading ? LEADING_SCORE_COLOR : TRAILING_SCORE_COLOR;

  useLayoutEffect(() => {
    const increased = score > previousScore.current;
    previousScore.current = score;
    if (!increased) return;
    const number = numberRef.current;
    if (!number?.animate) return;
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const flash = number.animate([
      { color: LEADING_SCORE_COLOR, transform: 'scale(1)', offset: 0 },
      { color: LEADING_SCORE_COLOR, transform: reduceMotion ? 'scale(1)' : 'scale(1.3)', offset: 0.15 },
      { color: LEADING_SCORE_COLOR, transform: 'scale(1)', offset: 0.35 },
      { color: LEADING_SCORE_COLOR, transform: 'scale(1)', offset: 0.8 },
      { color: 'var(--arena-score-color)', transform: 'scale(1)', offset: 1 },
    ], { duration: 1100, easing: 'ease-out' });
    return () => flash.cancel();
  }, [score]);

  return <strong ref={numberRef} className="inline-block font-display text-base font-black tabular-nums sm:text-lg"
    style={{ '--arena-score-color': color, color: 'var(--arena-score-color)' } as CSSProperties}>
    {score}
  </strong>;
}

function PlayerProfile({ player, leading, playing }: {
  player: ArenaMatchupPlayer; leading: boolean; playing: boolean;
}) {
  return <div className="flex min-w-[3.3rem] flex-col items-center justify-start gap-0.5 text-center"
    title={player.display_name} aria-label={`${player.display_name}, player ${formatPlayerNumber(player.player_number)}, score ${arenaPlayerScore(player)}`}>
    <div className="relative">
      <UserAvatar userId={player.user_id} name={player.display_name} avatarUrl={player.avatar_url}
        className="h-9 w-9 shrink-0 border-2 border-gold/40 sm:h-11 sm:w-11" />
      {player.tent_house_id && <span className="absolute -bottom-1 -right-2 rounded-full bg-surface p-0.5">
        <TentHouseSymbol houseId={player.tent_house_id} size={14} />
      </span>}
    </div>
    <span className="mt-1 font-display text-[11px] font-bold tabular-nums text-ink sm:text-xs">
      {formatPlayerNumber(player.player_number)}
    </span>
    <span className="rounded bg-[#192941] px-2 py-0.5 leading-none" aria-label={`${arenaPlayerScore(player)} points`}>
      <LiveScore key={player.user_id} player={player} leading={playing && leading} />
    </span>
    <span className="max-w-[4.75rem] truncate text-[9px] font-medium text-stone sm:text-[10px]">
      {shortArenaName(player.display_name)}
    </span>
  </div>;
}

export function ArenaMatchup({ players, playing = false, pinned = false }: {
  players: ArenaMatchupPlayer[]; playing?: boolean; pinned?: boolean;
}) {
  const scores = players.map(arenaPlayerScore);
  const highest = Math.max(0, ...scores);
  const hasLeader = scores.filter((score) => score === highest).length === 1 && scores.length > 1;
  const sides = groupArenaMatchupSides(players);
  return <div className={pinned
    ? 'sticky top-[var(--app-header-height,env(safe-area-inset-top,0px))] z-[25] min-w-0 rounded-xl border border-border bg-surface px-2 py-2 shadow-md'
    : 'min-w-0'}
    role={pinned ? 'region' : undefined} aria-label="Arena players and scores"
    aria-live={playing ? 'polite' : 'off'}>
    {sides.length === 0
      ? <p className="py-2 text-center text-xs text-stone">Waiting for players</p>
      : <div className="min-w-0 overflow-x-auto">
        <div className="flex w-max min-w-full items-start justify-center gap-1.5 py-1 sm:gap-2.5">
          {sides.map((side, index) => <div key={side.key} className="contents">
            {index > 0 && <span className="flex h-12 shrink-0 items-center justify-center text-gold"
              aria-label="versus another tent"><Swords size={18} aria-hidden="true" /></span>}
            <div className="flex shrink-0 items-start gap-1 sm:gap-2">
              {side.players.map((player, allyIndex) => <div key={player.user_id} className="contents">
                {allyIndex > 0 && <span className="flex h-12 shrink-0 items-center justify-center font-display text-lg font-black text-gold"
                  aria-label="same tent teammates">&amp;</span>}
                <PlayerProfile player={player}
                  leading={hasLeader && arenaPlayerScore(player) === highest} playing={playing} />
              </div>)}
            </div>
          </div>)}
        </div>
      </div>}
  </div>;
}
