import { type CSSProperties, useLayoutEffect, useRef } from 'react';
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

const LEADING_SCORE_COLOR = '#fbd56a';
const TRAILING_SCORE_COLOR = '#edf0fb';

function LiveScore({ player, leading }: { player?: ArenaMatchupPlayer; leading: boolean }) {
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

  return <strong ref={numberRef} className="inline-block tabular-nums"
    style={{ '--arena-score-color': color, color: 'var(--arena-score-color)' } as CSSProperties}>
    {score}
  </strong>;
}

export function ArenaMatchup({ players, playing = false, pinned = false }: { players: ArenaMatchupPlayer[]; playing?: boolean; pinned?: boolean }) {
  const [first, second] = players;
  const scores = players.map(arenaPlayerScore);
  const highest = Math.max(...scores);
  const hasLeader = scores.filter((score) => score === highest).length === 1 && scores.length > 1;
  const isLeading = (player?: ArenaMatchupPlayer) => Boolean(player && hasLeader && arenaPlayerScore(player) === highest);
  return <div className={pinned ? 'sticky top-[var(--app-header-height,env(safe-area-inset-top,0px))] z-[25] min-w-0 rounded-xl border border-border bg-surface px-2.5 py-2 shadow-md sm:px-3' : 'min-w-0'}
    role={pinned ? 'region' : undefined} aria-label="Arena players and scores" aria-live={playing ? 'polite' : 'off'}>
    <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2">
      <PlayerSide player={first} />
      <span className="flex min-w-12 items-center justify-center whitespace-nowrap font-display text-base font-bold tabular-nums text-ink">
        {playing
          ? pinned
            ? <span className="inline-flex items-center gap-1.5 rounded-lg bg-[#192941] px-2.5 py-1 text-lg leading-none text-[#edf0fb]">
                <LiveScore key={first?.user_id} player={first} leading={isLeading(first)} />
                <span>–</span>
                <LiveScore key={second?.user_id} player={second} leading={isLeading(second)} />
              </span>
            : `${arenaPlayerScore(first)} - ${arenaPlayerScore(second)}`
          : <Swords size={19} className="text-gold" aria-label="versus" />}
      </span>
      <PlayerSide player={second} reverse />
    </div>
    {players.length > 2 && <div className="mt-2 flex flex-wrap items-center justify-center gap-x-3 gap-y-1">
      {players.slice(2).map((player) => <span key={player.user_id} className="flex min-w-0 max-w-[8rem] items-center gap-1 text-[11px] font-semibold text-stone">
        {player.tent_house_id && <TentHouseSymbol houseId={player.tent_house_id} size={18} />}
        <span className="truncate">{shortArenaName(player.display_name)}</span>
        {playing && (pinned
          ? <span className="rounded bg-[#192941] px-1.5 py-0.5"><LiveScore player={player} leading={isLeading(player)} /></span>
          : <strong className="text-ink">{arenaPlayerScore(player)}</strong>)}
      </span>)}
    </div>}
  </div>;
}
