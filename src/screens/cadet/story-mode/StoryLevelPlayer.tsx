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
  resumeStoryAttempt,
  saveStoryCheckpoint,
  submitStoryAnswer,
} from './api';
import { playStorySound, startStoryAmbience, stopStoryAmbience } from './audio';
import { findStoryLocation } from './content';
import type { StoryMachineEvent, StoryMachineState, StoryPhase } from './engine';
import { StoryQuestionOverlay } from './StoryQuestionOverlay';
import { StoryWorld } from './StoryWorld';
import type {
  StoryActionName,
  StoryAttempt,
  StoryDeadline,
  StoryLevelDefinition,
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

type PendingSubmission = {
  answer: string | null;
  timedOut: boolean;
  id: string;
};

type RequiredScenes = {
  intro: StorySceneDefinition;
  movement: StorySceneDefinition;
  question: StorySceneDefinition;
  completion: StorySceneDefinition;
};

const ACTIVE_PHASES = new Set<StoryPhase>([
  'intro',
  'walking',
  'running',
  'question_approach',
  'question_active',
  'checkpoint',
]);

function requiredScenes(level: StoryLevelDefinition, questionId: string): RequiredScenes {
  const intro = level.scenes.find((scene) => scene.id === level.openingSceneId)
    || level.scenes.find((scene) => scene.kind === 'narrative');
  const movement = level.scenes.find((scene) => scene.kind === 'movement');
  const question = level.scenes.find((scene) => scene.kind === 'question_event' && scene.questionId === questionId);
  const completion = level.scenes.find((scene) => scene.kind === 'completion');
  if (!intro || !movement || !question || !completion || !question.checkpointId) {
    throw new Error(`Story level ${level.slug} is missing a required scene or checkpoint.`);
  }
  return { intro, movement, question, completion };
}

function localDeadline(deadline: StoryDeadline) {
  if (!deadline.deadline) return null;
  const remaining = Math.max(0, Date.parse(deadline.deadline) - Date.parse(deadline.serverNow));
  return Date.now() + remaining;
}

function submissionId() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (character) => {
    const random = Math.floor(Math.random() * 16);
    return (character === 'x' ? random : (random & 0x3) | 0x8).toString(16);
  });
}

function characterName(scene: StorySceneDefinition) {
  return scene.character === 'abel' ? 'Abel' : scene.character;
}

function currentScene(machine: StoryMachineState, scenes: RequiredScenes) {
  const phase = machine.phase === 'paused' ? machine.resumePhase : machine.phase;
  if (phase === 'intro' || phase === 'reading') return scenes.intro;
  if (phase === 'walking' || phase === 'running') return scenes.movement;
  if (phase === 'level_complete' || phase === 'chapter_complete' || phase === 'book_complete') return scenes.completion;
  return scenes.question;
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
  const scenes = useMemo(
    () => requiredScenes(level, attempt.question.id),
    [attempt.question.id, level],
  );
  const location = findStoryLocation(level.slug);
  const questionCheckpoint = scenes.question.checkpointId as string;
  const correctSequence = useMemo<StoryActionName[]>(
    () => scenes.question.correctActions?.length ? scenes.question.correctActions : ['offer'],
    [scenes.question.correctActions],
  );
  const wrongSequence = useMemo<StoryActionName[]>(
    () => scenes.question.wrongActions?.length ? scenes.question.wrongActions : ['trip', 'fall', 'fade'],
    [scenes.question.wrongActions],
  );
  const activeScene = currentScene(machine, scenes);
  const activeCharacter = characterName(activeScene);

  const [action, setAction] = useState<StoryActionName>(machine.action);
  const [remainingMs, setRemainingMs] = useState(attempt.question.timerSeconds * 1_000);
  const [selectedAnswer, setSelectedAnswer] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [failedSubmission, setFailedSubmission] = useState<PendingSubmission | null>(null);
  const deadlineRef = useRef<number | null>(null);
  const submittingRef = useRef(false);
  const pendingSubmissionRef = useRef<PendingSubmission | null>(null);
  const mountedRef = useRef(true);

  const applyDeadline = useCallback((deadline: StoryDeadline) => {
    const nextDeadline = localDeadline(deadline);
    deadlineRef.current = nextDeadline;
    setRemainingMs(nextDeadline === null
      ? attempt.question.timerSeconds * 1_000
      : Math.max(0, nextDeadline - Date.now()));
    return nextDeadline;
  }, [attempt.question.timerSeconds]);

  useEffect(() => {
    mountedRef.current = true;
    void startStoryAmbience();
    if (attempt.questionDeadline) {
      applyDeadline({
        deadline: attempt.questionDeadline,
        serverNow: attempt.serverNow,
        paused: attempt.paused,
      });
    }
    return () => {
      mountedRef.current = false;
      void stopStoryAmbience();
    };
  }, [applyDeadline, attempt.paused, attempt.questionDeadline, attempt.serverNow]);

  useEffect(() => {
    setAction(machine.action);
  }, [machine.action]);

  useEffect(() => {
    submittingRef.current = false;
    pendingSubmissionRef.current = null;
    const restoredDeadline = attempt.questionDeadline
      ? localDeadline({ deadline: attempt.questionDeadline, serverNow: attempt.serverNow, paused: attempt.paused })
      : null;
    deadlineRef.current = restoredDeadline;
    setSelectedAnswer(null);
    setRemainingMs(restoredDeadline === null
      ? attempt.question.timerSeconds * 1_000
      : Math.max(0, restoredDeadline - Date.now()));
    setBusy(false);
    setError(null);
    setFailedSubmission(null);
  }, [attempt.attemptId, attempt.paused, attempt.question.timerSeconds, attempt.questionDeadline, attempt.serverNow]);

  useEffect(() => {
    if (machine.phase === 'intro') {
      const timeout = window.setTimeout(
        () => dispatch({ type: 'INTRO_COMPLETE' }),
        scenes.intro.durationMs ?? 1_650,
      );
      return () => window.clearTimeout(timeout);
    }
    if (machine.phase === 'walking') {
      void playStorySound('footsteps', 0.34);
      const timeout = window.setTimeout(() => {
        setBusy(true);
        setError(null);
        saveStoryCheckpoint(attempt.attemptId, questionCheckpoint)
          .then(() => dispatch({ type: 'EVENT_REACHED', checkpointId: questionCheckpoint }))
          .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : 'The checkpoint could not be saved.'))
          .finally(() => setBusy(false));
      }, scenes.movement.durationMs ?? 4_150);
      return () => window.clearTimeout(timeout);
    }
    if (machine.phase === 'checkpoint') {
      const timeout = window.setTimeout(() => dispatch({ type: 'CHECKPOINT_READY' }), 650);
      return () => window.clearTimeout(timeout);
    }
    if (machine.phase === 'question_approach') {
      const timeout = window.setTimeout(() => {
        setBusy(true);
        setError(null);
        activateStoryQuestion(attempt.attemptId, attempt.question.id)
          .then((deadline) => {
            applyDeadline(deadline);
            dispatch({ type: 'QUESTION_READY' });
            void playStorySound('transition', 0.42);
          })
          .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : 'The question could not begin.'))
          .finally(() => setBusy(false));
      }, scenes.question.durationMs ?? 720);
      return () => window.clearTimeout(timeout);
    }
    return undefined;
  }, [
    applyDeadline,
    attempt.attemptId,
    attempt.question.id,
    dispatch,
    machine.phase,
    questionCheckpoint,
    scenes.intro.durationMs,
    scenes.movement.durationMs,
    scenes.question.durationMs,
  ]);

  const submit = useCallback(async (answer: string | null, timedOut: boolean) => {
    if (submittingRef.current || machine.phase !== 'question_active') return;
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
        questionId: attempt.question.id,
        selectedAnswer: pending.answer,
        timedOut: pending.timedOut,
        submissionId: pending.id,
      });
      if (!mountedRef.current) return;
      deadlineRef.current = null;
      pendingSubmissionRef.current = null;
      setRemainingMs(0);
      dispatch({ type: result.correct ? 'ANSWER_CORRECT' : 'ANSWER_WRONG', result });
      void playStorySound(result.correct ? 'correct' : 'failure', 0.56);
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
  }, [attempt.attemptId, attempt.question.id, dispatch, machine.phase, onProgressChanged]);

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
    const duration = reducedMotion ? 520 : storyActionDuration(sequence);
    const startedAt = performance.now();
    let frame = 0;
    const animate = (now: number) => {
      const elapsed = now - startedAt;
      setAction(reducedMotion ? sequence[sequence.length - 1] : storyActionAt(sequence, elapsed).name);
      if (elapsed < duration) frame = window.requestAnimationFrame(animate);
      else {
        dispatch({ type: 'ACTION_COMPLETE' });
        if (machine.phase === 'correct_action') void playStorySound('complete', 0.58);
      }
    };
    frame = window.requestAnimationFrame(animate);
    return () => window.cancelAnimationFrame(frame);
  }, [correctSequence, dispatch, machine.phase, wrongSequence]);

  const pause = useCallback(async () => {
    if (!ACTIVE_PHASES.has(machine.phase) || busy) return;
    setBusy(true);
    setError(null);
    try {
      const deadline = await pauseStoryAttempt(attempt.attemptId);
      const nextDeadline = applyDeadline(deadline);
      if (nextDeadline !== null) setRemainingMs(Math.max(0, nextDeadline - Date.now()));
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
      const deadline = await resumeStoryAttempt(attempt.attemptId);
      applyDeadline(deadline);
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
      if (machine.phase !== 'level_complete') await pauseStoryAttempt(attempt.attemptId);
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
      if (machine.phase !== 'level_complete') await pauseStoryAttempt(attempt.attemptId);
      await onBrowse();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The journey browser could not open safely.');
    } finally {
      if (mountedRef.current) setBusy(false);
    }
  }, [attempt.attemptId, machine.phase, onBrowse]);

  const replayLevel = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      await onReplay();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The replay could not begin.');
    } finally {
      if (mountedRef.current) setBusy(false);
    }
  }, [onReplay]);

  const retry = () => {
    submittingRef.current = false;
    pendingSubmissionRef.current = null;
    setSelectedAnswer(null);
    setRemainingMs(attempt.question.timerSeconds * 1_000);
    setError(null);
    setFailedSubmission(null);
    setAction('idle');
    dispatch({ type: 'RETRY' });
  };

  const result = machine.result;
  const pauseDisabled = busy
    || machine.phase === 'correct_action'
    || machine.phase === 'wrong_action'
    || machine.phase === 'level_complete'
    || machine.phase === 'failure';
  const locationLabel = location
    ? `${location.book.numeral} · Chapter ${location.chapter.order} · Level ${level.order}`
    : `Level ${level.order}`;

  return (
    <div className="mx-auto max-w-6xl space-y-3 animate-fade-in">
      <div className="flex items-center justify-between gap-3">
        <button type="button" onClick={() => void exitLevel()} className="btn-ghost text-sm">
          <ArrowLeft size={15} /> Story Mode
        </button>
        <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-stone">
          <Flag size={13} /> {locationLabel}
        </span>
      </div>

      <StoryWorld
        machine={machine}
        scene={activeScene}
        action={action}
        paused={machine.phase === 'paused'}
        busy={pauseDisabled}
        onPause={() => void pause()}
        onResume={() => void resume()}
      >
        {machine.phase === 'intro' && (
          <div className="story-narrative-card story-narrative-bottom">
            <span className="story-narrative-icon"><BookOpen size={16} /></span>
            <div><p>{scenes.intro.narrativeText}</p><small>{scenes.intro.scriptureReference}</small></div>
          </div>
        )}

        {machine.phase === 'walking' && (
          <div className="story-guide-label"><Leaf size={14} /> {scenes.movement.narrativeText}</div>
        )}

        {(machine.phase === 'question_approach' || machine.phase === 'checkpoint') && (
          <div className="story-event-prompt"><Sparkles size={17} /> {scenes.question.narrativeText}</div>
        )}

        {machine.phase === 'question_active' && (
          <StoryQuestionOverlay
            question={attempt.question}
            remainingMs={remainingMs}
            selectedAnswer={selectedAnswer}
            submitting={busy || Boolean(failedSubmission)}
            onAnswer={(answer) => void submit(answer, false)}
          />
        )}

        {machine.phase === 'correct_action' && (
          <div className="story-action-caption story-action-caption-correct"><CheckCircle2 size={17} /> {scenes.question.correctNarrativeText}</div>
        )}

        {machine.phase === 'wrong_action' && (
          <div className="story-action-caption story-action-caption-wrong"><XCircle size={17} /> {scenes.question.wrongNarrativeText}</div>
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
            <h3 id="story-paused-title">{activeCharacter} waits</h3>
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
            <p>{scenes.completion.narrativeText} {level.continuationText}</p>
            <div className="story-completion-stats">
              <span><Leaf size={15} /><strong>{result.figsEarned}</strong><small>Figs earned</small></span>
              <span><Coins size={15} /><strong>{result.denariiEarned}</strong><small>Denarii</small></span>
              <span><CheckCircle2 size={15} /><strong>{result.correctCount}/{result.questionCount}</strong><small>Correct</small></span>
              <span><Flag size={15} /><strong>{result.completionPercentage}%</strong><small>Complete</small></span>
            </div>
            {result.replay && <p className="story-replay-note">Practice replay complete. Rewards remain settled once.</p>}
            <div className="mt-4 flex flex-wrap justify-center gap-2">
              <button type="button" onClick={() => void replayLevel()} disabled={busy} className="btn-primary"><RotateCcw size={15} /> Replay level</button>
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
          {(machine.phase === 'walking' || machine.phase === 'question_approach') && <button type="button" onClick={() => { setError(null); dispatch({ type: 'RESTART_FROM_CHECKPOINT' }); }} className="font-bold underline">Retry</button>}
          {machine.phase === 'question_active' && failedSubmission && <button type="button" onClick={() => void submit(failedSubmission.answer, failedSubmission.timedOut)} className="font-bold underline">Retry answer</button>}
        </div>
      )}
    </div>
  );
}
