import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CheckCircle2, Clock3, Loader2, Trophy, X, XCircle } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import {
  claimSharedQuizResult,
  type SharedQuizClaimQuestion,
  type SharedQuizClaimResult,
} from '../lib/queries';
import { cn } from '../lib/utils';
import { requestAppNavigation } from '../lib/appNavigation';

const PENDING_CLAIM_KEY = 'full-circle-pending-quiz-claim';

function storedValue(key: string) {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function clearStoredValue(key: string) {
  try {
    window.localStorage.removeItem(key);
  } catch {
    // Storage can be unavailable in strict mobile privacy modes.
  }
}

function answerText(answer: unknown): string {
  if (answer === null || answer === undefined || answer === '') return 'No answer';
  if (typeof answer === 'string' || typeof answer === 'number' || typeof answer === 'boolean') {
    return String(answer);
  }
  if (Array.isArray(answer)) return answer.map(answerText).join(', ');
  try {
    return JSON.stringify(answer);
  } catch {
    return String(answer);
  }
}

function sameAnswer(left: unknown, right: unknown) {
  return answerText(left).trim().toLocaleLowerCase() === answerText(right).trim().toLocaleLowerCase();
}

function releaseLabel(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'the scheduled release time';
  return new Intl.DateTimeFormat(undefined, {
    weekday: 'short',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'Africa/Douala',
    timeZoneName: 'short',
  }).format(date);
}

function AnswerReview({ question }: { question: SharedQuizClaimQuestion }) {
  const options = Array.isArray(question.options) ? question.options : [];

  return (
    <article className="border-t border-border py-4 first:border-t-0 first:pt-0 last:pb-0">
      <div className="flex items-start gap-2.5">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-border bg-surface-2 text-xs font-bold text-ink">
          {question.question_index + 1}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold leading-relaxed text-ink">{question.question_text}</p>
          {options.length > 0 ? (
            <div className="mt-3 space-y-2">
              {options.map((option, index) => {
                const selected = sameAnswer(option, question.selected_answer);
                const correct = sameAnswer(option, question.correct_answer);
                return (
                  <div
                    key={`${answerText(option)}:${index}`}
                    className={cn(
                      'flex items-center justify-between gap-2 rounded-lg border px-3 py-2 text-xs',
                      correct && 'border-moss/45 bg-moss/10 text-moss',
                      selected && !correct && 'border-coral/45 bg-coral/10 text-coral',
                      !correct && !selected && 'border-border bg-surface-2 text-stone',
                    )}
                  >
                    <span>{answerText(option)}</span>
                    {correct
                      ? <CheckCircle2 size={16} className="shrink-0" />
                      : selected
                        ? <XCircle size={16} className="shrink-0" />
                        : null}
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="mt-3 space-y-2">
              <div className={cn(
                'flex items-center justify-between gap-2 rounded-lg border px-3 py-2 text-xs',
                question.is_correct
                  ? 'border-moss/45 bg-moss/10 text-moss'
                  : 'border-coral/45 bg-coral/10 text-coral',
              )}>
                <span>Your answer: {answerText(question.selected_answer)}</span>
                {question.is_correct ? <CheckCircle2 size={16} /> : <XCircle size={16} />}
              </div>
              {!question.is_correct && (
                <div className="flex items-center justify-between gap-2 rounded-lg border border-moss/45 bg-moss/10 px-3 py-2 text-xs text-moss">
                  <span>Correct answer: {answerText(question.correct_answer)}</span>
                  <CheckCircle2 size={16} />
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </article>
  );
}

export function PublicQuizResultClaim() {
  const { profile } = useAuth();
  const [result, setResult] = useState<SharedQuizClaimResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const navigatedRef = useRef<string | null>(null);
  const querySessionId = useMemo(() => (
    typeof window === 'undefined'
      ? null
      : new URLSearchParams(window.location.search).get('claim-quiz')
  ), []);
  const pendingSessionId = useMemo(() => (
    typeof window === 'undefined' ? null : storedValue(PENDING_CLAIM_KEY)
  ), []);
  const sessionId = querySessionId || pendingSessionId;

  useEffect(() => {
    if (!profile || !sessionId || dismissed) return;
    if (navigatedRef.current !== sessionId) {
      navigatedRef.current = sessionId;
      requestAppNavigation('quiz', { quiz_session_id: sessionId });
    }
    const guestKey = storedValue(`full-circle-public:quiz:${sessionId}`);
    let active = true;
    let retryTimer: number | undefined;

    if (!guestKey) {
      setError('This browser no longer has the guest quiz key needed to open that result.');
      return;
    }

    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const claim = await claimSharedQuizResult(sessionId, guestKey);
        if (!active) return;
        setResult(claim);
        if (!claim.released) {
          const remaining = new Date(claim.release_at).getTime() - Date.now();
          retryTimer = window.setTimeout(() => void load(), Math.max(5_000, Math.min(60_000, remaining + 500)));
        }
      } catch (claimError: unknown) {
        if (active) setError(claimError instanceof Error ? claimError.message : 'Your shared quiz result could not be opened.');
      } finally {
        if (active) setLoading(false);
      }
    };

    void load();
    return () => {
      active = false;
      if (retryTimer !== undefined) window.clearTimeout(retryTimer);
    };
  }, [dismissed, profile, sessionId]);

  if (!profile || !sessionId || dismissed || typeof document === 'undefined') return null;

  const close = () => {
    setDismissed(true);
    if (result?.released || error) clearStoredValue(PENDING_CLAIM_KEY);
    const url = new URL(window.location.href);
    url.searchParams.delete('signup');
    url.searchParams.delete('claim-quiz');
    window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
  };

  return createPortal(
    <div className="fixed inset-0 z-[10070] flex items-center justify-center bg-ink/70 p-3 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="shared-quiz-result-title">
      <section className="relative max-h-[92dvh] w-full max-w-lg overflow-y-auto rounded-xl border border-border-bright bg-surface p-5 shadow-2xl sm:p-6">
        <button type="button" onClick={close} aria-label="Close quiz result" className="absolute right-3 top-3 flex h-8 w-8 items-center justify-center rounded-full text-stone hover:bg-surface-2 hover:text-ink">
          <X size={17} />
        </button>

        {loading && !result ? (
          <div className="flex min-h-48 flex-col items-center justify-center text-center">
            <Loader2 size={28} className="animate-spin text-brass" />
            <h2 id="shared-quiz-result-title" className="mt-3 font-display text-xl font-bold text-ink">Opening your quiz result</h2>
            <p className="mt-1 text-sm text-stone">Linking the answers from this device to your account.</p>
          </div>
        ) : error ? (
          <div className="py-8 text-center">
            <XCircle size={31} className="mx-auto text-coral" />
            <h2 id="shared-quiz-result-title" className="mt-3 font-display text-xl font-bold text-ink">Result unavailable</h2>
            <p className="mt-2 text-sm leading-relaxed text-stone">{error}</p>
            <button type="button" onClick={close} className="btn-primary mt-5">Continue</button>
          </div>
        ) : result && !result.released ? (
          <div className="py-8 text-center">
            <Clock3 size={32} className="mx-auto text-brass" />
            <p className="eyebrow mt-3 text-brass">Answers safely received</p>
            <h2 id="shared-quiz-result-title" className="mt-1 font-display text-2xl font-bold text-ink">{result.title}</h2>
            <p className="mt-3 text-sm leading-relaxed text-stone">
              Your marked answer sheet stays sealed until {releaseLabel(result.release_at)}. Full Circle will keep it ready for this account.
            </p>
            <button type="button" onClick={close} className="btn-primary mt-5">Continue</button>
          </div>
        ) : result ? (
          <>
            <div className="pr-9 text-center">
              <Trophy size={34} className="mx-auto text-brass" />
              <p className="eyebrow mt-3 text-brass">Shared quiz result</p>
              <h2 id="shared-quiz-result-title" className="mt-1 font-display text-2xl font-bold text-ink">{result.title}</h2>
              <p className="mt-2 text-sm text-stone">
                {result.correct_count || 0}/{result.question_count || 0} correct
              </p>
            </div>
            <div className="mt-5">
              {(result.questions || []).map((question) => <AnswerReview key={question.id} question={question} />)}
            </div>
            <button type="button" onClick={close} className="btn-primary mt-6 w-full justify-center">Continue to Full Circle</button>
          </>
        ) : null}
      </section>
    </div>,
    document.body,
  );
}
