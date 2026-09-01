import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch } from 'react';
import {
  ArrowLeft,
  BookOpen,
  CheckCircle2,
  Coins,
  Flag,
  Leaf,
  Loader2,
  Map,
  Pause,
  RefreshCcw,
  RotateCcw,
  Sparkles,
  XCircle,
} from 'lucide-react';
import { storyActionAt, storyActionDuration } from './actions';
import {
  activateStoryQuestion,
  pauseStoryAttempt,
  reachStoryCanonicalEvent,
  resumeStoryAttempt,
  saveStoryCheckpoint,
  settleStoryCanonicalEvent,
  submitStoryAnswer,
} from './api';
import { playStorySound, startStoryAmbience, stopStoryAmbience } from './audio';
import { findStoryLocation } from './content';
import type { StoryMachineEvent, StoryMachineState, StoryPhase } from './engine';
import { StoryQuestionOverlay } from './StoryQuestionOverlay';
import { STORY_CHARACTER_LABELS } from './characters';
import { StoryWorld } from './StoryWorld';
import type {
  StoryActionName,
  StoryAttempt,
  StoryBuildState,
  StoryDeadline,
  StoryLevelDefinition,
  StoryQuestionPayload,
  StorySceneDefinition,
} from './types';

export interface StoryLevelPlayerProps {
  level: StoryLevelDefinition;
  attempt: StoryAttempt;
  machine: StoryMachineState;
  dispatch: Dispatch<StoryMachineEvent>;
  onExit: () => void;
  onReplay: () => Promise<void>;
  onBrowse: () => Promise<void>;
  onProgressChanged: () => Promise<void>;
}

type PendingSubmission = { answer: string | null; timedOut: boolean; id: string };

const ACTIVE_PHASES = new Set<StoryPhase>([
  'intro', 'reading', 'walking', 'running', 'question_approach', 'question_active', 'checkpoint',
]);

function sceneOfKind(level: StoryLevelDefinition, kind: StorySceneDefinition['kind']) {
  return level.scenes.find((scene) => scene.kind === kind) || null;
}

function questionScene(level: StoryLevelDefinition, question: StoryQuestionPayload | null) {
  if (!question) return null;
  return level.scenes.find((scene) => scene.id === question.sceneId)
    || level.scenes.find((scene) => scene.kind === 'question_event' && scene.questionPoolId === question.poolId)
    || null;
}

function localDeadline(deadline: StoryDeadline) {
  if (!deadline.deadline) return null;
  return Date.now() + Math.max(0, Date.parse(deadline.deadline) - Date.parse(deadline.serverNow));
}

function submissionId() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (character) => {
    const random = Math.floor(Math.random() * 16);
    return (character === 'x' ? random : (random & 0x3) | 0x8).toString(16);
  });
}

function activeCharacterName(scene: StorySceneDefinition) {
  if (!scene.activeCharacterId) return 'The story';
  return STORY_CHARACTER_LABELS[scene.activeCharacterId];
}

export function StoryLevelPlayer({
  level,
  attempt,
  machine,
  dispatch,
  onExit,
  onReplay,
  onBrowse,
  onProgressChanged,
}: StoryLevelPlayerProps) {
  const introScene = useMemo(() => level.scenes.find((scene) => scene.id === level.openingSceneId) || sceneOfKind(level, 'narrative'), [level]);
  const readScene = useMemo(() => sceneOfKind(level, 'read'), [level]);
  const movementScene = useMemo(() => sceneOfKind(level, 'movement'), [level]);
  const canonicalScene = useMemo(
    () => sceneOfKind(level, 'canonical_event') || sceneOfKind(level, 'character_transition'),
    [level],
  );
  const completionScene = useMemo(() => sceneOfKind(level, 'completion'), [level]);
  if (!introScene || !movementScene || !completionScene) throw new Error(`Story level ${level.slug} is missing a required scene.`);

  const [activeQuestion, setActiveQuestion] = useState<StoryQuestionPayload | null>(attempt.question);
  const [pendingEventId, setPendingEventId] = useState<string | null>(attempt.pendingEventId);
  const [buildState, setBuildState] = useState<StoryBuildState | null>(attempt.buildState);
  const activeQuestionScene = useMemo(() => questionScene(level, activeQuestion), [activeQuestion, level]);
  if (activeQuestion && !activeQuestionScene) throw new Error(`Story question ${activeQuestion.id} has no scene in ${level.slug}.`);

  const visiblePhase = machine.phase === 'paused' ? machine.resumePhase : machine.phase;
  const activeScene = visiblePhase === 'intro' || visiblePhase === 'reading'
    ? (visiblePhase === 'reading' && readScene ? readScene : introScene)
    : visiblePhase === 'walking' || visiblePhase === 'running' || visiblePhase === 'cinematic'
      ? movementScene
      : visiblePhase === 'canonical_transition' || visiblePhase === 'character_transition'
        ? (canonicalScene || movementScene)
        : visiblePhase === 'level_complete' || visiblePhase === 'chapter_complete' || visiblePhase === 'book_complete'
          ? completionScene
          : (activeQuestionScene || movementScene);
  const location = findStoryLocation(level.slug);
  const correctSequence = useMemo<StoryActionName[]>(
    () => activeQuestionScene?.correctActions?.length ? activeQuestionScene.correctActions : ['walk'],
    [activeQuestionScene],
  );
  const wrongSequence = useMemo<StoryActionName[]>(
    () => activeQuestionScene?.wrongActions?.length ? activeQuestionScene.wrongActions : ['trip', 'fall'],
    [activeQuestionScene],
  );

  const [action, setAction] = useState<StoryActionName>(machine.action);
  const [remainingMs, setRemainingMs] = useState((activeQuestion?.timerSeconds || 5) * 1_000);
  const [selectedAnswer, setSelectedAnswer] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [failedSubmission, setFailedSubmission] = useState<PendingSubmission | null>(null);
  const [readSeen, setReadSeen] = useState(false);
  const [canonicalRetry, setCanonicalRetry] = useState(0);
  const deadlineRef = useRef<number | null>(null);
  const submittingRef = useRef(false);
  const pendingSubmissionRef = useRef<PendingSubmission | null>(null);
  const pendingNextQuestionRef = useRef<StoryQuestionPayload | null>(null);
  const canonicalSubmissionRef = useRef<string | null>(null);
  const canonicalSettlingRef = useRef(false);
  const mountedRef = useRef(true);

  const applyDeadline = useCallback((deadline: StoryDeadline) => {
    const nextDeadline = localDeadline(deadline);
    deadlineRef.current = nextDeadline;
    setRemainingMs(nextDeadline === null
      ? (activeQuestion?.timerSeconds || 5) * 1_000
      : Math.max(0, nextDeadline - Date.now()));
    return nextDeadline;
  }, [activeQuestion?.timerSeconds]);

  useEffect(() => {
    mountedRef.current = true;
    void startStoryAmbience();
    return () => {
      mountedRef.current = false;
      void stopStoryAmbience();
    };
  }, []);

  useEffect(() => { setAction(machine.action); }, [machine.action]);

  useEffect(() => {
    setActiveQuestion(attempt.question);
    setPendingEventId(attempt.pendingEventId);
    setBuildState(attempt.buildState);
    setReadSeen(attempt.checkpointId !== introScene.checkpointId);
    submittingRef.current = false;
    pendingSubmissionRef.current = null;
    pendingNextQuestionRef.current = null;
    canonicalSubmissionRef.current = null;
    canonicalSettlingRef.current = false;
    const restoredDeadline = attempt.questionDeadline
      ? localDeadline({ deadline: attempt.questionDeadline, serverNow: attempt.serverNow, paused: attempt.paused })
      : null;
    deadlineRef.current = restoredDeadline;
    setSelectedAnswer(null);
    setRemainingMs(restoredDeadline === null
      ? (attempt.question?.timerSeconds || 5) * 1_000
      : Math.max(0, restoredDeadline - Date.now()));
    setBusy(false);
    setError(null);
    setFailedSubmission(null);
  }, [attempt, introScene.checkpointId]);

  useEffect(() => {
    if (machine.phase === 'intro') {
      const timeout = window.setTimeout(() => {
        if (readScene && !readSeen) dispatch({ type: 'OPEN_READ', returnPhase: 'intro' });
        else dispatch({ type: 'INTRO_COMPLETE' });
      }, introScene.durationMs ?? 1_650);
      return () => window.clearTimeout(timeout);
    }
    if (machine.phase === 'walking') {
      setAction(movementScene.locomotion || movementScene.action);
      void playStorySound('footsteps', 0.3);
      const timeout = window.setTimeout(() => {
        if (!activeQuestion) {
          if (pendingEventId && canonicalScene?.checkpointId) {
            setBusy(true);
            setError(null);
            reachStoryCanonicalEvent(attempt.attemptId, pendingEventId)
              .then(({ checkpointId }) => dispatch({ type: 'CANONICAL_EVENT_REACHED', checkpointId }))
              .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : 'The canonical checkpoint could not be reached.'))
              .finally(() => setBusy(false));
          } else {
            setError('This Story Mode scene has no server-authorized next event.');
          }
          return;
        }
        setBusy(true);
        setError(null);
        saveStoryCheckpoint(attempt.attemptId, activeQuestion.checkpointId)
          .then(() => dispatch({ type: 'EVENT_REACHED', checkpointId: activeQuestion.checkpointId }))
          .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : 'The checkpoint could not be saved.'))
          .finally(() => setBusy(false));
      }, movementScene.durationMs ?? 3_200);
      return () => window.clearTimeout(timeout);
    }
    if (machine.phase === 'checkpoint') {
      const timeout = window.setTimeout(() => dispatch({ type: 'CHECKPOINT_READY' }), 620);
      return () => window.clearTimeout(timeout);
    }
    if (machine.phase === 'question_approach' && activeQuestion && activeQuestionScene) {
      const timeout = window.setTimeout(() => {
        setBusy(true);
        setError(null);
        activateStoryQuestion(attempt.attemptId, activeQuestion.id)
          .then((deadline) => {
            applyDeadline(deadline);
            dispatch({ type: 'QUESTION_READY' });
            void playStorySound('transition', 0.4);
          })
          .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : 'The question could not begin.'))
          .finally(() => setBusy(false));
      }, activeQuestionScene.durationMs ?? 680);
      return () => window.clearTimeout(timeout);
    }
    return undefined;
  }, [
    activeQuestion,
    activeQuestionScene,
    applyDeadline,
    attempt.attemptId,
    canonicalScene?.checkpointId,
    dispatch,
    introScene.durationMs,
    machine.phase,
    movementScene.action,
    movementScene.durationMs,
    movementScene.locomotion,
    pendingEventId,
    readScene,
    readSeen,
  ]);

  const submit = useCallback(async (answer: string | null, timedOut: boolean) => {
    if (!activeQuestion || submittingRef.current || machine.phase !== 'question_active') return;
    submittingRef.current = true;
    const pending = pendingSubmissionRef.current || { answer, timedOut, id: submissionId() };
    pendingSubmissionRef.current = pending;
    setBusy(true);
    setSelectedAnswer(pending.answer);
    setError(null);
    setFailedSubmission(null);
    try {
      const result = await submitStoryAnswer({
        attemptId: attempt.attemptId,
        questionId: activeQuestion.id,
        selectedAnswer: pending.answer,
        timedOut: pending.timedOut,
        submissionId: pending.id,
      });
      if (!mountedRef.current) return;
      deadlineRef.current = null;
      pendingSubmissionRef.current = null;
      pendingNextQuestionRef.current = result.nextQuestion;
      if (result.canonicalEventId) setPendingEventId(result.canonicalEventId);
      if (result.buildState) setBuildState(result.buildState);
      setRemainingMs(0);
      dispatch({ type: result.correct ? 'ANSWER_CORRECT' : 'ANSWER_WRONG', result });
      void playStorySound(result.correct ? 'correct' : 'failure', 0.52);
      if (result.levelComplete) void onProgressChanged().catch(() => undefined);
    } catch (reason) {
      if (!mountedRef.current) return;
      setError(reason instanceof Error ? reason.message : 'The answer could not be checked.');
      deadlineRef.current = null;
      setFailedSubmission(pending);
      submittingRef.current = false;
    } finally {
      if (mountedRef.current) setBusy(false);
    }
  }, [activeQuestion, attempt.attemptId, dispatch, machine.phase, onProgressChanged]);

  useEffect(() => {
    if (machine.phase !== 'question_active') return undefined;
    const tick = () => {
      const deadline = deadlineRef.current;
      if (deadline === null) return;
      const next = Math.max(0, deadline - Date.now());
      setRemainingMs(next);
      if (next === 0 && !submittingRef.current) void submit(null, true);
    };
    tick();
    const interval = window.setInterval(tick, 100);
    return () => window.clearInterval(interval);
  }, [machine.phase, submit]);

  useEffect(() => {
    if (machine.phase !== 'correct_action' && machine.phase !== 'wrong_action') return undefined;
    const sequence = machine.phase === 'correct_action' ? correctSequence : wrongSequence;
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const duration = reducedMotion ? 420 : storyActionDuration(sequence);
    const startedAt = performance.now();
    let frame = 0;
    const animate = (now: number) => {
      const elapsed = now - startedAt;
      setAction(reducedMotion ? sequence[sequence.length - 1] : storyActionAt(sequence, elapsed).name);
      if (elapsed < duration) frame = window.requestAnimationFrame(animate);
      else {
        if (machine.phase === 'correct_action' && pendingNextQuestionRef.current) {
          setActiveQuestion(pendingNextQuestionRef.current);
          pendingNextQuestionRef.current = null;
          submittingRef.current = false;
          setSelectedAnswer(null);
        }
        dispatch({ type: 'ACTION_COMPLETE' });
        if (machine.phase === 'correct_action') void playStorySound('complete', 0.5);
      }
    };
    frame = window.requestAnimationFrame(animate);
    return () => window.cancelAnimationFrame(frame);
  }, [correctSequence, dispatch, machine.phase, wrongSequence]);

  useEffect(() => {
    if (machine.phase !== 'canonical_transition' || !pendingEventId || !canonicalScene) return undefined;
    if (canonicalSettlingRef.current) return undefined;
    canonicalSettlingRef.current = true;
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const wait = reducedMotion ? 700 : (canonicalScene.durationMs ?? 2_700);
    const sequence = canonicalScene.canonicalActions?.length ? canonicalScene.canonicalActions : [canonicalScene.action];
    if (canonicalScene.kind === 'canonical_event') void playStorySound('impact', 0.42);
    let cancelled = false;
    let timeout = 0;
    let frame = 0;
    const settle = () => {
      const id = canonicalSubmissionRef.current || submissionId();
      canonicalSubmissionRef.current = id;
      setBusy(true);
      setError(null);
      settleStoryCanonicalEvent({ attemptId: attempt.attemptId, eventId: pendingEventId, submissionId: id })
        .then((result) => {
          if (!mountedRef.current) return;
          dispatch({ type: 'CANONICAL_EVENT_SETTLED', result });
          if (result.buildState) setBuildState(result.buildState);
          setPendingEventId(null);
          void onProgressChanged().catch(() => undefined);
          void playStorySound('transition', 0.48);
        })
        .catch((reason: unknown) => {
          canonicalSettlingRef.current = false;
          setError(reason instanceof Error ? reason.message : 'The canonical transition could not be settled.');
        })
        .finally(() => { if (mountedRef.current) setBusy(false); });
    };
    setBusy(true);
    setError(null);
    reachStoryCanonicalEvent(attempt.attemptId, pendingEventId)
      .then(() => {
        if (cancelled) return;
        setBusy(false);
        if (reducedMotion) {
          setAction(sequence[sequence.length - 1]);
        } else {
          const startedAt = performance.now();
          const animate = (now: number) => {
            const elapsed = now - startedAt;
            const segment = Math.min(sequence.length - 1, Math.floor((elapsed / wait) * sequence.length));
            setAction(sequence[segment]);
            if (elapsed < wait) frame = window.requestAnimationFrame(animate);
          };
          frame = window.requestAnimationFrame(animate);
        }
        timeout = window.setTimeout(settle, wait);
      })
      .catch((reason: unknown) => {
        canonicalSettlingRef.current = false;
        if (mountedRef.current) {
          setBusy(false);
          setError(reason instanceof Error ? reason.message : 'The canonical transition could not be reached.');
        }
      });
    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
      window.cancelAnimationFrame(frame);
    };
  }, [attempt.attemptId, canonicalRetry, canonicalScene, dispatch, machine.phase, onProgressChanged, pendingEventId]);

  const pause = useCallback(async () => {
    if (!ACTIVE_PHASES.has(machine.phase) || busy) return;
    setBusy(true);
    setError(null);
    try {
      const deadline = await pauseStoryAttempt(attempt.attemptId);
      applyDeadline(deadline);
      dispatch({ type: 'PAUSE' });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Story Mode could not be paused.');
    } finally {
      setBusy(false);
    }
  }, [applyDeadline, attempt.attemptId, busy, dispatch, machine.phase]);

  const resume = useCallback(async () => {
    if (machine.phase !== 'paused' || busy) return;
    setBusy(true);
    setError(null);
    try {
      applyDeadline(await resumeStoryAttempt(attempt.attemptId));
      dispatch({ type: 'RESUME' });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Story Mode could not resume.');
    } finally {
      setBusy(false);
    }
  }, [applyDeadline, attempt.attemptId, busy, dispatch, machine.phase]);

  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === 'hidden' && ACTIVE_PHASES.has(machine.phase) && !busy) void pause();
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, [busy, machine.phase, pause]);

  const exitLevel = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      if (!['level_complete', 'chapter_complete'].includes(machine.phase)) await pauseStoryAttempt(attempt.attemptId);
      onExit();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The journey could not be safely paused.');
    } finally {
      if (mountedRef.current) setBusy(false);
    }
  }, [attempt.attemptId, machine.phase, onExit]);

  const browseLevel = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      if (!['level_complete', 'chapter_complete'].includes(machine.phase)) await pauseStoryAttempt(attempt.attemptId);
      await onBrowse();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The journey browser could not open safely.');
    } finally {
      if (mountedRef.current) setBusy(false);
    }
  }, [attempt.attemptId, machine.phase, onBrowse]);

  const retry = () => {
    submittingRef.current = false;
    pendingSubmissionRef.current = null;
    setSelectedAnswer(null);
    setRemainingMs((activeQuestion?.timerSeconds || 5) * 1_000);
    setError(null);
    setFailedSubmission(null);
    setAction('idle');
    dispatch({ type: 'RETRY' });
  };

  const result = machine.result;
  const pauseDisabled = busy || ['correct_action', 'wrong_action', 'canonical_transition', 'level_complete', 'chapter_complete', 'failure'].includes(machine.phase);
  const locationLabel = location
    ? `${location.book.numeral} · Chapter ${location.chapter.order} · Level ${level.order}`
    : `Level ${level.order}`;

  return (
    <div className="mx-auto max-w-6xl space-y-3 animate-fade-in">
      <div className="flex items-center justify-between gap-3">
        <button type="button" onClick={() => void exitLevel()} className="btn-ghost text-sm"><ArrowLeft size={15} /> Story Mode</button>
        <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-stone"><Flag size={13} /> {locationLabel}</span>
      </div>

      <StoryWorld
        machine={machine}
        scene={activeScene}
        action={action}
        scriptureLabel={level.scriptureLabel || activeScene.scriptureReference || 'Scripture'}
        paused={machine.phase === 'paused'}
        busy={pauseDisabled}
        buildState={buildState}
        onPause={() => void pause()}
        onResume={() => void resume()}
      >
        {machine.phase === 'intro' && (
          <div className="story-narrative-card story-narrative-bottom">
            <span className="story-narrative-icon"><BookOpen size={16} /></span>
            <div><p>{introScene.narrativeText}</p><small>{introScene.scriptureReference}</small></div>
          </div>
        )}

        {machine.phase === 'reading' && readScene && (
          <div className="story-read-panel" role="dialog" aria-modal="true" aria-labelledby="story-read-title">
            <p className="eyebrow text-gold">Read</p>
            <h3 id="story-read-title">{readScene.scriptureReference}</h3>
            <p>{readScene.readText}</p>
            <p className="story-read-timer-note">The question timer is stopped while Scripture is open.</p>
            <button type="button" className="btn-primary mt-4" onClick={() => { setReadSeen(true); dispatch({ type: 'READ_COMPLETE' }); }}>
              <BookOpen size={15} /> Continue from Scripture
            </button>
          </div>
        )}

        {machine.phase === 'walking' && (
          <div className="story-guide-label"><Leaf size={14} /> {movementScene.narrativeText}</div>
        )}

        {(machine.phase === 'question_approach' || machine.phase === 'checkpoint') && activeQuestionScene && (
          <div className="story-event-prompt"><Sparkles size={17} /> {activeQuestionScene.narrativeText}</div>
        )}

        {machine.phase === 'question_active' && activeQuestion && (
          <StoryQuestionOverlay
            question={activeQuestion}
            remainingMs={remainingMs}
            selectedAnswer={selectedAnswer}
            submitting={busy || Boolean(failedSubmission)}
            onAnswer={(answer) => void submit(answer, false)}
          />
        )}

        {machine.phase === 'correct_action' && activeQuestionScene && (
          <div className="story-action-caption story-action-caption-correct"><CheckCircle2 size={17} /> {activeQuestionScene.correctNarrativeText}</div>
        )}

        {machine.phase === 'wrong_action' && activeQuestionScene && (
          <div className="story-action-caption story-action-caption-wrong"><XCircle size={17} /> {activeQuestionScene.wrongNarrativeText}</div>
        )}

        {machine.phase === 'canonical_transition' && canonicalScene && (
          <div className="story-canonical-caption" role="status" aria-live="polite">
            <p className="eyebrow text-gold">{canonicalScene.kind === 'canonical_event' ? 'Canonical event' : 'Generational transition'}</p>
            <strong>{canonicalScene.narrativeText}</strong>
            <small>{canonicalScene.scriptureReference}</small>
          </div>
        )}

        {machine.phase === 'failure' && result && (
          <div className="story-result-panel" role="dialog" aria-modal="true" aria-labelledby="story-failure-title">
            <span className="story-result-symbol story-result-failure"><XCircle size={25} /></span>
            <p className="eyebrow text-coral">{result.timedOut ? 'Time expired' : 'Action interrupted'}</p>
            <h3 id="story-failure-title">Return to the checkpoint</h3>
            <p>{result.explanation}</p>
            <div className="mt-4 flex flex-wrap justify-center gap-2">
              <button type="button" onClick={retry} className="btn-primary"><RefreshCcw size={15} /> Retry checkpoint</button>
              <button type="button" onClick={() => void browseLevel()} className="btn-secondary"><Map size={15} /> Browse journey</button>
            </div>
          </div>
        )}

        {machine.phase === 'paused' && (
          <div className="story-result-panel" role="dialog" aria-modal="true" aria-labelledby="story-paused-title">
            <span className="story-result-symbol"><Pause size={24} fill="currentColor" /></span>
            <p className="eyebrow text-peri">Journey paused</p>
            <h3 id="story-paused-title">{activeCharacterName(activeScene)} waits</h3>
            <p>Your checkpoint and question time are preserved.</p>
            <button type="button" onClick={() => void resume()} disabled={busy} className="btn-primary mt-4">
              {busy ? <Loader2 size={15} className="animate-spin" /> : <RefreshCcw size={15} />} Resume
            </button>
          </div>
        )}

        {machine.phase === 'level_complete' && result && (
          <div className="story-result-panel story-complete-panel" role="dialog" aria-modal="true" aria-labelledby="story-complete-title">
            <span className="story-result-symbol story-result-complete"><Sparkles size={25} /></span>
            <p className="eyebrow text-gold">Level complete</p>
            <h3 id="story-complete-title">{level.title}</h3>
            <p>{completionScene.narrativeText} {level.continuationText}</p>
            <div className="story-completion-stats">
              <span><Leaf size={15} /><strong>{result.totalFigs}</strong><small>Figs earned</small></span>
              <span><Coins size={15} /><strong>{result.denariiEarned}</strong><small>Denarii</small></span>
              <span><CheckCircle2 size={15} /><strong>{result.correctCount}/{result.questionCount}</strong><small>Correct</small></span>
              <span><Flag size={15} /><strong>{result.completionPercentage}%</strong><small>Complete</small></span>
            </div>
            {result.replay && <p className="story-replay-note">Practice replay complete. Rewards remain settled once.</p>}
            <div className="mt-4 flex flex-wrap justify-center gap-2">
              <button type="button" onClick={() => void onReplay()} disabled={busy} className="btn-primary"><RotateCcw size={15} /> Replay level</button>
              <button type="button" onClick={() => void browseLevel()} className="btn-secondary"><Map size={15} /> Browse journey</button>
            </div>
          </div>
        )}

        {machine.phase === 'chapter_complete' && result && (
          <div className="story-result-panel story-complete-panel" role="dialog" aria-modal="true" aria-labelledby="story-chapter-title">
            <span className="story-result-symbol story-result-complete"><Sparkles size={25} /></span>
            <p className="eyebrow text-gold">Chapter complete</p>
            <h3 id="story-chapter-title">{location?.chapter.title || 'Chapter'}</h3>
            <p>{level.chapterCompletionText || level.continuationText} {level.nextCharacterName ? `Next: ${level.nextCharacterName}.` : ''}</p>
            <div className="story-completion-stats">
              <span><Leaf size={15} /><strong>{result.totalFigs}</strong><small>Chapter Figs</small></span>
              <span><Coins size={15} /><strong>0</strong><small>Denarii</small></span>
              <span><CheckCircle2 size={15} /><strong>{result.correctCount}/{result.questionCount}</strong><small>Correct</small></span>
              <span><Flag size={15} /><strong>{result.levelsCompleted}/{location?.chapter.levels.length || 1}</strong><small>Levels</small></span>
            </div>
            <div className="mt-4 flex flex-wrap justify-center gap-2">
              <button type="button" onClick={() => void onReplay()} disabled={busy} className="btn-primary"><RotateCcw size={15} /> Replay epilogue</button>
              <button type="button" onClick={() => void browseLevel()} className="btn-secondary"><Map size={15} /> Browse journey</button>
            </div>
          </div>
        )}

        {busy && machine.phase !== 'question_active' && machine.phase !== 'paused' && (
          <div className="story-busy-indicator"><Loader2 size={15} className="animate-spin" /> Saving journey</div>
        )}
      </StoryWorld>

      {error && (
        <div className="flex items-start justify-between gap-3 rounded-lg border border-coral/35 bg-coral-soft px-4 py-3 text-sm text-coral" role="alert">
          <span>{error}</span>
          {(machine.phase === 'walking' || machine.phase === 'question_approach') && (
            <button type="button" onClick={() => { setError(null); dispatch({ type: 'RESTART_FROM_CHECKPOINT' }); }} className="font-bold underline">Retry</button>
          )}
          {machine.phase === 'question_active' && failedSubmission && (
            <button type="button" onClick={() => void submit(failedSubmission.answer, failedSubmission.timedOut)} className="font-bold underline">Retry answer</button>
          )}
          {machine.phase === 'canonical_transition' && (
            <button type="button" onClick={() => { setError(null); canonicalSettlingRef.current = false; setCanonicalRetry((value) => value + 1); }} className="font-bold underline">Retry transition</button>
          )}
        </div>
      )}
    </div>
  );
}
