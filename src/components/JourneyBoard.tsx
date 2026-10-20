import { useState, type CSSProperties } from 'react';
import { ArrowDown, ArrowLeftRight, ArrowUp, BookOpen, Crown, DoorOpen, Flag, Gift, Link2, LockKeyhole, Route, ShieldAlert, Swords, X } from 'lucide-react';
import { journeyConfigForGame, type JourneyConfig, type JourneyGame, type JourneyLocation } from '../../supabase/functions/_shared/biblicalJourney';
import { JOURNEY_BOARD_SIZE, JOURNEY_LOOP_POINTS, journeyMainPoints, JOURNEY_PRISON_POINTS, type JourneyPoint } from '../lib/journeyBoardLayout';
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
  arenaImage?: PanelImageSetting | null;
  config?: JourneyConfig;
  dieValue?: number;
  rolling?: boolean;
  revealing?: boolean;
  onRoll?: () => void;
  onServePrisonTurn?: () => void;
};
const position = (point: JourneyPoint): CSSProperties => ({ left: `${point.x / JOURNEY_BOARD_SIZE * 100}%`, top: `${point.y / JOURNEY_BOARD_SIZE * 100}%` });
const keyFor = (location: JourneyLocation) => location.route === 'prison' ? `prison:${location.prison}` : `${location.route}:${location.space}`;

export function JourneyBoard({ game, profiles, viewerId, arenaImage, config = journeyConfigForGame(game),
  dieValue = 0, rolling = false, revealing = false, onRoll, onServePrisonTurn }: Props) {
  const [selected, setSelected] = useState<JourneySquare | null>(null);
  const active = game.players[game.turnIndex];
  const mainPoints = journeyMainPoints(config.finishSpace);
  const occupants = new Map<string, typeof game.players>();
  for (const player of game.players) occupants.set(keyFor(player.location), [...(occupants.get(keyFor(player.location)) || []), player]);
  const tile = (location: JourneyLocation, point: JourneyPoint) => {
    const square = journeySquare(location, config);
    const people = occupants.get(keyFor(location)) || [];
    return <button key={keyFor(location)} type="button" className={`journey-square journey-${square.tone} ${location.route === 'loop' ? 'journey-trials-square' : ''} ${location.route === 'prison' ? 'journey-prison-square' : ''} ${people.some((player) => player.id === active?.id) ? 'journey-occupied' : ''}`}
      style={position(point)} title={square.title} aria-label={`${location.route === 'main' ? `Square ${location.space}: ` : ''}${square.title}${people.length ? `. ${people.map((player) => profiles[player.id]?.name || 'Player').join(', ')} here` : ''}`}
      onClick={() => setSelected(square)}>
      <span className="journey-square-number">{location.route === 'prison' ? (location.prison === 'holding' ? 'I' : 'II') : location.space}</span>
      {square.special && <JourneySquareIcon square={square} />}
      {people.length > 0 && <span className="journey-tokens">{people.map((player) => <span className={`journey-token ${player.id === viewerId ? 'journey-token-self' : ''}`} key={player.id}>
        <UserAvatar userId={player.id} name={profiles[player.id]?.name || 'Player'} avatarUrl={profiles[player.id]?.avatarUrl} showAwardBadge={false} className="h-full w-full" />
      </span>)}</span>}
    </button>;
  };
  return <div className="journey-board-wrap">
    <section className={`journey-board ${config.finishSpace === 51 ? 'journey-board-legacy' : ''}`} aria-label={`Biblical Journey: all ${config.finishSpace} squares, Trials and prisons`}>
      <PanelImageBackdrop image={arenaImage} opacityOverride={55} modeFilter={false} veilClassName="bg-[#14253d]/70" simple />
      <svg viewBox="0 0 720 720" className="journey-connectors" aria-hidden="true">
        <polyline points={[...mainPoints, mainPoints[0]].map((point) => `${point.x},${point.y}`).join(' ')} fill="none" stroke="#d1b365" strokeWidth="4" />
        <path d="M200 285H520V525H200Z" fill="none" stroke="#7b818c" strokeWidth="38" />
        <path d="M200 285H520V525H200Z" fill="none" stroke="#c6c8cd" strokeWidth="2" strokeDasharray="4 6" />
        {config.loopEntrances.map((space, index) => {
          const point = mainPoints[space - 1];
          return <path key={space} d={index ? `M${point.x} ${point.y}V610H200V550` : `M${point.x} ${point.y}H565V580H520V550`} fill="none" stroke="#c6c8cd" strokeWidth="2" strokeDasharray="7 6" />;
        })}
      </svg>
      {mainPoints.map((point, index) => tile({ route: 'main', space: index + 1 }, point))}
      {JOURNEY_LOOP_POINTS.map((point, index) => tile({ route: 'loop', space: index + 1 }, point))}
      {(['holding', 'deep'] as const).map((prison) => tile({ route: 'prison', prison }, JOURNEY_PRISON_POINTS[prison]))}
      <div className="journey-board-title"><span>FULL CIRCLE ARENA</span><strong>The Biblical Journey</strong><span>THREE LAPS TO VICTORY</span></div>
      <span className="journey-trials-title">THE TRIALS</span>
      <div className="journey-die-holder">
        {onServePrisonTurn ? <button type="button" className="journey-serve" onClick={onServePrisonTurn}><LockKeyhole size={24} /><span>Serve turn</span></button> :
          <ArenaDieButton value={dieValue} rolling={rolling} revealing={revealing} disabled={!onRoll} onRoll={() => onRoll?.()} className="journey-die" />}
      </div>
      <div className="journey-turn-name" aria-live="polite">{profiles[active?.id]?.name || 'Player'}{active?.id === viewerId ? ' · Your turn' : "'s turn"}</div>
    </section>
    {selected && <aside className="journey-square-detail" aria-label={selected.title} role="status">
      <JourneySquareIcon square={selected} /><div className="min-w-0 flex-1"><h3>{selected.title}</h3><p>{selected.description}</p></div>
      <button type="button" className="icon-btn shrink-0" aria-label="Close square details" onClick={() => setSelected(null)}><X size={18} /></button>
    </aside>}
    <div className="journey-player-positions">{game.players.map((player) => <span key={player.id}><strong>{profiles[player.id]?.name || 'Player'}</strong> · {player.completedLaps || 0}/{config.winningLaps} laps · {journeySquare(player.location, config).title}{player.location.route === 'loop' ? ` · ${player.completedLoopCircuits} Trials circuits` : ''}</span>)}</div>
  </div>;
}
