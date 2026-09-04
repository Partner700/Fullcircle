import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  CheckCircle2,
  HelpCircle,
  Coins,
  Gift,
  Loader2,
  LockKeyhole,
  Send,
  Users,
  X,
  XCircle,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import {
  dismissDoveQuestion,
  fetchDoveQuestionParticipants,
  fetchPendingDoveQuestion,
  submitDoveQuestionAnswer,
} from '../lib/doveQuestions';
import { isSoundscapeEnabled } from '../lib/soundscape';
import { supabase } from '../lib/supabase';
import type {
  DoveQuestionAnswerResult,
  DoveQuestionParticipant,
  PendingDoveQuestion,
} from '../lib/types';
import { cn } from '../lib/utils';
import { Dove } from './Dove';
import { VallumAvatarBadge } from './VallumAvatarBadge';

function ParticipantStack({ participants, total }: { participants: DoveQuestionParticipant[]; total: number }) {
  const shown = participants.slice(0, 12);
  return (
    <div className="flex items-center gap-2">
      <div className="flex min-h-6 items-center">
        {shown.map((participant, index) => (
          <span
            key={participant.user_id}
            title={participant.display_name}
            className="relative flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full text-[9px] font-bold text-peri"
            style={{ marginLeft: index === 0 ? 0 : -6, zIndex: shown.length - index }}
          >
            <span className="flex h-full w-full items-center justify-center overflow-hidden rounded-full border border-peri/50 bg-surface-2 shadow-sm">
              {participant.avatar_url ? (
                <img src={participant.avatar_url} alt={participant.display_name} className="h-full w-full object-cover" />
              ) : participant.display_name.trim().charAt(0).toUpperCase()}
            </span>
            <VallumAvatarBadge userId={participant.user_id} size="xs" />
          </span>
        ))}
      </div>
      <span className="inline-flex items-center gap-1 text-[10px] font-bold text-stone">
        <Users size={12} /> {total} answered
      </span>
    </div>
  );
}

function resultMessage(result: DoveQuestionAnswerResult) {
  if (result.is_correct && result.reward_paid > 0) return `Correct. You received ${result.reward_paid.toLocaleString()} Denarii.`;
  if (result.is_correct) return 'Correct answer.';
  return 'That answer is not correct.';
}

export function DoveQuestionOverlay() {
  const { profile } = useAuth();
  const [question, setQuestion] = useState<PendingDoveQuestion | null>(null);
  const [participants, setParticipants] = useState<DoveQuestionParticipant[]>([]);
  const [answer, setAnswer] = useState('');
  const [result, setResult] = useState<DoveQuestionAnswerResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [dismissing, setDismissing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const loadPromiseRef = useRef<Promise<void> | null>(null);
  const resultRef = useRef<DoveQuestionAnswerResult | null>(null);
  const settlingRef = useRef(false);
  const dialogRef = useRef<HTMLElement | null>(null);
  const questionId = question?.id || null;
  const participantCount = question?.participant_count || 0;
  const questionSoundUrl = question?.sound_url || null;

  useEffect(() => { resultRef.current = result; }, [result]);

  const loadParticipants = useCallback(async (questionId: string, fallbackCount = 0) => {
    try {
      const people = await fetchDoveQuestionParticipants(questionId);
      setParticipants(people);
      setQuestion((current) => current?.id === questionId
        ? { ...current, participant_count: Math.max(fallbackCount, people.length) }
        : current);
    } catch {
      setParticipants([]);
    }
  }, []);

  const loadPending = useCallback(() => {
    if (!profile || resultRef.current || settlingRef.current) return Promise.resolve();
    if (loadPromiseRef.current) return loadPromiseRef.current;
    setLoading(true);
    const request = (async () => {
      try {
        const next = await fetchPendingDoveQuestion();
        setError(null);
        setQuestion((current) => {
          if (current?.id !== next?.id) setAnswer('');
          return next;
        });
        if (next) await loadParticipants(next.id, next.participant_count);
        else setParticipants([]);
      } catch {
        // A missed realtime event is retried on the short foreground poll.
      } finally {
        setLoading(false);
      }
    })();
    const tracked = request.finally(() => {
      if (loadPromiseRef.current === tracked) loadPromiseRef.current = null;
    });
    loadPromiseRef.current = tracked;
    return tracked;
  }, [loadParticipants, profile]);

  useEffect(() => {
    if (!profile) {
      setQuestion(null);
      setParticipants([]);
      setResult(null);
      settlingRef.current = false;
      return;
    }
    void loadPending();
    const refreshWhenAvailable = () => {
      if (document.visibilityState === 'visible') void loadPending();
    };
    const interval = window.setInterval(refreshWhenAvailable, 30_000);
    window.addEventListener('focus', refreshWhenAvailable);
    window.addEventListener('online', refreshWhenAvailable);
    document.addEventListener('visibilitychange', refreshWhenAvailable);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener('focus', refreshWhenAvailable);
      window.removeEventListener('online', refreshWhenAvailable);
      document.removeEventListener('visibilitychange', refreshWhenAvailable);
    };
  }, [loadPending, profile]);

  useEffect(() => {
    if (!profile) return;
    const channel = supabase
      .channel(`dove_question_delivery_${profile.id}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'user_notifications', filter: `recipient_id=eq.${profile.id}` },
        (payload) => {
          if ((payload.new as { notification_type?: string }).notification_type === 'dove_question') void loadPending();
        },
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'dove_question_targets', filter: `user_id=eq.${profile.id}` },
        () => { void loadPending(); },
      )
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [loadPending, profile]);

  useEffect(() => {
    if (!questionId) return;
    const channel = supabase
      .channel(`dove_question_participants_${questionId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'dove_question_participants', filter: `question_id=eq.${questionId}` },
        () => { void loadParticipants(questionId, participantCount); },
      )
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [loadParticipants, participantCount, questionId]);

  useEffect(() => {
    if (!question?.expires_at || result) return;
    const delay = new Date(question.expires_at).getTime() - Date.now();
    if (delay <= 0) {
      setQuestion(null);
      void loadPending();
      return;
    }
    const timeout = window.setTimeout(() => {
      setQuestion(null);
      void loadPending();
    }, Math.min(delay + 250, 2_147_000_000));
    return () => window.clearTimeout(timeout);
  }, [loadPending, question?.expires_at, result]);

  useEffect(() => {
    if (!questionId) return;
    const previousOverflow = document.body.style.overflow;
    const appRoot = document.getElementById('root');
    const rootWasInert = appRoot?.hasAttribute('inert') || false;
    const previousAriaHidden = appRoot?.getAttribute('aria-hidden') ?? null;
    document.body.style.overflow = 'hidden';
    appRoot?.setAttribute('inert', '');
    appRoot?.setAttribute('aria-hidden', 'true');
    const focusFrame = window.requestAnimationFrame(() => {
      dialogRef.current?.querySelector<HTMLElement>('button:not(:disabled), input:not(:disabled), textarea:not(:disabled)')?.focus();
    });
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.body.style.overflow = previousOverflow;
      if (!rootWasInert) appRoot?.removeAttribute('inert');
      if (previousAriaHidden === null) appRoot?.removeAttribute('aria-hidden');
      else appRoot?.setAttribute('aria-hidden', previousAriaHidden);
    };
  }, [questionId]);

  useEffect(() => {
    if (!questionId || result || !questionSoundUrl || !isSoundscapeEnabled()) return;
    const audio = new Audio(questionSoundUrl);
    audio.loop = true;
    audio.volume = 0.55;
    void audio.play().catch(() => undefined);
    return () => {
      audio.pause();
      audio.currentTime = 0;
    };
  }, [questionId, questionSoundUrl, result]);

  const dismiss = useCallback(async () => {
    if (!question || question.delivery_mode === 'required' || dismissing) return;
    setDismissing(true);
    setError(null);
    try {
      await dismissDoveQuestion(question.id);
      setQuestion(null);
      setParticipants([]);
      await loadPending();
    } catch (dismissError) {
      setError(dismissError instanceof Error ? dismissError.message : 'The question could not be dismissed.');
    } finally {
      setDismissing(false);
    }
  }, [dismissing, loadPending, question]);

  useEffect(() => {
    if (!question || question.delivery_mode === 'required' || result) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') void dismiss();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [dismiss, question, result]);

  const submit = async () => {
    if (!question || !answer.trim() || submitting) return;
    settlingRef.current = true;
    setSubmitting(true);
    setError(null);
    try {
      const settled = await submitDoveQuestionAnswer(question.id, answer.trim());
      resultRef.current = settled;
      setResult(settled);
      await loadParticipants(question.id, question.participant_count + 1);
    } catch (submitError) {
      settlingRef.current = false;
      setError(submitError instanceof Error ? submitError.message : 'Your answer could not be submitted.');
    } finally {
      setSubmitting(false);
    }
  };

  const continueAfterResult = async () => {
    settlingRef.current = false;
    resultRef.current = null;
    setResult(null);
    setQuestion(null);
    setAnswer('');
    setParticipants([]);
    await loadPending();
  };

  if (!profile || !question) return null;

  const required = question.delivery_mode === 'required';
  const totalParticipants = Math.max(question.participant_count, participants.length);
  const modal = (
    <div
      className={cn('fixed inset-0 flex items-center justify-center overflow-y-auto bg-navy/80 px-3 py-4 backdrop-blur-sm animate-fade-in', required ? 'z-[2147483600]' : 'z-[2147482000]')}
      role="dialog"
      aria-modal="true"
      aria-labelledby="dove-question-heading"
      onClick={() => { if (!required && !result) void dismiss(); }}
    >
      <section
        ref={dialogRef}
        className="relative my-auto w-full max-w-lg overflow-hidden rounded-lg border border-peri/35 bg-surface/95 shadow-2xl backdrop-blur-xl animate-scale-in"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="relative border-b border-border bg-surface-2/85 px-5 pb-4 pt-3">
          <div className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <div className="flex h-16 w-16 flex-shrink-0 items-center justify-center">
                <Dove size={62} className="animate-float" />
              </div>
              <div className="min-w-0">
                <p className="text-[10px] font-bold uppercase text-peri">Delivered by the Dove</p>
                <h2 id="dove-question-heading" className="font-display text-lg font-bold text-ink">A question has arrived</h2>
                <span className={cn('mt-1 inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[9px] font-bold uppercase', required ? 'border-coral/35 bg-coral/10 text-coral' : 'border-peri/35 bg-peri/10 text-peri')}>
                  {required ? <LockKeyhole size={10} /> : <HelpCircle size={10} />}
                  {required ? 'Answer to continue' : 'Optional'}
                </span>
              </div>
            </div>
            {!required && !result && (
              <button type="button" onClick={() => void dismiss()} disabled={dismissing} className="icon-btn flex-shrink-0" aria-label="Dismiss question" title="Dismiss question">
                {dismissing ? <Loader2 size={16} className="animate-spin" /> : <X size={17} />}
              </button>
            )}
          </div>
        </div>

        <div className="max-h-[calc(100dvh-8.5rem)] overflow-y-auto p-5">
          {result ? (
            <div className="text-center">
              <div className={cn('mx-auto flex h-14 w-14 items-center justify-center rounded-full border', result.is_correct ? 'border-sage/40 bg-sage/12 text-sage' : 'border-coral/40 bg-coral/12 text-coral')}>
                {result.is_correct ? <CheckCircle2 size={30} /> : <XCircle size={30} />}
              </div>
              <h3 className={cn('mt-3 font-display text-xl font-bold', result.is_correct ? 'text-sage' : 'text-coral')}>{resultMessage(result)}</h3>
              {!result.is_correct && (
                <p className="mt-3 rounded-md border border-sage/25 bg-sage/8 px-3 py-2 text-sm text-ink">
                  Correct answer: <strong>{result.correct_answer}</strong>
                </p>
              )}
              {result.explanation && <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-stone">{result.explanation}</p>}
              <div className="mt-4 flex flex-wrap justify-center gap-2 text-[11px] font-semibold">
                {result.cost_paid > 0 && <span className="inline-flex items-center gap-1 rounded-full border border-brass/30 bg-brass/10 px-2.5 py-1 text-brass"><Coins size={12} /> {result.cost_paid.toLocaleString()} spent</span>}
                {result.cost_waived && <span className="rounded-full border border-peri/30 bg-peri/10 px-2.5 py-1 text-peri">Entry cost waived</span>}
                {result.reward_paid > 0 && <span className="inline-flex items-center gap-1 rounded-full border border-sage/30 bg-sage/10 px-2.5 py-1 text-sage"><Gift size={12} /> {result.reward_paid.toLocaleString()} earned</span>}
              </div>
              <button type="button" onClick={() => void continueAfterResult()} className="btn-primary mt-5 w-full justify-center py-3">Continue</button>
            </div>
          ) : (
            <>
              <ParticipantStack participants={participants} total={totalParticipants} />
              <p className="mt-4 whitespace-pre-wrap text-base font-semibold leading-relaxed text-ink">{question.question_text}</p>

              {question.question_type === 'multiple_choice' || question.question_type === 'true_false' ? (
                <div className="mt-4 grid gap-2">
                  {question.options.map((option, index) => (
                    <button
                      key={`${option}-${index}`}
                      type="button"
                      onClick={() => setAnswer(option)}
                      className={cn('flex min-h-12 w-full items-center gap-3 rounded-md border px-3 py-2.5 text-left text-sm font-semibold transition-colors', answer === option ? 'border-peri bg-peri/12 text-ink shadow-sm' : 'border-border-bright bg-surface-2 text-ink hover:border-peri/45')}
                    >
                      <span className={cn('flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full border text-[10px] font-bold', answer === option ? 'border-peri bg-peri text-navy' : 'border-border-bright text-stone')}>
                        {String.fromCharCode(65 + index)}
                      </span>
                      <span className="min-w-0 break-words">{option}</span>
                    </button>
                  ))}
                </div>
              ) : (
                <div className="mt-4">
                  <label htmlFor="dove-question-answer" className="mb-1 block text-xs font-semibold text-stone">Your answer</label>
                  <textarea
                    id="dove-question-answer"
                    value={answer}
                    onChange={(event) => setAnswer(event.target.value)}
                    rows={3}
                    autoFocus
                    className="input-field w-full resize-y text-sm"
                    onKeyDown={(event) => {
                      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') void submit();
                    }}
                  />
                </div>
              )}

              <div className="mt-4 flex flex-wrap gap-2">
                <span className="inline-flex items-center gap-1 rounded-full border border-brass/30 bg-brass/10 px-2.5 py-1 text-[10px] font-bold text-brass"><Coins size={12} /> {question.entry_cost_denarii.toLocaleString()} to answer</span>
                <span className="inline-flex items-center gap-1 rounded-full border border-sage/30 bg-sage/10 px-2.5 py-1 text-[10px] font-bold text-sage"><Gift size={12} /> {question.reward_denarii.toLocaleString()} if correct</span>
                <span className="ml-auto text-[10px] font-semibold text-stone">Balance: {question.wallet_denarii.toLocaleString()}</span>
              </div>
              {question.entry_cost_denarii > 0 && <p className="mt-2 text-[10px] leading-relaxed text-stone">The entry cost is charged once when you submit, whether the answer is right or wrong.</p>}
              {required && question.entry_cost_denarii > question.wallet_denarii && <p className="mt-2 text-[10px] font-semibold text-peri">Because this question is obligatory, its entry cost will be waived for you.</p>}

              {error && <div role="alert" className="mt-3 rounded-md border border-coral/35 bg-coral/10 px-3 py-2 text-xs text-coral">{error}</div>}
              <button type="button" onClick={() => void submit()} disabled={!answer.trim() || submitting || loading} className="btn-primary mt-4 w-full justify-center py-3">
                {submitting ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
                {submitting ? 'Checking...' : question.entry_cost_denarii > 0 ? `Answer for ${question.entry_cost_denarii.toLocaleString()} Denarii` : 'Submit answer'}
              </button>
            </>
          )}
        </div>
      </section>
    </div>
  );

  return typeof document === 'undefined' ? modal : createPortal(modal, document.body);
}
