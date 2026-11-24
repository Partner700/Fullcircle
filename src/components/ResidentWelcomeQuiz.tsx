import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';

type Question = { index: number; prompt: string; options: string[]; remaining_ms: number };
type QuizState = { status: 'question'; question: Question } | { status: 'complete'; score: number } | { status: 'skip' };

const rewards = ['Oops! No freezer this time.', 'You earned one daily freezer.', 'You earned three daily freezers.', 'You earned one weekly freezer.'];

export function ResidentWelcomeQuiz({ onReading, onGames }: { onReading: () => void; onGames: () => void }) {
  const [state, setState] = useState<QuizState | null>(null);
  const [deadline, setDeadline] = useState(0);
  const [seconds, setSeconds] = useState(10);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [reading, setReading] = useState(false);
  const [closed, setClosed] = useState(false);
  const running = useRef(false);
  const request = useCallback(async (question?: number, answer?: number) => {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setError(false);
    try {
      const { data, error: failure } = await supabase.rpc('resident_welcome_quiz', {
        p_question: question ?? null, p_answer: answer ?? null,
      });
      if (failure || !data) throw failure ?? new Error('Quiz unavailable');
      const result = data as QuizState;
      if (result.status === 'question') {
        setDeadline(Date.now() + result.question.remaining_ms);
        setSeconds(Math.ceil(result.question.remaining_ms / 1000));
      }
      setState(result);
    } catch {
      setError(true);
    } finally {
      setBusy(false);
      running.current = false;
    }
  }, []);

  useEffect(() => { void request(); }, [request]);
  useEffect(() => {
    if (state?.status !== 'question' || error) return;
    const tick = () => {
      const remaining = Math.max(0, deadline - Date.now());
      setSeconds(Math.ceil(remaining / 1000));
      if (remaining === 0) void request(state.question.index);
    };
    const timer = window.setInterval(tick, 150);
    tick();
    return () => window.clearInterval(timer);
  }, [deadline, error, request, state]);

  useEffect(() => {
    if (state?.status === 'complete' && !reading && !closed) {
      onReading();
      setReading(true);
    }
  }, [closed, onReading, reading, state]);

  if (closed || (!state && !error) || state?.status === 'skip') return null;
  const goToReading = () => { onReading(); setReading(true); };
  return (
    <div className="fixed inset-0 z-[170] grid place-items-center bg-ink/70 p-4">
      <section role="dialog" aria-modal="true" aria-labelledby="resident-welcome-title" className="card w-full max-w-sm space-y-4 p-5">
        <h2 id="resident-welcome-title" className="font-display text-xl font-bold text-ink">
          {reading ? 'Earn your streak' : 'Welcome to Full Circle'}
        </h2>
        {reading ? (
          <>
            {state?.status === 'complete' && <p className="text-sm text-ink">{state.score} of 3 correct. {rewards[state.score]}</p>}
            <p className="text-sm text-stone">On weekdays, submit your meditation and pass Level 1 of Daily Trivia. On Saturday, take the quiz. On Sunday, open today’s reading.</p>
            <button type="button" className="btn-primary" onClick={() => { setClosed(true); onGames(); }}>Open Daily Games</button>
            <button type="button" className="btn-secondary ml-2" onClick={() => setClosed(true)}>Keep reading</button>
          </>
        ) : error ? (
          <>
            <p role="alert" className="text-sm text-stone">The welcome quiz could not connect. You can retry or go to today’s reading.</p>
            <button type="button" className="btn-primary" disabled={busy} onClick={() => void request()}>Retry</button>
            <button type="button" className="btn-secondary ml-2" onClick={goToReading}>Today’s reading</button>
          </>
        ) : state?.status === 'question' ? (
          <>
            <p className="text-xs font-semibold text-stone">Question {state.question.index} of 3 · {seconds}s</p>
            <p className="font-semibold text-ink">{state.question.prompt}</p>
            <div className="grid gap-2">
              {state.question.options.map((option, index) => (
                <button key={option} type="button" className="btn-secondary justify-start" disabled={busy || seconds === 0}
                  onClick={() => void request(state.question.index, index)}>{option}</button>
              ))}
            </div>
          </>
        ) : null}
      </section>
    </div>
  );
}
