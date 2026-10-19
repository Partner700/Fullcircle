import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { CheckCircle2, ChevronDown, Clock3, Dices, Loader2, MessageCircle, RotateCw, Send, X, XCircle } from 'lucide-react';
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
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [timeoutRetry, setTimeoutRetry] = useState(0);
  const [verdictVisible, setVerdictVisible] = useState(false);
  const [character, setCharacter] = useState<Character | null>(null);
  const [publicPlayers, setPublicPlayers] = useState<ArenaMatchupPlayer[] | null>(null);
  const versionRef = useRef<number | null>(null);
  const fetchingRef = useRef(false);
  const initializationRef = useRef(false);
  const commandRef = useRef<{ signature: string; id: string } | null>(null);
  const completedRef = useRef(false);
  const verdictRef = useRef<string | null>(null);
  const timedOutRef = useRef<string | null>(null);
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
    if (!state?.questionDeadline || !state.currentQuestion) { setSecondsLeft(0); return; }
    const tick = () => setSecondsLeft(Math.max(0, Math.ceil((Date.parse(state.questionDeadline!) - Date.now()) / 1000)));
    tick();
    const timer = window.setInterval(tick, 250);
    return () => window.clearInterval(timer);
  }, [state?.questionDeadline, state?.currentQuestion?.id]);

  useLayoutEffect(() => {
    const verdictKey = state?.lastVerdict ? `${state.lastVerdict.questionId}:${state.game.version}` : null;
    if (!verdictKey) { setVerdictVisible(false); return; }
    if (verdictRef.current === verdictKey) return;
    verdictRef.current = verdictKey;
    setVerdictVisible(true);
    const timer = window.setTimeout(() => setVerdictVisible(false), 3200);
    return () => window.clearTimeout(timer);
  }, [state?.lastVerdict, state?.game.version]);

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

  const send = useCallback(async (action: 'ANSWER' | 'EXPIRE' | 'CHOOSE' | 'SERVE' | 'BOT', payload: Record<string, unknown> = {}) => {
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
        return;
      }
      setError(message(sendError));
      if (action === 'BOT') setBotFailures((count) => Math.min(count + 1, 5));
      if (action === 'EXPIRE') window.setTimeout(() => {
        timedOutRef.current = null;
        setTimeoutRetry((count) => count + 1);
      }, 2500);
    } finally {
      setSending(false);
    }
  }, [applyResponse, roomId, sending, spectator, state]);

  const botMayAct = machine && !spectator && !verdictVisible && state ? machineJourneyMayAct(state) : false;
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
  useEffect(() => {
    if (!state?.currentQuestion || !state.questionDeadline || spectator || sending
      || Date.now() < Date.parse(state.questionDeadline)
      || machine && state.currentQuestionPlayerId === JOURNEY_MACHINE_ID) return;
    const key = `${state.currentQuestion.id}:${state.game.version}`;
    if (timedOutRef.current === key) return;
    timedOutRef.current = key;
    void send('EXPIRE');
  }, [machine, secondsLeft, send, sending, spectator, state, timeoutRetry]);
  const mayChoose = !spectator && state?.game.pendingAction?.kind === 'choice'
    && state.game.pendingAction.playerId !== userId
    && state.game.players.some((player) => player.id === userId);
  const asking = Boolean(openQuestion && !questionHidden && !verdictVisible);
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
        <div className="flex items-center gap-1">
          <button type="button" className="btn-ghost text-xs" onClick={() => setChatOpen(true)}><MessageCircle size={15} /> Chat</button>
          <button type="button" className="btn-ghost text-xs" onClick={onExit}>Back to Arena</button>
        </div>
      </div>
    </div>
    <ArenaMatchup players={visiblePlayers} playing={state.game.status === 'playing'} />
    {error && <p className="rounded-md border border-coral/40 bg-coral-soft p-3 text-xs text-coral" role="alert">{error}</p>}
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(18rem,23rem)] xl:items-start">
      <JourneyBoard game={state.game} profiles={profiles} viewerId={userId} config={boardConfig}
        dieValue={state.lastVerdict?.die || 0} rolling={sending && state.currentQuestionPlayerId === userId}
        onServePrisonTurn={myTurn && activePlayer?.location.route === 'prison' ? () => void send('SERVE') : undefined} />
      <div className="min-w-0 space-y-3">
        {verdictVisible && state.lastVerdict ? <div className={`rounded-md border p-4 ${state.lastVerdict.correct ? 'border-sage/50 bg-sage/10' : 'border-coral/50 bg-coral-soft'}`} aria-live="assertive" role="status">
          <div className="flex items-center gap-2">
            {state.lastVerdict.correct ? <CheckCircle2 size={24} className="text-sage" /> : <XCircle size={24} className="text-coral" />}
            <h3 className="font-display text-lg font-bold text-ink">{state.lastVerdict.correct ? 'Correct answer' : state.lastVerdict.selectedAnswer === 'Time expired' ? 'Time is up' : 'Not quite'}</h3>
            {state.lastVerdict.die && <span className="ml-auto flex items-center gap-1 font-display text-xl font-bold text-brass"><Dices size={20} /> {state.lastVerdict.die}</span>}
          </div>
          <p className="mt-2 text-xs text-stone">{profiles[state.lastVerdict.playerId]?.name || 'Player'} · {state.lastVerdict.question}</p>
          <p className="mt-3 text-sm text-ink">Selected: <strong>{state.lastVerdict.selectedAnswer}</strong></p>
          <p className="mt-1 text-sm text-ink">Answer: <strong>{state.lastVerdict.correctAnswer}</strong></p>
          {state.lastVerdict.explanation && <p className="mt-2 text-xs text-stone">{state.lastVerdict.explanation}</p>}
          {state.lastVerdict.reference && <p className="mt-1 text-xs text-brass">{state.lastVerdict.reference}</p>}
        </div> : null}

        {openQuestion && asking && state.game.status === 'playing' && <section className="min-w-0 rounded-md border border-brass/45 bg-surface p-4" aria-label="Biblical Journey question">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0"><p className="eyebrow text-brass">Stage {openQuestion.stage}</p><h3 className="mt-1 font-display text-base font-semibold text-ink">{profiles[state.currentQuestionPlayerId || '']?.name || 'Player'}'s turn</h3></div>
            <div className="flex shrink-0 items-center gap-1">
              <span className={`flex items-center gap-1 font-display text-sm font-bold tabular-nums ${secondsLeft <= 5 ? 'text-coral' : 'text-brass'}`} aria-live="off"><Clock3 size={15} /> {secondsLeft}s</span>
              {!waitingForMyAnswer && <button type="button" title="Hide question" aria-label="Hide question" className="icon-btn h-8 w-8" onClick={() => setQuestionHidden(true)}><X size={17} /></button>}
            </div>
          </div>
          <div className="mt-3 h-1 overflow-hidden rounded-full bg-border" role="progressbar" aria-valuenow={secondsLeft} aria-valuemin={0} aria-valuemax={30} aria-label="Question time remaining">
            <div className={`h-full transition-[width] duration-200 ${secondsLeft <= 5 ? 'bg-coral' : 'bg-gold'}`} style={{ width: `${Math.min(100, secondsLeft / 30 * 100)}%` }} />
          </div>
          <p className="mt-4 whitespace-pre-wrap text-sm font-medium leading-relaxed text-ink">{openQuestion.question}</p>
          {waitingForMyAnswer && <div className="mt-4 max-h-[48dvh] space-y-2 overflow-y-auto pr-1">
            {openQuestion.type === 'true_false' && <div className="grid grid-cols-2 gap-2">
              {['true', 'false'].map((value) => <button type="button" key={value} className={answer === value ? 'btn-primary justify-center' : 'btn-secondary justify-center'} onClick={() => setAnswer(value)}>{value === 'true' ? 'True' : 'False'}</button>)}
            </div>}
            {(openQuestion.type === 'multiple_choice' || openQuestion.type === 'odd_one') && openQuestion.options.map((option, index) =>
              <button type="button" key={`${index}-${option}`} className={answer === option ? 'btn-primary w-full justify-start text-left' : 'btn-secondary w-full justify-start text-left'} onClick={() => setAnswer(option)}><span className="mr-2 font-display font-bold">{String.fromCharCode(65 + index)}.</span>{option}</button>)}
            {openQuestion.type === 'fill_blank' && <input className="input-field" value={answer} onChange={(event) => setAnswer(event.target.value)} autoComplete="off" placeholder="Your answer" aria-label="Your answer" />}
            {openQuestion.type === 'order_sequence' && <>
              <p className="text-xs text-stone">Tap events in their order.</p>
              {order.length > 0 && <div className="flex flex-wrap gap-1">{order.map((index, position) => <button type="button" key={index} className="btn-secondary text-xs" onClick={() => setOrder((current) => current.filter((value) => value !== index))}>{position + 1}. {openQuestion.options[index]} <X size={12} /></button>)}</div>}
              {openQuestion.options.map((option, index) => <button type="button" key={index} className="btn-secondary w-full justify-start text-left text-xs" disabled={order.includes(index)} onClick={() => setOrder((current) => [...current, index])}>{option}</button>)}
            </>}
            <button type="button" className="btn-primary mt-3 w-full justify-center" disabled={!readyAnswer || sending || secondsLeft === 0} onClick={() => void send('ANSWER', {
              answer: openQuestion.type === 'order_sequence' ? answerFromOrder(openQuestion, order) : answer.trim(),
            })}>{sending ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />} Submit answer</button>
          </div>}
          {!waitingForMyAnswer && <p className="mt-3 text-xs text-stone">Waiting for the answer.</p>}
          <button type="button" className="btn-ghost mt-3 w-full justify-center text-xs" onClick={() => setChatOpen(true)}><MessageCircle size={14} /> Open chat</button>
        </section>}
        {openQuestion && questionHidden && !verdictVisible && <div className="flex gap-2"><button type="button" className="btn-secondary flex-1 justify-center text-xs" onClick={() => setQuestionHidden(false)}><ChevronDown size={14} /> Show question</button><button type="button" className="btn-secondary justify-center text-xs" onClick={() => setChatOpen(true)}><MessageCircle size={14} /> Chat</button></div>}
        {!openQuestion && !verdictVisible && <p className="border-t border-border pt-3 text-sm text-stone">Waiting for the next move.</p>}
      </div>
    </div>

    {mayChoose && <div className="border-t border-border pt-3">
      <p className="mb-2 text-sm font-semibold text-ink">Choose your rival's penalty</p>
      <div className="flex flex-wrap gap-2">
        {[0, 1].map((choice) => <button key={choice} type="button" className="btn-secondary text-xs" disabled={sending} onClick={() => void send('CHOOSE', { choice })}>
          {choice === 0 ? 'First outcome' : 'Second outcome'}
        </button>)}
      </div>
    </div>}

    <ArenaWitnessChatDrawer roomId={roomId} userId={userId} guestKey={guestKey} open={chatOpen} showLauncher={spectator}
      onOpenChange={setChatOpen} allowGameCalls={spectator && !guestKey}
      challengeTargets={spectator && !guestKey ? players.filter((player) => player.user_id !== JOURNEY_MACHINE_ID).map((player) => ({ userId: player.user_id, name: player.display_name, avatarUrl: player.avatar_url || null })) : []} />
  </div>;
}
