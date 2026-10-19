import { useEffect, useMemo, useRef, useState } from 'react';
import { Dices, Maximize2, Minus, Plus, RotateCcw } from 'lucide-react';
import { DEFAULT_JOURNEY_CONFIG, type JourneyConfig, type JourneyGame, type JourneyLocation, type JourneyPlayer } from '../../supabase/functions/_shared/biblicalJourney';
import { JOURNEY_LOOP_POINTS, JOURNEY_MAIN_POINTS, journeyLoopPoint, journeyMainPoint } from '../lib/journeyBoardLayout';

type JourneyBoardProps = {
  game: JourneyGame;
  profiles: Record<string, { name: string; avatarUrl?: string | null }>;
  viewerId?: string;
  config?: JourneyConfig;
  dieValue?: number;
  rolling?: boolean;
  onServePrisonTurn?: () => void;
};

const BOARD_WIDTH = 1030;
const BOARD_HEIGHT = 780;
const mainRoute = JOURNEY_MAIN_POINTS.map((point) => `${point.x},${point.y}`).join(' ');
const loopRoute = [...JOURNEY_LOOP_POINTS, JOURNEY_LOOP_POINTS[0]].map((point) => `${point.x},${point.y}`).join(' ');

function pointFor(location: JourneyLocation) {
  if (location.route === 'loop') return journeyLoopPoint(location.space);
  if (location.route === 'prison') return location.prison === 'holding' ? { x: 910, y: 390 } : { x: 910, y: 520 };
  return journeyMainPoint(location.space);
}

function mainSpaceTone(space: number, config: JourneyConfig) {
  if (space === 1) return { fill: '#194337', stroke: '#8fc8a6', text: '#eaf9ed' };
  if (space === config.finishSpace) return { fill: '#886017', stroke: '#f4d177', text: '#fff6de' };
  if (space === config.finalChallengeSpace) return { fill: '#523c26', stroke: '#f3c477', text: '#fff3d6' };
  if (config.loopEntrances.includes(space)) return { fill: '#483443', stroke: '#dc98bb', text: '#ffe5f3' };
  const trap = config.traps[space];
  if (!trap) return { fill: '#233956', stroke: '#6785a9', text: '#edf4ff' };
  if (trap.effect.kind === 'move' && (trap.effect.by || 0) > 0) return { fill: '#23494b', stroke: '#81c5b7', text: '#e7fff5' };
  if (trap.effect.kind === 'prison' || trap.effect.kind === 'trial') return { fill: '#623c36', stroke: '#e8a08b', text: '#fff0e8' };
  return { fill: '#413952', stroke: '#c9a7db', text: '#fff0ff' };
}

function boardLabel(location: JourneyLocation, config: JourneyConfig) {
  if (location.route === 'prison') return location.prison === 'holding' ? 'Holding Prison' : 'Deep Prison';
  if (location.route === 'loop') {
    if (location.space === config.ordinaryExit) return `Loop ${location.space}: Ordinary Escape`;
    if (location.space === config.surpriseExit) return `Loop ${location.space}: Surprise Card`;
    return `Loop ${location.space}`;
  }
  const space = location.space;
  if (space === 1) return 'Space 1: Start';
  if (space === config.finishSpace) return `Space ${space}: Finish`;
  if (space === config.finalChallengeSpace) return `Space ${space}: Final Challenge`;
  if (config.loopEntrances.includes(space)) return `Space ${space}: Loop Entrance`;
  const trap = config.traps[space];
  if (trap) return `Space ${space}: ${trap.name}`;
  const milestone = config.milestones.find((item) => item.space === space);
  return milestone ? `Space ${space}: ${milestone.title}` : `Space ${space}`;
}

export function JourneyBoard({ game, profiles, viewerId, config = DEFAULT_JOURNEY_CONFIG,
  dieValue = 0, rolling = false, onServePrisonTurn }: JourneyBoardProps) {
  const [zoom, setZoom] = useState(1);
  const [selected, setSelected] = useState<JourneyLocation | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const players = game.players;
  const currentPlayer = game.players[game.turnIndex];
  const isMyTurn = currentPlayer?.id === viewerId && game.status === 'playing' && !game.pendingAction;
  const occupants = useMemo(() => {
    const grouped = new Map<string, JourneyPlayer[]>();
    players.forEach((player) => {
      const key = JSON.stringify(player.location);
      grouped.set(key, [...(grouped.get(key) || []), player]);
    });
    return grouped;
  }, [players]);

  useEffect(() => {
    if (!scrollRef.current || !currentPlayer) return;
    const point = pointFor(currentPlayer.location);
    const container = scrollRef.current;
    const scale = container.clientWidth * zoom / BOARD_WIDTH;
    const left = Math.max(0, point.x * scale - container.clientWidth / 2);
    const top = Math.max(0, point.y * scale - container.clientHeight / 2);
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    container.scrollTo({ left, top, behavior: reduceMotion ? 'instant' : 'smooth' });
  }, [currentPlayer, zoom]);

  const tokensAt = (location: JourneyLocation, size: number) => {
    const players = occupants.get(JSON.stringify(location)) || [];
    if (!players.length) return null;
    return players.map((player, index) => {
      const name = profiles[player.id]?.name || 'Player';
      const avatarUrl = profiles[player.id]?.avatarUrl;
      const offsetX = (index % 3 - 1) * size * 0.48;
      const offsetY = (Math.floor(index / 3) - Math.floor((players.length - 1) / 3) / 2) * size * 0.48;
      const active = currentPlayer?.id === player.id;
      const clipId = `journey-avatar-${player.id}`;
      return <g key={player.id} transform={`translate(${offsetX} ${offsetY})`} aria-label={`${name} is here`}>
        <defs><clipPath id={clipId}><circle r={size * 0.42} /></clipPath></defs>
        <circle r={size * 0.47} fill={active ? '#f1c75a' : '#dbe7f5'} />
        <circle r={size * 0.39} fill="#192c48" />
        <text textAnchor="middle" dominantBaseline="central" fill="#fff" fontSize={size * 0.43} fontWeight="700">{name.trim().charAt(0).toUpperCase()}</text>
        {avatarUrl && <image href={avatarUrl} x={-size * 0.42} y={-size * 0.42} width={size * 0.84} height={size * 0.84} clipPath={`url(#${clipId})`} preserveAspectRatio="xMidYMid slice" />}
      </g>;
    });
  };

  const select = (location: JourneyLocation) => setSelected(location);
  const selectedLabel = selected ? boardLabel(selected, config) : null;
  const currentLabel = currentPlayer ? boardLabel(currentPlayer.location, config) : 'Waiting for players';

  return <div className="space-y-3">
    <div className="flex flex-wrap items-center justify-between gap-2 px-1">
      <div className="min-w-0">
        <p className="font-display text-sm font-bold text-ink">The Biblical Journey</p>
        <p className="truncate text-xs text-stone" aria-live="polite">{currentPlayer ? profiles[currentPlayer.id]?.name || 'Player' : 'Player'} · {currentLabel}</p>
      </div>
      <div className="flex items-center gap-1" aria-label="Board controls">
        {isMyTurn && currentPlayer.location.route === 'prison' && onServePrisonTurn ?
          <button type="button" onClick={onServePrisonTurn} className="btn-primary h-9 justify-center px-2 text-xs" title="Serve prison turn"><RotateCcw size={16} /> Serve turn</button> :
          <div className="flex h-9 min-w-12 items-center justify-center gap-1 rounded-md border border-gold/50 bg-navy-2 px-2 font-display font-bold tabular-nums text-brass" aria-label={rolling ? 'Rolling the die' : dieValue ? `Last die: ${dieValue}` : 'Die ready'}>
            <Dices size={20} className={rolling ? 'animate-spin' : ''} aria-hidden="true" /><span>{rolling ? '-' : dieValue || '-'}</span>
          </div>}
        <button type="button" title="Zoom out" aria-label="Zoom out" onClick={() => setZoom((value) => Math.max(1, +(value - 0.25).toFixed(2)))} className="btn-ghost h-9 w-9 p-0"><Minus size={16} /></button>
        <input type="range" min="1" max="2.5" step="0.25" value={zoom} onChange={(event) => setZoom(Number(event.target.value))} aria-label="Board zoom" className="hidden w-16 accent-gold sm:block" />
        <button type="button" title="Zoom in" aria-label="Zoom in" onClick={() => setZoom((value) => Math.min(2.5, +(value + 0.25).toFixed(2)))} className="btn-ghost h-9 w-9 p-0"><Plus size={16} /></button>
        <button type="button" title="Full board overview" aria-label="Full board overview" onClick={() => { setZoom(1); scrollRef.current?.scrollTo({ left: 0, top: 0 }); }} className="btn-ghost h-9 w-9 p-0"><Maximize2 size={16} /></button>
      </div>
    </div>

    <div ref={scrollRef} className="relative aspect-[1030/780] w-full overflow-auto rounded-md border border-brass/45 bg-navy-2 overscroll-contain" style={{ touchAction: 'pan-x pan-y' }}>
      <div className="relative" style={{ width: `${zoom * 100}%`, aspectRatio: `${BOARD_WIDTH} / ${BOARD_HEIGHT}` }}>
        <svg viewBox={`0 0 ${BOARD_WIDTH} ${BOARD_HEIGHT}`} width="100%" height="100%" role="img" aria-label="Fifty-one-space serpentine journey board with a ten-space central loop and two prisons">
          <defs>
            <pattern id="journey-dot-grid" width="24" height="24" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r="1" fill="#b8c8df" opacity="0.13" /></pattern>
            <marker id="journey-arrow" markerWidth="7" markerHeight="7" refX="5" refY="3.5" orient="auto"><path d="M1 1L6 3.5 1 6" fill="none" stroke="#e5bd61" strokeWidth="1.5" /></marker>
          </defs>
          <rect width={BOARD_WIDTH} height={BOARD_HEIGHT} fill="#10223a" />
          <rect width={BOARD_WIDTH} height={BOARD_HEIGHT} fill="url(#journey-dot-grid)" />
          <polyline points={mainRoute} fill="none" stroke="#6c7f9e" strokeWidth="18" strokeLinecap="round" strokeLinejoin="round" opacity="0.24" />
          <polyline points={mainRoute} fill="none" stroke="#d9bd7c" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" opacity="0.72" />
          <polyline points={loopRoute} fill="none" stroke="#bf9d5a" strokeWidth="15" opacity="0.15" strokeLinejoin="round" />
          <polyline points={loopRoute} fill="none" stroke="#e8c779" strokeWidth="3" strokeDasharray="7 7" strokeLinejoin="round" />
          <path d={`M175 270 Q210 318 315 380`} fill="none" stroke="#d5a8c4" strokeWidth="3" strokeDasharray="5 5" markerEnd="url(#journey-arrow)" />
          <path d={`M770 270 Q690 315 520 345`} fill="none" stroke="#d5a8c4" strokeWidth="3" strokeDasharray="5 5" markerEnd="url(#journey-arrow)" />
          {[4, 10, 17, 27, 33, 40, 47].map((space) => {
            const start = journeyMainPoint(space);
            const end = journeyMainPoint(space + 1);
            return <line key={space} x1={start.x + (end.x - start.x) * 0.4} y1={start.y + (end.y - start.y) * 0.4}
              x2={start.x + (end.x - start.x) * 0.65} y2={start.y + (end.y - start.y) * 0.65}
              stroke="#e8c779" strokeWidth="2.5" markerEnd="url(#journey-arrow)" />;
          })}
          <ellipse cx="470" cy="447" rx="132" ry="73" fill="#0c1a2e" stroke="#b98d48" strokeWidth="1.5" opacity="0.9" />
          <text x="470" y="436" textAnchor="middle" fill="#e8c779" fontSize="16" fontWeight="800" fontFamily="inherit">THE LOOP</text>
          <text x="470" y="460" textAnchor="middle" fill="#b9c5d9" fontSize="12" fontFamily="inherit">Exact landing to escape</text>

          {JOURNEY_MAIN_POINTS.map((point, index) => {
            const space = index + 1;
            const tone = mainSpaceTone(space, config);
            const location: JourneyLocation = { route: 'main', space };
            const milestone = config.milestones.find((item) => item.space === space);
            return <g key={space} transform={`translate(${point.x} ${point.y})`} role="button" tabIndex={0}
              aria-label={boardLabel(location, config)} onClick={() => select(location)}
              onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') select(location); }} className="cursor-pointer">
              <title>{boardLabel(location, config)}</title>
              <circle r={space === 1 || space === 51 ? 26 : 22} fill={tone.fill} stroke={tone.stroke} strokeWidth="2.5" />
              <text textAnchor="middle" dominantBaseline="central" fill={tone.text} fontSize="14" fontWeight="800" fontFamily="inherit">{space}</text>
              {milestone && <circle r="27" fill="none" stroke="#e8c779" strokeWidth="1" opacity="0.6" />}
              {tokensAt(location, 21) && <g transform="translate(0 -27)">{tokensAt(location, 21)}</g>}
            </g>;
          })}

          {JOURNEY_LOOP_POINTS.map((point, index) => {
            const space = index + 1;
            const location: JourneyLocation = { route: 'loop', space };
            const escape = space === config.ordinaryExit;
            const surprise = space === config.surpriseExit;
            return <g key={`loop-${space}`} transform={`translate(${point.x} ${point.y})`} role="button" tabIndex={0}
              aria-label={boardLabel(location, config)} onClick={() => select(location)}
              onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') select(location); }} className="cursor-pointer">
              <title>{boardLabel(location, config)}</title>
              <circle r="20" fill={surprise ? '#705327' : escape ? '#24534f' : '#263754'} stroke={surprise ? '#f3c671' : escape ? '#90d4c1' : '#9aafcc'} strokeWidth="2" />
              <text textAnchor="middle" dominantBaseline="central" fill="#fff5dc" fontSize="13" fontWeight="800" fontFamily="inherit">{surprise ? '?' : space}</text>
              {tokensAt(location, 20) && <g transform="translate(0 -25)">{tokensAt(location, 20)}</g>}
            </g>;
          })}

          {(['holding', 'deep'] as const).map((name) => {
            const location: JourneyLocation = { route: 'prison', prison: name };
            const y = name === 'holding' ? 390 : 520;
            return <g key={name} role="button" tabIndex={0} aria-label={boardLabel(location, config)}
              onClick={() => select(location)} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') select(location); }} className="cursor-pointer">
              <rect x="855" y={y - 40} width="120" height="80" rx="7" fill={name === 'deep' ? '#4d302e' : '#394358'} stroke={name === 'deep' ? '#d19382' : '#97a9c6'} strokeWidth="2" />
              <text x="915" y={y - 7} textAnchor="middle" fill="#f7e4d9" fontSize="12" fontWeight="800" fontFamily="inherit">{name === 'deep' ? 'DEEP' : 'HOLDING'}</text>
              <text x="915" y={y + 13} textAnchor="middle" fill="#f7e4d9" fontSize="11" fontFamily="inherit">PRISON</text>
              <g transform={`translate(910 ${y - 18})`}>{tokensAt(location, 19)}</g>
            </g>;
          })}
        </svg>
      </div>
    </div>

    {selectedLabel && <div className="flex items-center justify-between gap-3 border-b border-border px-1 pb-2 text-xs text-stone">
      <span className="min-w-0 truncate">{selectedLabel}</span>
      <button type="button" className="text-brass" onClick={() => setSelected(null)}>Close</button>
    </div>}
    <div className="flex flex-wrap gap-x-4 gap-y-1 px-1 text-xs text-stone">
      {game.players.map((player) => <span key={player.id}><strong className="text-ink">{profiles[player.id]?.name || 'Player'}</strong> · {boardLabel(player.location, config)}{player.location.route === 'loop' ? ` · ${player.completedLoopCircuits} circuits` : ''}</span>)}
    </div>
    {game.events.length > 0 && <details className="border-t border-border px-1 pt-2 text-xs text-stone">
      <summary className="cursor-pointer font-semibold text-ink">Journey events</summary>
      <ol className="mt-2 max-h-32 space-y-1 overflow-y-auto" aria-live="polite">
        {game.events.slice(-8).reverse().map((event) => <li key={event.sequence}>
          {profiles[event.targetPlayerId]?.name || 'Player'} · {event.effectType.replace(/-/g, ' ')} · {boardLabel(event.newLocation, config)}{event.reason ? ` (${event.reason})` : ''}
        </li>)}
      </ol>
    </details>}
  </div>;
}
