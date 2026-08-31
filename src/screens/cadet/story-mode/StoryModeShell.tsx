import { useCallback, useEffect, useReducer, useState } from 'react';
import { ArrowLeft, Loader2, RefreshCcw } from 'lucide-react';
import { AbelOfferingLevel } from './AbelOfferingLevel';
import { fetchStoryModeProgress, startStoryModeLevel } from './api';
import { ABEL_LEVEL_SLUG } from './content';
import { INITIAL_STORY_MACHINE, transitionStoryState } from './engine';
import { StoryModeHome } from './StoryModeHome';
import type { StoryAttempt, StoryProgress } from './types';

interface StoryModeShellProps {
  onBackToDailyGames: () => void;
}

export function StoryModeShell({ onBackToDailyGames }: StoryModeShellProps) {
  const [machine, dispatch] = useReducer(transitionStoryState, INITIAL_STORY_MACHINE);
  const [progress, setProgress] = useState<StoryProgress | null>(null);
  const [attempt, setAttempt] = useState<StoryAttempt | null>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadProgress = useCallback(async (showHome = false) => {
    const nextProgress = await fetchStoryModeProgress();
    setProgress(nextProgress);
    if (showHome) dispatch({ type: 'HOME_READY' });
    return nextProgress;
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetchStoryModeProgress()
      .then((nextProgress) => {
        if (cancelled) return;
        setProgress(nextProgress);
        dispatch({ type: 'HOME_READY' });
      })
      .catch((reason: unknown) => {
        if (cancelled) return;
        setError(reason instanceof Error ? reason.message : 'Story Mode could not load.');
      });
    return () => { cancelled = true; };
  }, []);

  const startLevel = useCallback(async () => {
    if (starting) return;
    setStarting(true);
    setError(null);
    try {
      const nextAttempt = await startStoryModeLevel(ABEL_LEVEL_SLUG);
      setAttempt(nextAttempt);
      dispatch({
        type: 'START_LEVEL',
        checkpointId: nextAttempt.checkpointId,
        checkpointState: nextAttempt.checkpointState,
        questionActive: Boolean(nextAttempt.questionStartedAt),
        paused: nextAttempt.paused,
      });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The Story Mode level could not open.');
      throw reason;
    } finally {
      setStarting(false);
    }
  }, [starting]);

  const leaveLevel = useCallback(() => {
    setAttempt(null);
    dispatch({ type: 'EXIT_LEVEL' });
    void loadProgress().catch((reason: unknown) => setError(reason instanceof Error ? reason.message : 'Story progress could not refresh.'));
  }, [loadProgress]);

  const browseJourney = useCallback(async () => {
    setAttempt(null);
    await loadProgress();
    dispatch({ type: 'EXIT_LEVEL' });
    dispatch({ type: 'OPEN_BROWSER' });
  }, [loadProgress]);

  if (!progress || machine.phase === 'loading') {
    return (
      <div className="mx-auto max-w-5xl space-y-4 animate-fade-in">
        <button type="button" onClick={onBackToDailyGames} className="btn-ghost text-sm"><ArrowLeft size={15} /> Back to Daily Games</button>
        <section className="story-loading-panel" aria-live="polite">
          {error ? (
            <>
              <p className="font-semibold text-ink">The journey could not open.</p>
              <p className="mt-1 max-w-md text-sm text-stone">{error}</p>
              <button type="button" onClick={() => { setError(null); void loadProgress(true).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : 'Story Mode could not load.')); }} className="btn-primary mt-4">
                <RefreshCcw size={15} /> Retry
              </button>
            </>
          ) : (
            <><Loader2 size={24} className="animate-spin text-gold" /><p className="mt-3 text-sm font-semibold text-ink">Opening Story Mode</p></>
          )}
        </section>
      </div>
    );
  }

  if (attempt && !['home', 'browser'].includes(machine.phase)) {
    return (
      <AbelOfferingLevel
        attempt={attempt}
        machine={machine}
        dispatch={dispatch}
        onExit={leaveLevel}
        onReplay={startLevel}
        onBrowse={browseJourney}
        onProgressChanged={() => loadProgress().then(() => undefined)}
      />
    );
  }

  return (
    <StoryModeHome
      progress={progress}
      browsing={machine.phase === 'browser'}
      starting={starting}
      error={error}
      onBackToDailyGames={onBackToDailyGames}
      onBrowse={() => dispatch({ type: 'OPEN_BROWSER' })}
      onCloseBrowse={() => dispatch({ type: 'CLOSE_BROWSER' })}
      onStart={() => { void startLevel().catch(() => undefined); }}
    />
  );
}
