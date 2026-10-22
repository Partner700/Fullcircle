import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { ArrowDown, ArrowLeftRight, ArrowUp, BookOpen, Crown, DoorOpen, Flag, Gift, Link2, LockKeyhole, Route, ShieldAlert, Swords, X } from 'lucide-react';
import { journeyConfigForGame, type JourneyConfig, type JourneyGame, type JourneyLocation } from '../../supabase/functions/_shared/biblicalJourney';
import { JOURNEY_BOARD_HEIGHT, JOURNEY_BOARD_SIZE, JOURNEY_LOOP_POINTS, LEGACY_JOURNEY_LOOP_POINTS, journeyMainPoints, journeyMovementPath, type JourneyPoint } from '../lib/journeyBoardLayout';
import { journeySquare, type JourneySquare } from '../lib/journeyPresentation';
import { ArenaDieButton } from './ArenaDieButton';
import { UserAvatar } from './UserAvatar';
import { PanelImageBackdrop } from './PanelImageBackdrop';
import type { PanelImageSetting } from '../lib/types';
import './JourneyBoard.css';

const icons = { start: Flag, crown: Crown, book: BookOpen, trials: Route, escape: DoorOpen, card: Gift, lock: LockKeyhole, deep: ShieldAlert, forward: ArrowUp, backward: ArrowDown, swap: ArrowLeftRight, chain: Link2, challenge: Swords };
export function JourneySquareIcon({ square, size = 24 }: { square: JourneySquare; size?: number }) {
  const Icon = icons[square.icon];
  return <Icon size={size} aria-hidden="true" />;
}

type Props = {
  game: JourneyGame;
  profiles: Record<string, { name: string; avatarUrl?: string | null }>;
  viewerId?: string;
  characterName?: string;
  arenaImage?: PanelImageSetting | null;
  config?: JourneyConfig;
  dieValue?: number;
  rolling?: boolean;
  revealing?: boolean;
  onRoll?: () => void;
  onMovementFinished?: () => void;
};
const position = (point: JourneyPoint, height = JOURNEY_BOARD_HEIGHT): CSSProperties => ({ left: `${point.x / JOURNEY_BOARD_SIZE * 100}%`, top: `${point.y / height * 100}%` });
const keyFor = (location: JourneyLocation) => location.route === 'prison' ? `prison:${location.prison}` : `${location.route}:${location.space}`;
const visibleLocation = (player: JourneyGame['players'][number]): JourneyLocation =>
  player.location.route === 'prison' ? player.savedLocation || { route: 'main', space: 1 } : player.location;
const locationsFor = (game: JourneyGame) => Object.fromEntries(game.players.map((player) => [player.id, visibleLocation(player)]));

export function JourneyBoard({ game, profiles, viewerId, characterName, arenaImage, config = journeyConfigForGame(game),
  dieValue = 0, rolling = false, revealing = false, onRoll, onMovementFinished }: Props) {
  const [selected, setSelected] = useState<JourneySquare | null>(null);
  const [displayLocations, setDisplayLocations] = useState<Record<string, JourneyLocation>>(() => locationsFor(game));
  const displayRef = useRef(displayLocations);
  const lastSequence = useRef(game.events[game.events.length - 1]?.sequence || 0);
  useEffect(() => {
    const target = locationsFor(game);
    const latest = game.events[game.events.length - 1]?.sequence || 0;
    if (latest < lastSequence.current) {
      lastSequence.current = latest;
      displayRef.current = target;
      setDisplayLocations(target);
      onMovementFinished?.();
      return;
    }
    const events = game.events.filter((event) => event.sequence > lastSequence.current);
    lastSequence.current = latest;
    if (!events.length || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      displayRef.current = target;
      setDisplayLocations(target);
      onMovementFinished?.();
      return;
    }
    const frames: Record<string, JourneyLocation>[] = [];
    const cursor = { ...displayRef.current };
    for (const event of events) {
      for (const location of journeyMovementPath(event, config.finishSpace, config.loopLength)) {
        cursor[event.targetPlayerId] = location.route === 'prison' ? target[event.targetPlayerId] : location;
        frames.push({ ...cursor });
      }
    }
    if (!frames.length) {
      displayRef.current = target;
      setDisplayLocations(target);
      onMovementFinished?.();
      return;
    }
    let frame = 0;
    let timer: number;
    const advance = () => {
      const next = frames[frame++] || target;
      displayRef.current = next;
      setDisplayLocations(next);
      if (frame <= frames.length) timer = window.setTimeout(advance, 165);
      else onMovementFinished?.();
    };
    timer = window.setTimeout(advance, 40);
    return () => window.clearTimeout(timer);
  }, [game, config.finishSpace, config.loopLength, onMovementFinished]);
  const active = game.players[game.turnIndex];
  const mainPoints = journeyMainPoints(config.finishSpace);
  const legacy = config.finishSpace === 51;
  const boardHeight = legacy ? JOURNEY_BOARD_SIZE : JOURNEY_BOARD_HEIGHT;
  const loopPoints = legacy ? LEGACY_JOURNEY_LOOP_POINTS : JOURNEY_LOOP_POINTS;
  const occupants = new Map<string, typeof game.players>();
  for (const player of game.players) {
    const key = keyFor(displayLocations[player.id] || visibleLocation(player));
    occupants.set(key, [...(occupants.get(key) || []), player]);
  }
  const tile = (location: JourneyLocation, point: JourneyPoint) => {
    const square = journeySquare(location, config);
    const people = occupants.get(keyFor(location)) || [];
    return <button key={keyFor(location)} type="button" className={`journey-square journey-${square.tone} ${location.route === 'loop' ? 'journey-trials-square' : ''} ${location.route === 'prison' ? 'journey-prison-square' : ''} ${people.some((player) => player.id === active?.id) ? 'journey-occupied' : ''}`}
      style={position(point, boardHeight)} title={square.title} aria-label={`${location.route === 'main' ? `Square ${location.space}: ` : ''}${square.title}${people.length ? `. ${people.map((player) => profiles[player.id]?.name || 'Player').join(', ')} here` : ''}`}
      onClick={() => setSelected(square)}>
      <span className="journey-square-number">{location.route === 'prison' ? (location.prison === 'holding' ? 'I' : 'II') : location.space}</span>
      {square.special && <JourneySquareIcon square={square} />}
    </button>;
  };
  const title = characterName ? `${characterName}${/s$/i.test(characterName) ? "'" : "'s"} Journey` : 'The Journey';
  return <div className="journey-board-wrap">
    <section className={`journey-board ${legacy ? 'journey-board-legacy' : ''}`} aria-label={`${title}: all ${config.finishSpace} squares and the Trials`}>
      <PanelImageBackdrop image={arenaImage} opacityOverride={55} modeFilter={false} veilClassName="bg-[#14253d]/70" simple />
      <svg viewBox={`0 0 720 ${boardHeight}`} className="journey-connectors" aria-hidden="true">
        <polyline points={[...mainPoints, mainPoints[0]].map((point) => `${point.x},${point.y}`).join(' ')} fill="none" stroke="#d1b365" strokeWidth="4" />
        <path d={legacy ? 'M200 285H520V525H200Z' : 'M200 375H520V615H200Z'} fill="none" stroke="#7b818c" strokeWidth="38" />
        <path d={legacy ? 'M200 285H520V525H200Z' : 'M200 375H520V615H200Z'} fill="none" stroke="#c6c8cd" strokeWidth="2" strokeDasharray="4 6" />
        {config.loopEntrances.map((space, index) => {
          const point = mainPoints[space - 1];
          return <path key={space} d={legacy
            ? index ? `M${point.x} ${point.y}V610H200V550` : `M${point.x} ${point.y}H565V580H520V550`
            : index ? `M${point.x} ${point.y}V705H200V640` : `M${point.x} ${point.y}H565V640H520V615`}
            fill="none" stroke="#c6c8cd" strokeWidth="2" strokeDasharray="7 6" />;
        })}
      </svg>
      {mainPoints.map((point, index) => tile({ route: 'main', space: index + 1 }, point))}
      {loopPoints.map((point, index) => tile({ route: 'loop', space: index + 1 }, point))}
      {game.players.map((player) => {
        const location = displayLocations[player.id] || visibleLocation(player);
        const point = location.route === 'loop' ? loopPoints[location.space - 1]
          : mainPoints[location.route === 'main' ? location.space - 1 : 0];
        const slot = (occupants.get(keyFor(location)) || []).findIndex((occupant) => occupant.id === player.id);
        return <span key={player.id} className={`journey-piece ${player.id === viewerId ? 'journey-piece-self' : ''} ${player.prisonTurnsRemaining > 0 ? 'journey-piece-jailed' : ''}`}
          style={{ ...position(point, boardHeight), transform: `translate(calc(-50% + ${slot % 2 * 8}px), calc(-50% + ${Math.floor(slot / 2) * 8}px))` }}
          title={`${profiles[player.id]?.name || 'Player'}${player.prisonTurnsRemaining > 0 ? ` · ${player.prisonTurnsRemaining} turns missed` : ''}`}>
          <UserAvatar userId={player.id} name={profiles[player.id]?.name || 'Player'} avatarUrl={profiles[player.id]?.avatarUrl} showAwardBadge={false} className="h-full w-full" />
        </span>;
      })}
      <div className="journey-board-title"><span>FULL CIRCLE ARENA</span><strong>{title}</strong><span>{config.winningLaps} LAPS TO VICTORY</span></div>
      <span className="journey-trials-title">THE TRIALS</span>
      <div className="journey-die-holder">
        <ArenaDieButton value={dieValue} rolling={rolling} revealing={revealing} disabled={!onRoll} onRoll={() => onRoll?.()} className="journey-die" />
      </div>
      <div className="journey-turn-name" aria-live="polite">{profiles[active?.id]?.name || 'Player'}{active?.id === viewerId ? ' · Your turn' : "'s turn"}</div>
    </section>
    {selected && <aside className="journey-square-detail" aria-label={selected.title} role="status">
      <JourneySquareIcon square={selected} /><div className="min-w-0 flex-1"><h3>{selected.title}</h3><p>{selected.description}</p></div>
      <button type="button" className="icon-btn shrink-0" aria-label="Close square details" onClick={() => setSelected(null)}><X size={18} /></button>
    </aside>}
    <div className="journey-player-positions">{game.players.map((player) => <span key={player.id}><strong>{profiles[player.id]?.name || 'Player'}</strong> · {player.completedLaps || 0}/{config.winningLaps} laps · {journeySquare(visibleLocation(player), config).title}{player.prisonTurnsRemaining > 0 ? ` · misses ${player.prisonTurnsRemaining} turns` : ''}{player.location.route === 'loop' ? ` · ${player.completedLoopCircuits} Trials circuits` : ''}</span>)}</div>
  </div>;
}
