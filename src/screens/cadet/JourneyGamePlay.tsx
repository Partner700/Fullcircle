import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, Loader2, MessageCircle, RotateCw, Send, X } from 'lucide-react';
import { ArenaMatchup } from '../../components/ArenaMatchup';
import { ArenaFinalScorecard } from '../../components/ArenaFinalScorecard';
import { ArenaWitnessChatDrawer } from '../../components/ArenaWitnessChatDrawer';
import { JourneyBoard } from '../../components/JourneyBoard';
import { supabase } from '../../lib/supabase';
import { fetchJourneyState, initializeJourney, sendJourneyCommand, type JourneyServerResponse } from '../../lib/journeyClient';
import type { ArenaMatchupPlayer } from '../../lib/arenaMatchup';
import { machineJourneyMayAct, type JourneyPublicState } from '../../../supabase/functions/_shared/biblicalJourneyRuntime';
import { DEFAULT_JOURNEY_CONFIG, JOURNEY_MACHINE_ID } from '../../../supabase/functions/_shared/biblicalJourney';

type Props = {
  roomId: string;
  roomName: string;
  userId: string;
  players: ArenaMatchupPlayer[];
  spectator: boolean;
  machine?: boolean;
  guestKey?: string;
  onExit: () => void;
  onStateChanged?: () => Promise<void> | void;
};

type Character = { slug: string; displayName: string; narrativeBeats: string[] };

function message(error: unknown) {
  return error instanceof Error ? error.message : 'The Journey could not be updated.';
}

function answerFromOrder(question: NonNullable<JourneyPublicState['currentQuestion']>, ordered: number[]) {
  return ordered.map((index) => {
    const prefix = question.options[index]?.match(/^([A-Z])\s*[.)]/i)?.[1];
    return (prefix || String.fromCharCode(65 + index)).toUpperCase();
  }).join(' ');
}

export function JourneyGamePlay({ roomId, roomName, userId, players, spectator, machine = false, guestKey, onExit, onStateChanged }: Props) {
  const [state, setState] = useState<JourneyPublicState | null>(null);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [botFailures, setBotFailures] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [answer, setAnswer] = useState('');
  const [order, setOrder] = useState<number[]>([]);
  const [chatOpen, setChatOpen] = useState(false);
  const [questionHidden, setQuestionHidden] = useState(false);
  const [character, setCharacter] = useState<Character | null>(null);
  const [publicPlayers, setPublicPlayers] = useState<ArenaMatchupPlayer[] | null>(null);
  const versionRef = useRef<number | null>(null);
  const fetchingRef = useRef(false);
  const initializationRef = useRef(false);
  const commandRef = useRef<{ signature: string; id: string } | null>(null);
  const completedRef = useRef(false);
  const onStateChangedRef = useRef(onStateChanged);
  onStateChangedRef.current = onStateChanged;

  const applyResponse = useCallback((response: JourneyServerResponse) => {
    if (response.unchanged || !response.state) return;
    const incomingVersion = response.version ?? response.state.game.version;
    if (versionRef.current !== null && incomingVersion < versionRef.current) return;
    versionRef.current = incomingVersion;
    setState(response.state);
    setError(null);
    if (response.state.game.status === 'finished' && !completedRef.current) {
      completedRef.current = true;
      void onStateChangedRef.current?.();
    }
  }, []);

  const load = useCallback(async () => {
    if (fetchingRef.current || document.visibilityState === 'hidden') return;
    fetchingRef.current = true;
    try {
      const response = await fetchJourneyState(roomId, versionRef.current ?? undefined);
      if (response.needsInitialization && !spectator && !initializationRef.current) {
        initializationRef.current = true;
        try { applyResponse(await initializeJourney(roomId)); }
        finally { initializationRef.current = false; }
      } else if (response.needsInitialization) {
        setError('The Journey board is opening. It will appear here shortly.');
      } else {
        applyResponse(response);
      }
    } catch (loadError) {
      if (versionRef.current === null) setError(message(loadError));
    } finally {
      fetchingRef.current = false;
      setLoading(false);
    }
  }, [applyResponse, roomId, spectator]);

  useEffect(() => {
    versionRef.current = null;
    completedRef.current = false;
    setState(null);
    setLoading(true);
    void load();
    const interval = window.setInterval(() => void load(), 5_000);
    const onVisible = () => { if (document.visibilityState === 'visible') void load(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { window.clearInterval(interval); document.removeEventListener('visibilitychange', onVisible); };
  }, [load]);

  useEffect(() => {
    setAnswer('');
    setOrder([]);
    setQuestionHidden(false);
  }, [state?.currentQuestion?.id]);

  useEffect(() => {
    if (!state?.characterSlug) return;
    let active = true;
    void supabase.rpc('list_ready_arena_journey_characters').then(({ data }) => {
      if (active) setCharacter(((data || []) as Character[]).find((item) => item.slug === state.characterSlug) || null);
    });
    return () => { active = false; };
  }, [state?.characterSlug]);

  useEffect(() => {
    if (!guestKey) return;
    let active = true;
    void supabase.rpc('get_public_arena_journey_matchup', { p_room_id: roomId }).then(({ data }) => {
      if (active && Array.isArray(data)) setPublicPlayers(data as ArenaMatchupPlayer[]);
    });
    return () => { active = false; };
  }, [guestKey, roomId]);

  const send = useCallback(async (action: 'ANSWER' | 'CHOOSE' | 'SERVE' | 'BOT', payload: Record<string, unknown> = {}) => {
    if (!state || spectator || sending) return;
    const version = versionRef.current ?? state.game.version;
    const signature = JSON.stringify({ version, action, payload });
    if (commandRef.current?.signature !== signature) commandRef.current = { signature, id: crypto.randomUUID() };
    setSending(true);
    setError(null);
    try {
      const response = await sendJourneyCommand(roomId, action, version, commandRef.current.id, payload);
      applyResponse(response);
      commandRef.current = null;
      if (action === 'BOT') setBotFailures(0);
    } catch (sendError) {
      const conflict = sendError as Error & { state?: JourneyPublicState | null; version?: number };
      if (conflict.state) {
        applyResponse({ state: conflict.state, version: conflict.version });
        commandRef.current = null;
      }
      setError(message(sendError));
      if (action === 'BOT') setBotFailures((count) => Math.min(count + 1, 5));
    } finally {
      setSending(false);
    }
  }, [applyResponse, roomId, sending, spectator, state]);

  const botMayAct = machine && !spectator && state ? machineJourneyMayAct(state) : false;
  useEffect(() => {
    if (!botMayAct || sending) return;
    let timer: number | undefined;
    const schedule = () => {
      if (timer) window.clearTimeout(timer);
      if (document.visibilityState === 'visible') {
        timer = window.setTimeout(() => void send('BOT'), Math.min(1500 * 2 ** botFailures, 15_000));
      }
    };
    document.addEventListener('visibilitychange', schedule);
    schedule();
    return () => { if (timer) window.clearTimeout(timer); document.removeEventListener('visibilitychange', schedule); };
  }, [botFailures, botMayAct, send, sending, state?.game.version]);

  const activePlayer = state?.game.players[state.game.turnIndex];
  const myTurn = !spectator && state?.game.status === 'playing'
    && (state.currentQuestionPlayerId === userId || (activePlayer?.id === userId && activePlayer.location.route === 'prison'));
  const openQuestion = state?.currentQuestion;
  const waitingForMyAnswer = myTurn && state?.currentQuestionPlayerId === userId;
  const mayChoose = !spectator && state?.game.pendingAction?.kind === 'choice'
    && state.game.pendingAction.playerId !== userId
    && state.game.players.some((player) => player.id === userId);
  const asking = Boolean(openQuestion && !questionHidden);
  const readyAnswer = openQuestion?.type === 'order_sequence'
    ? order.length === openQuestion.options.length
    : answer.trim().length > 0;
  const roster = useMemo(() => {
    const known = publicPlayers?.length ? publicPlayers : players;
    return machine && !known.some((player) => player.user_id === JOURNEY_MACHINE_ID)
      ? [...known, { user_id: JOURNEY_MACHINE_ID, display_name: 'The Scribe', avatar_url: null, tent_house_id: null, correct_count: 0 }]
      : known;
  }, [machine, players, publicPlayers]);
  const visiblePlayers = useMemo(() => roster.map((player) => ({
    ...player,
    correct_count: state?.game.players.find((candidate) => candidate.id === player.user_id)?.correctAnswers ?? player.correct_count,
  })), [roster, state?.game.players]);
  const profiles = useMemo(() => Object.fromEntries(roster.map((player) => [player.user_id, {
    name: player.display_name, avatarUrl: player.avatar_url,
  }])), [roster]);
  const boardConfig = useMemo(() => character?.narrativeBeats?.length === 7 ? {
    ...DEFAULT_JOURNEY_CONFIG,
    milestones: DEFAULT_JOURNEY_CONFIG.milestones.map((milestone, index) => ({
      ...milestone, title: character.narrativeBeats[index],
    })),
  } : DEFAULT_JOURNEY_CONFIG, [character]);

  if (loading && !state) return <div className="flex min-h-[20rem] items-center justify-center gap-2 text-sm text-stone"><Loader2 size={18} className="animate-spin text-brass" /> Opening the Journey...</div>;
  if (!state) return <div className="flex min-h-[20rem] flex-col items-center justify-center gap-3 text-center text-sm text-stone">
    <p>{error || 'The Journey has not started yet.'}</p>
    <button type="button" className="btn-secondary text-xs" onClick={() => void load()}><RotateCw size={15} /> Try again</button>
    <button type="button" className="btn-ghost text-xs" onClick={onExit}>Back to Arena</button>
  </div>;
  if (state.game.status === 'finished') return <ArenaFinalScorecard roomId={roomId} onExit={onExit} />;

  return <div className="space-y-4">
    <div className="border-b border-border pb-3">
      <p className="eyebrow text-brass">{character?.displayName || 'Biblical Journey'}</p>
      <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-display text-base font-semibold text-ink">{roomName.replace(/\s*\[.*?\]/g, '')}</h2>
        <button type="button" className="btn-ghost text-xs" onClick={onExit}>Back to Arena</button>
      </div>
    </div>
    <ArenaMatchup players={visiblePlayers} playing={state.game.status === 'playing'} />
    {error && <p className="rounded-md border border-coral/40 bg-coral-soft p-3 text-xs text-coral" role="alert">{error}</p>}
    <JourneyBoard game={state.game} profiles={profiles} viewerId={userId} config={boardConfig}
      dieValue={state.lastVerdict?.die || 0} rolling={sending && state.currentQuestionPlayerId === userId}
      onServePrisonTurn={myTurn && activePlayer?.location.route === 'prison' ? () => void send('SERVE') : undefined} />

    {state.lastVerdict && <div className="border-t border-border pt-3 text-xs text-stone" aria-live="polite">
      <p className="font-semibold text-ink">{profiles[state.lastVerdict.playerId]?.name || 'Player'} answered {state.lastVerdict.correct ? 'correctly' : 'incorrectly'}
        {state.lastVerdict.die ? ` · Dice ${state.lastVerdict.die}` : ''}</p>
      <p className="mt-1">Selected: {state.lastVerdict.selectedAnswer} · Answer: {state.lastVerdict.correctAnswer}</p>
      {state.lastVerdict.reference && <p className="mt-1">{state.lastVerdict.reference}</p>}
    </div>}

    {mayChoose && <div className="border-t border-border pt-3">
      <p className="mb-2 text-sm font-semibold text-ink">Choose your rival's penalty</p>
      <div className="flex flex-wrap gap-2">
        {[0, 1].map((choice) => <button key={choice} type="button" className="btn-secondary text-xs" disabled={sending} onClick={() => void send('CHOOSE', { choice })}>
          {choice === 0 ? 'First outcome' : 'Second outcome'}
        </button>)}
      </div>
    </div>}

    <button type="button" className="btn-secondary w-full justify-center text-xs" onClick={() => setChatOpen(true)}><MessageCircle size={15} /> Match chat</button>
    <ArenaWitnessChatDrawer roomId={roomId} userId={userId} guestKey={guestKey} open={chatOpen} showLauncher={spectator}
      onOpenChange={setChatOpen} allowGameCalls={spectator && !guestKey}
      challengeTargets={spectator && !guestKey ? players.filter((player) => player.user_id !== JOURNEY_MACHINE_ID).map((player) => ({ userId: player.user_id, name: player.display_name, avatarUrl: player.avatar_url || null })) : []} />

    {openQuestion && asking && state.game.status === 'playing' && <div className="fixed inset-0 z-[140] flex items-end justify-center bg-black/65 px-3 pb-[calc(env(safe-area-inset-bottom,0px)+0.75rem)] pt-3 backdrop-blur-sm sm:items-center" role="dialog" aria-modal={waitingForMyAnswer} aria-label="Biblical Journey question">
      <div className="w-full max-w-lg max-h-[85dvh] overflow-y-auto rounded-md border border-gold/40 bg-bg p-4 shadow-2xl">
        <div className="flex items-start justify-between gap-3">
          <div><p className="eyebrow text-brass">Stage {openQuestion.stage}</p><h3 className="mt-1 font-display text-base font-semibold text-ink">{profiles[state.currentQuestionPlayerId || '']?.name || 'Player'}'s question</h3></div>
          {!waitingForMyAnswer && <button type="button" title="Close question" aria-label="Close question" className="icon-btn h-8 w-8" onClick={() => setQuestionHidden(true)}><X size={17} /></button>}
        </div>
        <p className="mt-4 whitespace-pre-wrap text-sm leading-relaxed text-ink">{openQuestion.question}</p>
        {state.lastVerdict && <div className="mt-3 border-l-2 border-brass pl-3 text-xs text-stone" aria-live="polite">
          <p className="font-semibold text-ink">Previous answer: {profiles[state.lastVerdict.playerId]?.name || 'Player'} was {state.lastVerdict.correct ? 'correct' : 'incorrect'}.</p>
          <p>{state.lastVerdict.selectedAnswer} · Answer: {state.lastVerdict.correctAnswer}
            {state.lastVerdict.die ? ` · Dice ${state.lastVerdict.die}` : ''}</p>
        </div>}
        {waitingForMyAnswer && <div className="mt-4 space-y-2">
          {openQuestion.type === 'true_false' && <div className="grid grid-cols-2 gap-2">
            {['true', 'false'].map((value) => <button type="button" key={value} className={answer === value ? 'btn-primary justify-center' : 'btn-secondary justify-center'} onClick={() => setAnswer(value)}>{value === 'true' ? 'True' : 'False'}</button>)}
          </div>}
          {(openQuestion.type === 'multiple_choice' || openQuestion.type === 'odd_one') && openQuestion.options.map((option) =>
            <button type="button" key={option} className={answer === option ? 'btn-primary w-full justify-start text-left' : 'btn-secondary w-full justify-start text-left'} onClick={() => setAnswer(option)}>{option}</button>)}
          {openQuestion.type === 'fill_blank' && <input className="input-field" value={answer} onChange={(event) => setAnswer(event.target.value)} autoComplete="off" placeholder="Your answer" aria-label="Your answer" />}
          {openQuestion.type === 'order_sequence' && <>
            <p className="text-xs text-stone">Tap events in their order.</p>
            {order.length > 0 && <div className="flex flex-wrap gap-1">{order.map((index, position) => <button type="button" key={index} className="btn-secondary text-xs" onClick={() => setOrder((current) => current.filter((value) => value !== index))}>{position + 1}. {openQuestion.options[index]} <X size={12} /></button>)}</div>}
            {openQuestion.options.map((option, index) => <button type="button" key={index} className="btn-secondary w-full justify-start text-left text-xs" disabled={order.includes(index)} onClick={() => setOrder((current) => [...current, index])}>{option}</button>)}
          </>}
          <button type="button" className="btn-primary mt-3 w-full justify-center" disabled={!readyAnswer || sending} onClick={() => void send('ANSWER', {
            answer: openQuestion.type === 'order_sequence' ? answerFromOrder(openQuestion, order) : answer.trim(),
          })}>{sending ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />} Submit answer</button>
        </div>}
        {!waitingForMyAnswer && <p className="mt-4 text-xs text-stone">Waiting for the answer.</p>}
        {!waitingForMyAnswer && <button type="button" className="btn-ghost mt-3 w-full justify-center text-xs" onClick={() => setChatOpen(true)}><MessageCircle size={14} /> Open chat</button>}
      </div>
    </div>}
    {openQuestion && questionHidden && <button type="button" className="btn-secondary fixed bottom-[calc(env(safe-area-inset-bottom,0px)+4.5rem)] right-4 z-[139] text-xs shadow-lg" onClick={() => setQuestionHidden(false)}><ChevronDown size={14} /> Question</button>}
  </div>;
}
