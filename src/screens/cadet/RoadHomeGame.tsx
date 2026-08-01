import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CircleDollarSign, Clock, Crown, Dices, Gift, History, Loader2,
  Flag, LockKeyhole, RotateCw, Shield, Sparkles, Trophy, Users, X,
} from 'lucide-react';
import { Dove } from '../../components/Dove';
import { fetchRoadHomeState, initializeRoadHome, sendRoadHomeCommand } from '../../lib/queries';
import { supabase } from '../../lib/supabase';
import { cn } from '../../lib/utils';
import type { RoadHomePawn, RoadHomePlayer, RoadHomeState } from '../../lib/roadHomeTypes';
import { playRoundWarningBeep, playSoundEffect } from '../../lib/soundscape';

type Props = {
  roomId: string;
  roomName: string;
  userId: string;
  prepareQuestions?: () => Promise<void>;
  onExit: () => void;
  onStateChanged?: () => Promise<void> | void;
};

type Coordinate = readonly [number, number];
type RoadHomeCommandError = Error & { state?: RoadHomeState | null };
type RollOutcome = { value: number; message: string };
type TurnActivity = RoadHomeState['eventLog'][number] & { diceValue?: number };

const PAWN_STEP_MS = 170;

function roadHomeError(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

const TRACK: Coordinate[] = [
  [6, 1], [6, 2], [6, 3], [6, 4], [6, 5], [5, 6], [4, 6], [3, 6], [2, 6], [1, 6], [0, 6], [0, 7], [0, 8],
  [1, 8], [2, 8], [3, 8], [4, 8], [5, 8], [6, 9], [6, 10], [6, 11], [6, 12], [6, 13], [6, 14], [7, 14], [8, 14],
  [8, 13], [8, 12], [8, 11], [8, 10], [8, 9], [9, 8], [10, 8], [11, 8], [12, 8], [13, 8], [14, 8], [14, 7], [14, 6],
  [13, 6], [12, 6], [11, 6], [10, 6], [9, 6], [8, 5], [8, 4], [8, 3], [8, 2], [8, 1], [8, 0], [7, 0], [6, 0],
];

const HOME_LANES: Coordinate[][] = [
  [[7, 1], [7, 2], [7, 3], [7, 4], [7, 5], [7, 6]],
  [[1, 7], [2, 7], [3, 7], [4, 7], [5, 7], [6, 7]],
  [[7, 13], [7, 12], [7, 11], [7, 10], [7, 9], [7, 8]],
  [[13, 7], [12, 7], [11, 7], [10, 7], [9, 7], [8, 7]],
];

const BASE_SLOTS: Coordinate[][] = [
  [[2, 2], [2, 4], [4, 2], [4, 4]],
  [[2, 10], [2, 12], [4, 10], [4, 12]],
  [[10, 10], [10, 12], [12, 10], [12, 12]],
  [[10, 2], [10, 4], [12, 2], [12, 4]],
];

const FINISH_SLOTS: Coordinate[] = [[6, 6], [6, 8], [8, 8], [8, 6]];
const SAFE_SPACES = new Set([0, 8, 13, 21, 26, 34, 39, 47]);
const PRISON_SPACES = new Set([6, 19, 32, 45]);
const SURPRISE_SPACES = new Set([10, 23, 36, 49]);
const COLOUR_CLASS: Record<string, string> = {
  coral: 'bg-coral border-white text-white',
  royal: 'bg-royal border-white text-white',
  sage: 'bg-sage border-white text-white',
  gold: 'bg-gold border-white text-navy-2',
};
const COLOUR_SOFT: Record<string, string> = {
  coral: 'bg-coral/18 border-coral/40',
  royal: 'bg-royal/18 border-royal/40',
  sage: 'bg-sage/18 border-sage/40',
  gold: 'bg-gold/18 border-gold/40',
};

function key([row, col]: Coordinate) {
  return `${row}-${col}`;
}

function pawnCoordinate(player: RoadHomePlayer, playerIndex: number, pawn: RoadHomePawn): Coordinate {
  if (pawn.progress < 0) return BASE_SLOTS[playerIndex][pawn.number - 1];
  if (pawn.progress < 52) return TRACK[(player.startOffset + pawn.progress) % 52];
  if (pawn.progress < 58) return HOME_LANES[playerIndex][pawn.progress - 52];
  return FINISH_SLOTS[playerIndex];
}

function baseOwner(row: number, col: number) {
  if (row <= 5 && col <= 5) return 0;
  if (row <= 5 && col >= 9) return 1;
  if (row >= 9 && col >= 9) return 2;
  if (row >= 9 && col <= 5) return 3;
  return null;
}

function formatPhase(state: RoadHomeState, mine: boolean) {
  const active = state.players[state.activePlayerIndex];
  if (state.phase === 'GAME_OVER') return 'The road is complete';
  if (!mine) return `${active?.name || 'A player'} is taking a turn`;
  if (state.phase === 'AWAITING_ROLL') return 'Roll the dice';
  if (state.phase === 'QUESTION') return state.questionPurpose === 'inherited' ? 'Answer the inherited challenge' : state.questionPurpose === 'prison' ? 'Answer for freedom' : 'Answer to earn your move';
  if (state.phase === 'SELECTING_PAWN') return `Choose a pawn to move ${state.pendingMoveValue}`;
  if (state.phase === 'INHERITED_OFFER') return 'An inherited challenge is waiting';
  if (state.phase === 'PRISON_MANAGEMENT') return 'Resolve your imprisoned pawn';
  if (state.phase === 'SURPRISE_CARD') return 'A Surprise Card appeared';
  return 'The Road Home';
}

export function RoadHomeGame({ roomId, roomName, userId, prepareQuestions, onExit, onStateChanged }: Props) {
  const [state, setState] = useState<RoadHomeState | null>(null);
  const [loading, setLoading] = useState(true);
  const [initializing, setInitializing] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [typedAnswer, setTypedAnswer] = useState('');
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [showLog, setShowLog] = useState(false);
  const [rollOutcome, setRollOutcome] = useState<RollOutcome | null>(null);
  const [visualPawnProgress, setVisualPawnProgress] = useState<Record<string, number>>({});
  const [movingPawnIds, setMovingPawnIds] = useState<Set<string>>(new Set());
  const timedOutVersion = useRef<number | null>(null);
  const finishedNotified = useRef(false);
  const hasState = useRef(false);
  const visualPawnProgressRef = useRef<Record<string, number>>({});
  const pawnAnimationTimers = useRef<number[]>([]);
  const knownEventIds = useRef<Set<string> | null>(null);
  const activityTimers = useRef<number[]>([]);
  const [liveActivity, setLiveActivity] = useState<TurnActivity | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetchRoadHomeState(roomId);
      if (response.state) {
        hasState.current = true;
        setState(response.state);
        setError(null);
      } else if (response.needsInitialization) {
        setInitializing(true);
        try { await prepareQuestions?.(); } catch { /* The server has a verified local question pool. */ }
        const initialized = await initializeRoadHome(roomId);
        hasState.current = Boolean(initialized.state);
        setState(initialized.state);
      }
    } catch (loadError: unknown) {
      if (!hasState.current) setError(roadHomeError(loadError, 'The Road Home board could not load.'));
    } finally {
      setLoading(false);
      setInitializing(false);
    }
  }, [prepareQuestions, roomId]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    const channel = supabase.channel(`road-home-${roomId}`).on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'arena_ludo_public_states', filter: `room_id=eq.${roomId}` },
      (payload) => {
        const snapshot = (payload.new as { public_state?: RoadHomeState })?.public_state;
        if (snapshot) {
          hasState.current = true;
          setState(snapshot);
        }
      },
    ).subscribe();
    const interval = window.setInterval(() => {
      if (document.visibilityState === 'visible') void load();
    }, 5000);
    return () => { window.clearInterval(interval); void supabase.removeChannel(channel); };
  }, [load, roomId]);

  const send = useCallback(async (action: string, payload: Record<string, unknown> = {}) => {
    if (!state || sending) return false;
    setSending(true);
    setError(null);
    if (action === 'ROLL') setRollOutcome(null);
    try {
      const response = await sendRoadHomeCommand(roomId, action, payload, state.version);
      if (response.state) {
        hasState.current = true;
        setState(response.state);
        if (action === 'ROLL') {
          const events = response.state.eventLog;
          let rollIndex = -1;
          for (let index = events.length - 1; index >= 0; index -= 1) {
            if (events[index].type === 'DICE_ROLLED' && events[index].playerId === userId) {
              rollIndex = index;
              break;
            }
          }
          if (rollIndex >= 0) {
            const rollEvent = events[rollIndex];
            const value = Number(rollEvent.message.match(/rolled\s+(\d+)/i)?.[1] || 0);
            const noMove = events.slice(rollIndex + 1).find((event) => event.type === 'NO_LEGAL_MOVE' && event.playerId === userId);
            if (noMove) {
              setRollOutcome({ value, message: `${rollEvent.message} A 6 is needed to deploy a pawn from base.` });
            }
          }
        }
      }
      setTypedAnswer('');
      return true;
    } catch (commandError: unknown) {
      const typedError = commandError as RoadHomeCommandError;
      if (typedError.state) setState(typedError.state);
      const message = roadHomeError(commandError, 'That move could not be completed.');
      setError(message);
      if (/changed on another device|advanced/i.test(message)) window.setTimeout(() => void load(), 350);
      return false;
    } finally {
      setSending(false);
    }
  }, [load, roomId, sending, state, userId]);

  const activePlayer = state?.players[state.activePlayerIndex] || null;
  const myTurn = activePlayer?.id === userId;
  const me = state?.players.find((player) => player.id === userId) || null;
  const activeChallenge = state?.challengeQueue.find((challenge) => challenge.id === state.activeChallengeId) || null;

  const forfeitMatch = async () => {
    if (!window.confirm('Forfeit The Road Home? Your stake remains in the prize pool and this cannot be undone.')) return;
    const forfeited = await send('FORFEIT');
    if (!forfeited) return;
    await onStateChanged?.();
    onExit();
  };
  const latestMoveEvent = useMemo(() => state ? [...state.eventLog].reverse().find((event) => [
    'PAWN_DEPLOYED', 'PAWN_MOVED', 'PAWN_CAPTURED', 'PAWN_HOME', 'PAWN_IMPRISONED', 'PAWN_RELEASED',
  ].includes(event.type)) || null : null, [state]);

  useEffect(() => {
    if (!state) return;
    const relevant = state.eventLog.filter((event) => [
      'TURN_STARTED', 'DICE_ROLLED', 'QUESTION_DRAWN', 'QUESTION_CORRECT', 'QUESTION_INCORRECT',
      'NO_LEGAL_MOVE', 'PAWN_DEPLOYED', 'PAWN_MOVED', 'PAWN_CAPTURED', 'PAWN_HOME', 'PAWN_IMPRISONED',
      'PAWN_RELEASED', 'SURPRISE_DRAWN', 'GAME_ENDED',
    ].includes(event.type));
    if (!knownEventIds.current) {
      knownEventIds.current = new Set(state.eventLog.map((event) => event.id));
      setLiveActivity(relevant[relevant.length - 1] || null);
      return;
    }
    const fresh = relevant.filter((event) => !knownEventIds.current!.has(event.id));
    state.eventLog.forEach((event) => knownEventIds.current!.add(event.id));
    if (!fresh.length) return;
    activityTimers.current.forEach((timer) => window.clearTimeout(timer));
    activityTimers.current = fresh.map((event, index) => window.setTimeout(() => {
      const diceValue = event.type === 'DICE_ROLLED'
        ? Number(event.message.match(/rolled\s+(\d+)/i)?.[1] || 0)
        : undefined;
      setLiveActivity({ ...event, diceValue: diceValue || undefined });
    }, index * 850));
    return () => {
      activityTimers.current.forEach((timer) => window.clearTimeout(timer));
      activityTimers.current = [];
    };
  }, [state]);

  useEffect(() => {
    if (!state) return;
    pawnAnimationTimers.current.forEach((timer) => window.clearTimeout(timer));
    pawnAnimationTimers.current = [];

    const targets = Object.fromEntries(state.players.flatMap((player) => player.pawns.map((pawn) => [pawn.id, pawn.progress])));
    if (Object.keys(visualPawnProgressRef.current).length === 0) {
      visualPawnProgressRef.current = targets;
      setVisualPawnProgress(targets);
      return;
    }

    const changes = Object.entries(targets).map(([pawnId, target]) => ({
      pawnId,
      from: visualPawnProgressRef.current[pawnId] ?? target,
      target,
    })).filter((change) => change.from !== change.target);
    if (changes.length === 0) return;

    const moving = new Set(changes.map((change) => change.pawnId));
    setMovingPawnIds(moving);
    const forwardChanges = changes.filter((change) => change.target > change.from && change.target - change.from <= 12);
    const longestForwardMove = Math.max(0, ...forwardChanges.map((change) => change.target - change.from));
    const settleDelay = Math.max(PAWN_STEP_MS, (longestForwardMove + 1) * PAWN_STEP_MS);

    const schedule = (callback: () => void, delay: number) => {
      const timer = window.setTimeout(callback, delay);
      pawnAnimationTimers.current.push(timer);
    };
    const updateVisualProgress = (pawnId: string, progress: number) => {
      visualPawnProgressRef.current = { ...visualPawnProgressRef.current, [pawnId]: progress };
      setVisualPawnProgress((current) => ({ ...current, [pawnId]: progress }));
    };

    changes.forEach((change) => {
      const forwardDistance = change.target - change.from;
      if (forwardDistance > 0 && forwardDistance <= 12) {
        for (let step = 1; step <= forwardDistance; step += 1) {
          schedule(() => updateVisualProgress(change.pawnId, change.from + step), step * PAWN_STEP_MS);
        }
      } else {
        // Captured pawns return to base after the attacking pawn finishes hopping.
        schedule(() => updateVisualProgress(change.pawnId, change.target), settleDelay);
      }
    });
    schedule(() => setMovingPawnIds(new Set()), settleDelay + PAWN_STEP_MS);

    return () => {
      pawnAnimationTimers.current.forEach((timer) => window.clearTimeout(timer));
      pawnAnimationTimers.current = [];
    };
  }, [state]);

  useEffect(() => {
    if (!state?.questionDeadline || state.phase !== 'QUESTION') { setSecondsLeft(0); return; }
    const update = () => setSecondsLeft(Math.max(0, Math.ceil((new Date(state.questionDeadline!).getTime() - Date.now()) / 1000)));
    update();
    const timer = window.setInterval(update, 250);
    return () => window.clearInterval(timer);
  }, [state?.phase, state?.questionDeadline, state?.version]);

  useEffect(() => {
    if (!state || !myTurn || state.phase !== 'QUESTION' || secondsLeft > 0 || timedOutVersion.current === state.version) return;
    timedOutVersion.current = state.version;
    void send('ANSWER', { answer: '' });
  }, [myTurn, secondsLeft, send, state]);

  useEffect(() => {
    if (secondsLeft > 0 && secondsLeft <= 5 && state?.phase === 'QUESTION') playRoundWarningBeep();
  }, [secondsLeft, state?.phase]);

  useEffect(() => {
    if (state?.phase === 'GAME_OVER' && !finishedNotified.current) {
      finishedNotified.current = true;
      void playSoundEffect('sound_arena_finish', 0.72);
      void onStateChanged?.();
    }
  }, [onStateChanged, state?.phase]);

  if (loading || initializing) {
    return (
      <div className="flex min-h-[28rem] flex-col items-center justify-center gap-4 text-center">
        <Dove size={76} className="animate-float" />
        <div><Loader2 size={22} className="mx-auto animate-spin text-gold" /><p className="mt-2 text-sm font-semibold text-ink">{initializing ? 'Preparing the four roads...' : 'Opening The Road Home...'}</p><p className="mt-1 text-xs text-stone">The question deck and shared board are synchronising.</p></div>
      </div>
    );
  }

  if (!state) {
    return <div className="mx-auto max-w-md space-y-4 py-10 text-center"><Dove size={64} className="mx-auto" /><p className="text-sm text-coral">{error || 'The Road Home is not ready.'}</p><button onClick={() => void load()} className="btn-primary"><RotateCw size={15} /> Try Again</button><button onClick={onExit} className="btn-ghost">Leave Room</button></div>;
  }

  if (state.phase === 'GAME_OVER') {
    return <RoadHomeResults state={state} userId={userId} onExit={onExit} />;
  }

  return (
    <div className="mx-auto max-w-7xl space-y-4 animate-fade-in">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0"><p className="eyebrow">Full Circle: The Road Home</p><h2 className="truncate font-display text-xl font-bold text-ink">{roomName.replace(/\s*\[.*?\]/g, '')}</h2></div>
        <div className="flex items-center gap-2">
          <button onClick={() => setShowLog((value) => !value)} className="btn-secondary px-3 py-2 text-xs"><History size={14} /> Events</button>
          <button onClick={() => void forfeitMatch()} disabled={sending} className="btn-ghost px-3 py-2 text-xs text-coral disabled:opacity-50"><Flag size={14} /> Forfeit</button>
          <button onClick={onExit} className="btn-ghost h-9 w-9 p-0" title="Leave this view"><X size={17} /></button>
        </div>
      </div>

      {error && <div className="flex items-center justify-between gap-3 rounded-lg border border-coral/35 bg-coral-soft px-3 py-2 text-xs text-coral"><span>{error}</span><button onClick={() => setError(null)} aria-label="Dismiss"><X size={14} /></button></div>}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="space-y-4">
          <PlayerStrip state={state} userId={userId} />
          {latestMoveEvent && (
            <div key={latestMoveEvent.id} className="flex items-center gap-2 rounded-lg border border-gold/30 bg-surface/92 px-3 py-2 text-xs text-stone animate-fade-in" aria-live="polite">
              <Sparkles size={14} className="flex-shrink-0 text-gold" />
              <span><strong className="text-ink">Latest move:</strong> {latestMoveEvent.message}</span>
            </div>
          )}
          <div className="relative mx-auto w-full max-w-[46rem] overflow-hidden rounded-lg border border-border-bright bg-surface/92 p-2 shadow-xl sm:p-3">
            <RoadHomeBoard state={state} userId={userId} sending={sending} visualPawnProgress={visualPawnProgress} movingPawnIds={movingPawnIds} onMove={(pawnId) => void send('MOVE', { pawnId })} />
          </div>
        </div>

        <aside className="space-y-3">
          <div className={cn('rounded-lg border p-4', myTurn ? 'border-gold/50 bg-gold-soft' : 'border-border bg-surface/90')}>
            <div className="flex items-center gap-3">
              <PlayerAvatar player={activePlayer!} size="lg" />
              <div className="min-w-0"><p className="text-[10px] font-bold uppercase text-stone">Turn {state.turnNumber}</p><p className="truncate text-sm font-bold text-ink">{formatPhase(state, myTurn)}</p></div>
              {(liveActivity?.diceValue || state.diceValue) && <Dice value={liveActivity?.diceValue || state.diceValue || 1} rolling={liveActivity?.type === 'DICE_ROLLED'} />}
            </div>
          </div>

          {myTurn ? (
            <TurnControls
              state={state}
              me={me!}
              challenge={activeChallenge}
              secondsLeft={secondsLeft}
              typedAnswer={typedAnswer}
              setTypedAnswer={setTypedAnswer}
              sending={sending}
              rollOutcome={rollOutcome}
              send={send}
            />
          ) : <OpponentTurnPanel state={state} activity={liveActivity} />}

          {me && <RelicTray player={me} state={state} sending={sending} send={send} />}

          <div className="rounded-lg border border-border bg-surface/90 p-3">
            <div className="mb-2 flex items-center justify-between"><p className="text-xs font-bold text-ink">Challenge Queue</p><span className="badge badge-brass text-[9px]">{state.challengeQueue.filter((item) => item.status === 'OPEN').length} open</span></div>
            {state.challengeQueue.filter((item) => item.status === 'OPEN').length ? state.challengeQueue.filter((item) => item.status === 'OPEN').slice(0, 3).map((challenge) => <div key={challenge.id} className="mb-1.5 rounded-md bg-surface-2 px-2.5 py-2 text-[11px] text-stone"><span className="font-bold text-ink">Inherited {challenge.rolledValue}</span> from {state.players.find((player) => player.id === challenge.originPlayerId)?.name || 'a player'}</div>) : <p className="text-[11px] text-stone">No inherited question is circulating.</p>}
          </div>
        </aside>
      </div>

      {showLog && <EventLog state={state} onClose={() => setShowLog(false)} />}
    </div>
  );
}

function PlayerAvatar({ player, size = 'sm' }: { player: RoadHomePlayer; size?: 'sm' | 'lg' }) {
  return <div className={cn('relative flex flex-shrink-0 items-center justify-center overflow-hidden rounded-full border-2 font-bold shadow-sm', size === 'lg' ? 'h-11 w-11' : 'h-8 w-8', COLOUR_CLASS[player.colour])}>{player.avatarUrl ? <img src={player.avatarUrl} alt={player.name} className="h-full w-full object-cover" /> : player.isBot ? <Dove size={size === 'lg' ? 38 : 28} /> : player.name.charAt(0).toUpperCase()}</div>;
}

function PlayerStrip({ state, userId }: { state: RoadHomeState; userId: string }) {
  return <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">{state.players.map((player, index) => {
    const active = index === state.activePlayerIndex;
    const home = player.pawns.filter((pawn) => pawn.progress === 58).length;
    return <div key={player.id} className={cn('min-w-0 rounded-lg border bg-surface/90 p-2.5 transition-all', active ? 'border-gold shadow-md' : 'border-border')}><div className="flex items-center gap-2"><PlayerAvatar player={player} /><div className="min-w-0 flex-1"><p className="truncate text-xs font-bold text-ink">{player.name}{player.id === userId ? ' · You' : ''}</p><div className="mt-0.5 flex gap-2 text-[10px] text-stone"><span>{player.denarii}D</span><span>{home}/4 home</span></div></div>{active && <span className="rounded-full bg-gold-soft px-1.5 py-0.5 text-[8px] font-bold uppercase text-gold">Turn</span>}</div></div>;
  })}</div>;
}

function RoadHomeBoard({ state, userId, sending, visualPawnProgress, movingPawnIds, onMove }: {
  state: RoadHomeState;
  userId: string;
  sending: boolean;
  visualPawnProgress: Record<string, number>;
  movingPawnIds: Set<string>;
  onMove: (pawnId: string) => void;
}) {
  const tokenMap = useMemo(() => {
    const map = new Map<string, { player: RoadHomePlayer; pawn: RoadHomePawn; playerIndex: number }[]>();
    state.players.forEach((player, playerIndex) => player.pawns.forEach((pawn) => {
      const coordinate = pawnCoordinate(player, playerIndex, {
        ...pawn,
        progress: visualPawnProgress[pawn.id] ?? pawn.progress,
      });
      map.set(key(coordinate), [...(map.get(key(coordinate)) || []), { player, pawn, playerIndex }]);
    }));
    return map;
  }, [state.players, visualPawnProgress]);

  const trackByKey = useMemo(() => new Map(TRACK.map((coordinate, index) => [key(coordinate), index])), []);
  const laneByKey = useMemo(() => new Map(HOME_LANES.flatMap((lane, playerIndex) => lane.map((coordinate) => [key(coordinate), playerIndex] as const))), []);

  return <div className="grid aspect-square w-full grid-cols-[repeat(15,minmax(0,1fr))] overflow-hidden rounded-md border border-border bg-surface-2" aria-label="The Road Home Ludo board">{Array.from({ length: 225 }, (_, flatIndex) => {
    const row = Math.floor(flatIndex / 15);
    const col = flatIndex % 15;
    const cellKey = `${row}-${col}`;
    const trackIndex = trackByKey.get(cellKey);
    const laneOwner = laneByKey.get(cellKey);
    const owner = baseOwner(row, col);
    const centre = row >= 6 && row <= 8 && col >= 6 && col <= 8;
    const tokens = tokenMap.get(cellKey) || [];
    return <div key={cellKey} className={cn(
      'relative flex min-h-0 min-w-0 items-center justify-center border-[0.5px] border-border/55',
      trackIndex != null ? 'bg-surface' : owner != null ? COLOUR_SOFT[state.players[owner]?.colour || 'gold'] : centre ? 'bg-navy-3' : 'bg-surface-2',
      laneOwner != null && COLOUR_SOFT[state.players[laneOwner]?.colour || 'gold'],
      trackIndex != null && SAFE_SPACES.has(trackIndex) && 'ring-1 ring-inset ring-sage/70',
      trackIndex != null && PRISON_SPACES.has(trackIndex) && 'bg-coral/12',
      trackIndex != null && SURPRISE_SPACES.has(trackIndex) && 'bg-gold/18',
    )}>
      {trackIndex != null && SAFE_SPACES.has(trackIndex) && <Shield size={9} className="absolute text-sage/70" />}
      {trackIndex != null && PRISON_SPACES.has(trackIndex) && <LockKeyhole size={9} className="absolute text-coral/75" />}
      {trackIndex != null && SURPRISE_SPACES.has(trackIndex) && <Gift size={9} className="absolute text-gold/80" />}
      {centre && row === 7 && col === 7 && <Crown size={18} className="text-peri/80" />}
      {tokens.map(({ player, pawn }, tokenIndex) => {
        const legal = player.id === userId && state.legalPawnIds.includes(pawn.id) && state.phase === 'SELECTING_PAWN';
        return <button key={pawn.id} type="button" disabled={!legal || sending} onClick={() => onMove(pawn.id)} title={`${player.name} pawn ${pawn.number}${pawn.prisonRounds ? ` · prison ${pawn.prisonRounds}` : ''}`} className={cn(
          'absolute z-10 flex h-[72%] w-[72%] max-h-8 max-w-8 items-center justify-center rounded-full border-2 text-[clamp(7px,1.4vw,11px)] font-black shadow-md transition-all',
          COLOUR_CLASS[player.colour],
          tokens.length > 1 && tokenIndex === 0 && '-translate-x-[18%] -translate-y-[18%]',
          tokens.length > 1 && tokenIndex === 1 && 'translate-x-[18%] translate-y-[18%]',
          tokens.length > 2 && tokenIndex === 2 && 'translate-x-[18%] -translate-y-[18%]',
          tokens.length > 3 && tokenIndex === 3 && '-translate-x-[18%] translate-y-[18%]',
          legal && 'animate-pulse cursor-pointer ring-2 ring-white ring-offset-1 ring-offset-gold hover:scale-110',
          movingPawnIds.has(pawn.id) && 'z-20 animate-bounce ring-2 ring-white/80',
        )}>{pawn.prisonRounds ? <LockKeyhole size={10} /> : pawn.number}</button>;
      })}
    </div>;
  })}</div>;
}

function Dice({ value, rolling = false }: { value: number; rolling?: boolean }) {
  const dots: Record<number, number[]> = { 1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8] };
  return <div className={cn('grid h-10 w-10 flex-shrink-0 grid-cols-3 rounded-lg border border-gold/50 bg-surface p-1 shadow-inner animate-scale-in', rolling && 'animate-bounce')}>{Array.from({ length: 9 }, (_, index) => <span key={index} className={cn('m-auto h-1.5 w-1.5 rounded-full', dots[value]?.includes(index) ? 'bg-gold' : 'bg-transparent')} />)}</div>;
}

function OpponentTurnPanel({ state, activity }: { state: RoadHomeState; activity: TurnActivity | null }) {
  const active = state.players[state.activePlayerIndex];
  const actor = activity?.playerId ? state.players.find((player) => player.id === activity.playerId) || active : active;
  const copy: Record<string, string> = {
    TURN_STARTED: 'is up next.',
    DICE_ROLLED: 'rolled the dice.',
    QUESTION_DRAWN: 'is answering a Bible question.',
    QUESTION_CORRECT: 'answered correctly and earned the move.',
    QUESTION_INCORRECT: 'missed the question. The turn moves on.',
    NO_LEGAL_MOVE: 'has no legal move for that roll.',
    PAWN_DEPLOYED: 'brought a pawn onto the road.',
    PAWN_MOVED: 'is moving a pawn forward.',
    PAWN_CAPTURED: 'captured an opponent pawn.',
    PAWN_HOME: 'brought a pawn Home.',
    PAWN_IMPRISONED: 'landed in prison.',
    PAWN_RELEASED: 'released a pawn from prison.',
    SURPRISE_DRAWN: 'drew a Surprise Card.',
  };
  const message = activity ? `${actor?.name || 'A player'} ${copy[activity.type] || activity.message}` : `${active?.name || 'A player'} is taking a turn.`;
  return <div className="rounded-lg border border-royal/35 bg-surface/95 p-4" aria-live="polite">
    <div className="flex items-center gap-3">
      {actor && <PlayerAvatar player={actor} size="lg" />}
      <div className="min-w-0 flex-1"><p className="text-[10px] font-bold uppercase text-royal">Live opponent turn</p><p className="mt-0.5 text-sm font-bold text-ink">{message}</p></div>
      {activity?.diceValue ? <Dice value={activity.diceValue} rolling /> : <Users size={22} className="text-royal" />}
    </div>
    <p className="mt-3 text-xs leading-relaxed text-stone">The shared board updates after each roll, answer, and move. Question wording stays private until the turn is resolved.</p>
  </div>;
}

type SendCommand = (action: string, payload?: Record<string, unknown>) => Promise<boolean>;

function TurnControls({ state, me, challenge, secondsLeft, typedAnswer, setTypedAnswer, sending, rollOutcome, send }: {
  state: RoadHomeState;
  me: RoadHomePlayer;
  challenge: RoadHomeState['challengeQueue'][number] | null;
  secondsLeft: number;
  typedAnswer: string;
  setTypedAnswer: (value: string) => void;
  sending: boolean;
  rollOutcome: RollOutcome | null;
  send: SendCommand;
}) {
  if (state.phase === 'AWAITING_ROLL') return <div className="rounded-lg border border-gold/40 bg-surface/95 p-4 text-center">{rollOutcome ? <div className="mb-4 animate-scale-in rounded-lg border border-gold/35 bg-gold-soft p-3"><div className="flex justify-center"><Dice value={rollOutcome.value} /></div><p className="mt-2 text-sm font-bold text-ink">{rollOutcome.message}</p><p className="mt-1 text-[11px] text-stone">No move was available, so the turn passed normally.</p></div> : <><Dices size={34} className="mx-auto text-gold" /><p className="mt-2 text-sm font-bold text-ink">Your road is waiting</p><p className="mt-1 text-xs text-stone">A 6 can deploy a pawn. Every legal roll must be earned with a Bible answer.</p></>}<button onClick={() => void send('ROLL')} disabled={sending} className="btn-primary mt-4 w-full py-3">{sending ? <Loader2 size={17} className="animate-spin" /> : <Dices size={17} />} {rollOutcome ? 'Roll Again' : 'Roll'}</button></div>;

  if (state.phase === 'INHERITED_OFFER' && challenge) return <div className="rounded-lg border border-royal/45 bg-royal/10 p-4"><p className="eyebrow text-royal">Inherited Challenge</p><h3 className="mt-1 text-lg font-bold text-ink">Move value: {challenge.rolledValue}</h3><p className="mt-2 text-xs leading-relaxed text-stone">Accept and answer for +20D and the inherited move. A wrong answer costs up to 20D, but you still keep your normal roll. Declining forfeits this turn.</p><div className="mt-4 grid grid-cols-2 gap-2"><button disabled={sending} onClick={() => void send('CHALLENGE_DECISION', { decision: 'accept' })} className="btn-primary text-xs">Accept</button><button disabled={sending} onClick={() => void send('CHALLENGE_DECISION', { decision: 'decline' })} className="btn-secondary text-xs text-coral">Decline Turn</button></div></div>;

  if (state.phase === 'PRISON_MANAGEMENT') {
    const pawn = me.pawns.find((item) => item.id === state.activePrisonPawnId) || me.pawns.find((item) => item.prisonRounds > 0);
    if (!pawn) return null;
    const fine = pawn.prisonRounds * 40;
    return <div className="rounded-lg border border-coral/40 bg-coral/10 p-4"><div className="flex items-center gap-2"><LockKeyhole size={20} className="text-coral" /><div><p className="text-sm font-bold text-ink">Pawn {pawn.number} is in prison</p><p className="text-xs text-stone">{pawn.prisonRounds} round{pawn.prisonRounds === 1 ? '' : 's'} remaining</p></div></div><div className="mt-4 space-y-2"><button disabled={sending} onClick={() => void send('PRISON_ACTION', { pawnId: pawn.id, decision: 'question' })} className="btn-primary w-full text-xs">Answer Very Hard Question</button><button disabled={sending || me.denarii < fine} onClick={() => void send('PRISON_ACTION', { pawnId: pawn.id, decision: 'pay' })} className="btn-secondary w-full text-xs"><CircleDollarSign size={14} /> Pay {fine}D Fine</button><button disabled={sending} onClick={() => void send('PRISON_ACTION', { pawnId: pawn.id, decision: 'serve' })} className="btn-ghost w-full text-xs">Serve This Round</button></div></div>;
  }

  if (state.phase === 'SURPRISE_CARD' && state.pendingSurprise) return <div className="rounded-lg border border-gold/50 bg-gold/10 p-5 text-center animate-scale-in"><Sparkles size={30} className="mx-auto text-gold" /><p className="eyebrow mt-2">Surprise Card</p><h3 className="mt-1 text-lg font-bold text-ink">{state.pendingSurprise.title}</h3><p className="mt-2 text-xs leading-relaxed text-stone">{state.pendingSurprise.detail}</p><button disabled={sending} onClick={() => void send('ACK_SURPRISE')} className="btn-primary mt-4 w-full text-xs">Turn the Card</button></div>;

  if (state.phase === 'SELECTING_PAWN') return <div className="rounded-lg border border-sage/45 bg-sage/10 p-4"><p className="text-sm font-bold text-ink">Choose a highlighted pawn</p><p className="mt-1 text-xs text-stone">Your correct answer earned {state.pendingMoveValue} spaces. Legal pawns pulse on the board.</p><div className="mt-3 grid grid-cols-2 gap-2">{me.pawns.filter((pawn) => state.legalPawnIds.includes(pawn.id)).map((pawn) => <button key={pawn.id} disabled={sending} onClick={() => void send('MOVE', { pawnId: pawn.id })} className="btn-secondary text-xs">Pawn {pawn.number}<span className="text-[9px] text-stone">{pawn.progress < 0 ? 'Base' : pawn.progress >= 58 ? 'Home' : `Road ${pawn.progress + 1}`}</span></button>)}</div></div>;

  if (state.phase === 'QUESTION' && state.currentQuestion) {
    const question = state.currentQuestion;
    return <div className="rounded-lg border border-royal/45 bg-surface/95 p-4"><div className="flex items-center justify-between gap-2"><span className="badge badge-brass text-[9px]">{state.questionPurpose === 'inherited' ? 'Inherited' : state.questionPurpose === 'prison' ? 'Prison' : state.questionPurpose === 'verse' ? 'Verse Card' : state.questionPurpose === 'surprise' ? 'Surprise' : question.difficulty.replace('_', ' ')}</span><span className={cn('flex items-center gap-1 text-xs font-bold', secondsLeft <= 5 ? 'text-coral' : 'text-gold')}><Clock size={13} /> {secondsLeft}s</span></div><h3 className="mt-3 text-base font-bold leading-snug text-ink">{question.prompt}</h3>{question.options?.length ? <div className="mt-4 space-y-2">{question.options.map((option) => <button key={option} disabled={sending} onClick={() => void send('ANSWER', { answer: option })} className="w-full rounded-lg border border-border bg-surface-2 p-3 text-left text-xs font-semibold text-ink transition-colors hover:border-gold">{option}</button>)}</div> : <form className="mt-4 space-y-2" onSubmit={(event) => { event.preventDefault(); if (typedAnswer.trim()) void send('ANSWER', { answer: typedAnswer.trim() }); }}><input className="input-field" autoFocus value={typedAnswer} onChange={(event) => setTypedAnswer(event.target.value)} placeholder="Type your answer" /><button disabled={sending || !typedAnswer.trim()} className="btn-primary w-full text-xs">Submit Answer</button></form>}</div>;
  }
  return null;
}

function RelicTray({ player, state, sending, send }: { player: RoadHomePlayer; state: RoadHomeState; sending: boolean; send: SendCommand }) {
  if (!player.relics.length) return <div className="rounded-lg border border-border bg-surface/90 p-3"><p className="text-xs font-bold text-ink">Relics · 0/3</p><p className="mt-1 text-[11px] text-stone">Surprise spaces can reveal match relics.</p></div>;
  const usable = (relic: string) => relic === 'Manna Pouch' || (relic === 'Key of Deliverance' && state.phase === 'PRISON_MANAGEMENT') || (relic === 'Lamp of Guidance' && state.phase === 'QUESTION' && state.currentQuestion?.type === 'multiple_choice') || (relic === 'Scroll of Recall' && state.phase === 'QUESTION') || (relic === 'Golden Scroll' && state.phase === 'QUESTION' && state.questionPurpose === 'own') || (relic === "Shepherd's Staff" && state.phase === 'INHERITED_OFFER');
  return <div className="rounded-lg border border-border bg-surface/90 p-3"><div className="mb-2 flex items-center justify-between"><p className="text-xs font-bold text-ink">Relics</p><span className="text-[10px] text-stone">{player.relics.length}/3</span></div><div className="space-y-1.5">{player.relics.map((relic, index) => <button key={`${relic}-${index}`} disabled={sending || !usable(relic)} onClick={() => void send('USE_RELIC', { relic })} className="flex w-full items-center gap-2 rounded-md border border-border bg-surface-2 px-2.5 py-2 text-left text-[11px] font-semibold text-ink disabled:opacity-55"><Sparkles size={13} className="text-gold" /><span className="min-w-0 flex-1 truncate">{relic}</span>{usable(relic) && <span className="text-[9px] text-sage">Use</span>}</button>)}</div></div>;
}

function EventLog({ state, onClose }: { state: RoadHomeState; onClose: () => void }) {
  return <div className="fixed inset-0 z-[110] flex items-end justify-center bg-black/50 p-3 sm:items-center" onClick={onClose}><section className="card max-h-[80vh] w-full max-w-lg overflow-hidden p-0" onClick={(event) => event.stopPropagation()}><div className="flex items-center justify-between border-b border-border p-4"><div><p className="text-sm font-bold text-ink">Match Events</p><p className="text-[10px] text-stone">The authoritative history of this game</p></div><button onClick={onClose} className="btn-ghost h-8 w-8 p-0"><X size={16} /></button></div><div className="max-h-[65vh] space-y-2 overflow-y-auto p-4">{[...state.eventLog].reverse().map((event) => <div key={event.id} className="rounded-md border border-border bg-surface-2 p-2.5"><p className="text-[9px] font-bold uppercase text-brass">{event.type.replace(/_/g, ' ')}</p><p className="mt-0.5 text-xs leading-relaxed text-stone">{event.message}</p></div>)}</div></section></div>;
}

function RoadHomeResults({ state, userId, onExit }: { state: RoadHomeState; userId: string; onExit: () => void }) {
  const ranking = state.rankings.map((id) => state.players.find((player) => player.id === id)).filter(Boolean) as RoadHomePlayer[];
  const winner = ranking[0];
  const knowledgeable = [...state.players].sort((a, b) => b.stats.correct - a.stats.correct)[0];
  const strategic = [...state.players].sort((a, b) => (b.stats.captured + b.stats.inheritedClaimed) - (a.stats.captured + a.stats.inheritedClaimed))[0];
  return <div className="mx-auto max-w-3xl space-y-4 animate-scale-in"><div className="card border-gold/40 p-6 text-center"><Trophy size={48} className="mx-auto text-gold" /><p className="eyebrow mt-3">The Road Home</p><h2 className="mt-1 font-display text-2xl font-bold text-ink">{winner?.id === userId ? 'You reached Home first' : `${winner?.name || 'The victor'} reached Home first`}</h2><p className="mt-2 text-sm text-stone">The four-pawn race is complete and the tenfold Arena reward has been settled.</p></div><div className="grid gap-3 sm:grid-cols-2">{ranking.map((player, index) => <div key={player.id} className="card flex items-center gap-3 p-4"><span className="flex h-9 w-9 items-center justify-center rounded-full bg-gold-soft font-display font-bold text-gold">{index + 1}</span><PlayerAvatar player={player} size="lg" /><div className="min-w-0"><p className="truncate text-sm font-bold text-ink">{player.name}</p><p className="text-[10px] text-stone">{index === 0 ? 'The Victor' : index === 1 ? 'The Finisher' : index === 2 ? 'The Traveller' : 'The Sojourner'} · {player.stats.correct} correct</p></div></div>)}</div><div className="grid gap-3 sm:grid-cols-2"><div className="card p-4"><p className="eyebrow">Most Knowledgeable</p><p className="mt-1 font-bold text-ink">{knowledgeable?.name}</p><p className="text-xs text-stone">{knowledgeable?.stats.correct} correct answers</p></div><div className="card p-4"><p className="eyebrow">Most Strategic</p><p className="mt-1 font-bold text-ink">{strategic?.name}</p><p className="text-xs text-stone">{strategic?.stats.captured} captures · {strategic?.stats.inheritedClaimed} inherited claims</p></div></div><button onClick={onExit} className="btn-primary w-full">Back to Arena</button></div>;
}
