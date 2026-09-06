import { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '../../context/AuthContext';
import { SectionHeader, EmptyState } from '../../components/AppShell';
import { Dove } from '../../components/Dove';
import { ScrollEdge, SealBullet } from '../../components/AncientMotifs';
import { PanelImageBackdrop } from '../../components/PanelImageBackdrop';
import { QuizResponders } from '../../components/QuizResponders';
import { WeeklyQuizRankings } from '../../components/WeeklyQuizRankings';
import {
  fetchLatestQuizSession, fetchPlayableQuestionsForSession, fetchQuizAttempt, fetchResponsesForAttempt,
  fetchNarratives, fetchRelicInventory, resetQuizAttemptWithLazarus, startQuizAttempt,
  saveQuizResponse, consumeQuizQuestionRelic, completeQuizAttempt, fetchMyQuizRuntimeState,
  fetchPanelImageSetting, fetchQuizWaitingMessages, sendQuizWaitingMessage,
  fetchMyWeeklyQuizResult, forfeitQuizAttemptOnExit, recordExternalShare,
} from '../../lib/queries';
import { supabase } from '../../lib/supabase';
import { QUIZ_LIVE_DURATION_MINUTES, RELIC_SLUGS } from '../../lib/constants';
import { formatCountdown, formatDate, formatDenarii, getAppDateTimeMs, getTodayISODate, cn } from '../../lib/utils';
import { setScenarioSound, playSoundEffect } from '../../lib/soundscape';
import type {
  QuizSession, GeneratedQuestion, QuizAttempt, QuestionResponse, DailyNarrative,
  PanelImageSetting, WeeklyQuizReleasedResult,
} from '../../lib/types';
import {
  FileQuestion, Clock, CheckCircle2, XCircle, AlertTriangle, Loader2, ChevronLeft, ChevronRight,
  Trophy, Zap, Lock, Ban, BookOpen, Swords, RefreshCw, Lightbulb, Wand2,
  SkipForward, Volume2, Eye, Sparkles, Share2,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

type Phase = 'not_scheduled' | 'scheduled' | 'countdown' | 'live' | 'closed';

const QUIZ_RETRY_DELAYS_MS = [0, 350, 900];

function quizErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object' && 'message' in error) {
    return String((error as { message?: unknown }).message || '');
  }
  return String(error || '');
}

function isTransientQuizError(error: unknown) {
  const message = quizErrorMessage(error);
  return error instanceof TypeError
    || /failed to fetch|network|load failed|timeout|connection|temporarily unavailable/i.test(message);
}

async function withQuizNetworkRetry<T>(request: () => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (const delay of QUIZ_RETRY_DELAYS_MS) {
    if (delay > 0) await new Promise((resolve) => window.setTimeout(resolve, delay));
    try {
      return await request();
    } catch (error) {
      lastError = error;
      if (!isTransientQuizError(error)) throw error;
    }
  }
  throw lastError;
}

function quizDraftStorageKey(attemptId: string) {
  return `full-circle-quiz-draft:${attemptId}`;
}

function readQuizDrafts(attemptId: string): Record<string, unknown> {
  try {
    return JSON.parse(window.localStorage.getItem(quizDraftStorageKey(attemptId)) || '{}');
  } catch {
    return {};
  }
}

function writeQuizDraft(attemptId: string, questionId: string, answer: unknown) {
  try {
    const drafts = readQuizDrafts(attemptId);
    drafts[questionId] = answer;
    window.localStorage.setItem(quizDraftStorageKey(attemptId), JSON.stringify(drafts));
  } catch {
    // Storage can be unavailable in private browsing; server-saved answers remain authoritative.
  }
}

function clearQuizDraft(attemptId: string, questionId?: string) {
  try {
    if (!questionId) {
      window.localStorage.removeItem(quizDraftStorageKey(attemptId));
      return;
    }
    const drafts = readQuizDrafts(attemptId);
    delete drafts[questionId];
    if (Object.keys(drafts).length === 0) {
      window.localStorage.removeItem(quizDraftStorageKey(attemptId));
    } else {
      window.localStorage.setItem(quizDraftStorageKey(attemptId), JSON.stringify(drafts));
    }
  } catch {
    // Nothing to clear when storage is unavailable.
  }
}

// Rotating scripture facts shown on the Dove waiting/countdown screen.
const SCRIPTURE_FACTS = [
  'The word "talent" comes from the Greek talanton — a scale of weight, not a coin.',
  'A denarius was one day\'s wage for a laborer in first-century Judea.',
  'Paul wrote "I have fought the good fight, I have finished the race" from a Roman prison.',
  'The Septuagint translated Hebrew scripture into Greek in Alexandria, ~250 BC.',
  'Roman legions marched 20 miles a day — cadets were expected to keep pace.',
];

function localQuizDeadline(sessionDate: string) {
  return getAppDateTimeMs(sessionDate, 14, 45);
}

function localQuizDayStart(sessionDate: string) {
  return getAppDateTimeMs(sessionDate, 0, 0);
}

function localQuizResultsRelease(sessionDate: string) {
  return getAppDateTimeMs(sessionDate, 16, 0);
}

function hasUsedLazarus(attempt: QuizAttempt | null) {
  const used = attempt?.relics_used;
  return Array.isArray(used) && used.some((entry: any) => entry?.slug === RELIC_SLUGS.LAZARUS_COIN);
}

function looksLikeGeneratorLeak(option: string) {
  const value = option.trim();
  if (!value) return true;
  if (value.length > 220) return true;
  return /(\"?(question|options|correct_answer|accepted_answers|explanation|reference|focus_key)\"?\s*:|distractor|plausible option|generate|reasoning|i should|we need|the answer is|think carefully|json)/i.test(value);
}

function cleanQuizOptions(options: unknown, correctAnswer: unknown) {
  if (!Array.isArray(options)) return [];
  const correct = String(correctAnswer || '').trim();
  const cleaned = Array.from(new Set(options.map((option) => String(option || '').trim())))
    .filter((option) => !looksLikeGeneratorLeak(option));
  if (correct && !looksLikeGeneratorLeak(correct) && !cleaned.some((option) => option.toLowerCase() === correct.toLowerCase())) {
    cleaned.push(correct);
  }
  return cleaned.slice(0, 4);
}

export function CadetQuiz({ onQuizSubmitted }: { onQuizSubmitted: () => void }) {
  const { profile } = useAuth();
  const [session, setSession] = useState<QuizSession | null>(null);
  const [questions, setQuestions] = useState<GeneratedQuestion[]>([]);
  const [attempt, setAttempt] = useState<QuizAttempt | null>(null);
  const [responses, setResponses] = useState<QuestionResponse[]>([]);
  const [releasedResult, setReleasedResult] = useState<WeeklyQuizReleasedResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState(Date.now());
  const [inQuiz, setInQuiz] = useState(false);
  const [lazarusCount, setLazarusCount] = useState(0);
  const [usingLazarus, setUsingLazarus] = useState(false);
  const [lazarusMode, setLazarusMode] = useState(false);
  const [quizImage, setQuizImage] = useState<PanelImageSetting | null>(null);
  const [readingArchive, setReadingArchive] = useState<(DailyNarrative & { meditation_text?: string | null; best_verse?: string | null })[]>([]);
  const [reviewVerseIndex, setReviewVerseIndex] = useState(0);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [serverClockOffsetMs, setServerClockOffsetMs] = useState(0);
  const [effectiveClosesAt, setEffectiveClosesAt] = useState<number | null>(null);
  const releasedResultsLoadedRef = useRef(false);

  const applyRuntimeState = useCallback((runtime: Awaited<ReturnType<typeof fetchMyQuizRuntimeState>>) => {
    const serverNow = new Date(runtime.server_now).getTime();
    const effectiveClose = new Date(runtime.effective_closes_at).getTime();
    if (Number.isFinite(serverNow)) {
      setServerClockOffsetMs(serverNow - Date.now());
      setNow(serverNow);
    }
    if (Number.isFinite(effectiveClose)) setEffectiveClosesAt(effectiveClose);
    setAttempt(runtime.attempt);
    if (runtime.can_play && runtime.attempt?.status === 'in_progress') {
      setInQuiz(true);
    } else if (!runtime.attempt || runtime.attempt.status !== 'in_progress') {
      setInQuiz(false);
    }
  }, []);

  useEffect(() => {
    void setScenarioSound(inQuiz ? 'sound_quiz_start' : 'sound_quiz_waiting');
    return () => { void setScenarioSound(null); };
  }, [inQuiz]);

  const load = useCallback(async () => {
    if (!profile) { setLoading(false); return; }
    setLoading(true);
    setLoadError(null);
    let shellReady = false;
    try {
      const sess = await withQuizNetworkRetry(fetchLatestQuizSession);
      setSession(sess);
      if (sess) {
        const [qs, runtime] = await Promise.allSettled([
          withQuizNetworkRetry(() => fetchPlayableQuestionsForSession(sess.id)),
          withQuizNetworkRetry(() => fetchMyQuizRuntimeState(sess.id)),
        ]);
        if (qs.status === 'rejected') {
          throw qs.reason instanceof Error ? qs.reason : new Error('Quiz questions could not be loaded.');
        }
        if (runtime.status === 'rejected') {
          throw runtime.reason instanceof Error ? runtime.reason : new Error('Quiz timing could not be verified.');
        }
        setQuestions(qs.value);
        applyRuntimeState(runtime.value);
        const serverNow = new Date(runtime.value.server_now).getTime();
        const effectiveClose = new Date(runtime.value.effective_closes_at).getTime();
        if (
          runtime.value.attempt?.status === 'in_progress'
          && !runtime.value.can_play
          && Number.isFinite(serverNow)
          && Number.isFinite(effectiveClose)
          && serverNow >= effectiveClose
        ) {
          const completed = await withQuizNetworkRetry(() => (
            completeQuizAttempt(runtime.value.attempt!.id, 'timed_out')
          ));
          setAttempt(completed.attempt);
          setInQuiz(false);
        }
        if (runtime.value.attempt) {
          try {
            const resps = await withQuizNetworkRetry(() => fetchResponsesForAttempt(runtime.value.attempt!.id));
            setResponses(resps);
          } catch { setResponses([]); }
        } else {
          setResponses([]);
        }
      } else {
        setQuestions([]);
        setAttempt(null);
        setResponses([]);
        setInQuiz(false);
        setEffectiveClosesAt(null);
      }
      setLoading(false);
      shellReady = true;

      // These enrich the screen but do not decide whether the quiz can open.
      // Fetch them after the usable quiz shell is already visible.
      void (async () => {
        const [relics, image, result, narratives, records] = await Promise.allSettled([
          fetchRelicInventory(profile.id),
          fetchPanelImageSetting('quiz'),
          sess ? fetchMyWeeklyQuizResult(sess.id) : Promise.resolve(null),
          fetchNarratives(90),
          supabase.from('daily_records').select('record_date,meditation_text,best_verse').eq('user_id', profile.id),
        ]);
        if (relics.status === 'fulfilled') {
          const lazarus = relics.value.find((item) => item.relic_types?.slug === RELIC_SLUGS.LAZARUS_COIN);
          setLazarusCount(lazarus?.quantity || 0);
        }
        if (image.status === 'fulfilled') setQuizImage(image.value);
        if (result.status === 'fulfilled') setReleasedResult(result.value);
        if (narratives.status === 'fulfilled' && records.status === 'fulfilled') {
          const recordsByDate = new Map((records.value.data || []).map((record: any) => [record.record_date, record]));
          setReadingArchive(narratives.value
            .filter((item) => item.narrative_date < getTodayISODate())
            .map((item) => ({ ...item, ...(recordsByDate.get(item.narrative_date) || {}) })));
        }
      })().catch((error) => console.warn('Quiz extras could not load:', error));
    } catch (error) {
      console.error('Quiz load error:', error);
      setLoadError(quizErrorMessage(error) || 'The quiz could not be loaded.');
    } finally {
      if (!shellReady) setLoading(false);
    }
  }, [applyRuntimeState, profile]);

  const syncRuntimeState = useCallback(async () => {
    if (!session?.id) return null;
    const runtime = await withQuizNetworkRetry(() => fetchMyQuizRuntimeState(session.id));
    applyRuntimeState(runtime);
    return runtime;
  }, [applyRuntimeState, session?.id]);

  const verifyQuizDeadline = useCallback(async () => {
    try {
      const runtime = await syncRuntimeState();
      if (!runtime || runtime.attempt?.status !== 'in_progress') return false;
      const serverNow = new Date(runtime.server_now).getTime();
      const effectiveClose = new Date(runtime.effective_closes_at).getTime();
      return Number.isFinite(serverNow)
        && Number.isFinite(effectiveClose)
        && serverNow >= effectiveClose
        && !runtime.can_play;
    } catch (error) {
      console.warn('Quiz deadline could not yet be verified:', error);
      return false;
    }
  }, [syncRuntimeState]);

  useEffect(() => {
    if (!session || !attempt || session.quiz_type !== 'saturday') return;
    if (!['submitted', 'timed_out'].includes(attempt.status)) return;
    if (now < localQuizResultsRelease(session.session_date) || releasedResultsLoadedRef.current) return;

    releasedResultsLoadedRef.current = true;
    void Promise.all([
      fetchPlayableQuestionsForSession(session.id),
      fetchResponsesForAttempt(attempt.id),
      fetchQuizAttempt(profile!.id, session.id),
      fetchMyWeeklyQuizResult(session.id),
    ]).then(([releasedQuestions, releasedResponses, releasedAttempt, result]) => {
      setQuestions(releasedQuestions);
      setResponses(releasedResponses);
      if (releasedAttempt) setAttempt(releasedAttempt);
      setReleasedResult(result);
      const answersAreOpen = releasedQuestions.length > 0
        && releasedQuestions.every((question) => question.question_payload?.correct_answer !== undefined);
      if (!answersAreOpen || !result?.released) releasedResultsLoadedRef.current = false;
    }).catch((error) => {
      releasedResultsLoadedRef.current = false;
      console.error('Released quiz results could not load:', error);
    });
  }, [attempt, now, profile, session]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!session?.id) return;
    const channel = supabase
      .channel(`quiz-session-lifecycle-${session.id}`)
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'quiz_sessions',
        filter: `id=eq.${session.id}`,
      }, (payload) => setSession(payload.new as QuizSession))
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [session?.id]);

  useEffect(() => {
    releasedResultsLoadedRef.current = false;
    setReleasedResult(null);
  }, [session?.id]);

  // Keep the displayed phase and timer aligned to the database clock.
  useEffect(() => {
    const tick = () => setNow(Date.now() + serverClockOffsetMs);
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [serverClockOffsetMs]);

  // Mobile browsers may suspend JavaScript while the screen sleeps or another
  // app is open. Reconcile the same attempt as soon as this screen returns.
  useEffect(() => {
    const reconcile = () => {
      if (document.hidden) return;
      if (session?.id) {
        void syncRuntimeState().catch((error) => console.warn('Quiz resume sync failed:', error));
      } else if (loadError) {
        void load();
      }
    };
    window.addEventListener('focus', reconcile);
    window.addEventListener('online', reconcile);
    document.addEventListener('visibilitychange', reconcile);
    return () => {
      window.removeEventListener('focus', reconcile);
      window.removeEventListener('online', reconcile);
      document.removeEventListener('visibilitychange', reconcile);
    };
  }, [load, loadError, session?.id, syncRuntimeState]);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-16 animate-fade-in">
        <Dove size={56} className="text-brass mb-4" />
        <p className="eyebrow text-stone">Loading</p>
        <p className="text-sm text-stone mt-1">Preparing the quiz chamber…</p>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="card mx-auto max-w-lg p-6 text-center animate-fade-in">
        <AlertTriangle size={30} className="mx-auto mb-3 text-roman" />
        <h2 className="font-display text-xl font-semibold text-ink">Quiz temporarily unavailable</h2>
        <p className="mt-2 text-sm text-stone">{loadError}</p>
        <button type="button" className="btn-primary mt-4" onClick={() => void load()}>
          <RefreshCw size={16} /> Try Again
        </button>
      </div>
    );
  }

  if (!session) {
    return (
      <EmptyState
        icon={FileQuestion}
        title="No quiz scheduled"
        message="Your instructor hasn't scheduled a quiz session yet. Quizzes run on Saturdays."
      />
    );
  }

  const countdownOpens = new Date(session.countdown_opens_at).getTime();
  const liveOpens = new Date(session.live_opens_at).getTime();
  const liveCloses = new Date(session.live_closes_at).getTime();
  const lazarusDeadline = localQuizDeadline(session.session_date);
  const lazarusWindowOpen = session.quiz_type === 'saturday'
    && now >= localQuizDayStart(session.session_date)
    && now < lazarusDeadline;
  const canUseLazarus = lazarusWindowOpen && lazarusCount > 0;
  const attemptLazarusActive = hasUsedLazarus(attempt) && lazarusWindowOpen;

  let phase: Phase;
  if (session.status === 'scheduled') phase = 'scheduled';
  else if (now < countdownOpens) phase = 'scheduled';
  else if (now < liveOpens) phase = 'countdown';
  else if (now < liveCloses) phase = 'live';
  else phase = 'closed';

  const startStandardAttempt = async () => {
    if (questions.length === 0) {
      alert('This quiz has no approved questions yet. Please wait for the instructor.');
      return;
    }
    try {
      const activeAttempt = await withQuizNetworkRetry(() => startQuizAttempt(session.id));
      setAttempt(activeAttempt);
      setEffectiveClosesAt(liveCloses);
      setLazarusMode(false);
      setInQuiz(true);
    } catch (error: any) {
      alert(error.message || 'The quiz could not be started.');
    }
  };

  const startWithLazarus = async () => {
    if (!profile || !session || usingLazarus) return;
    setUsingLazarus(true);
    try {
      if (questions.length === 0) throw new Error('This quiz has no approved questions yet.');
      const reopened = await withQuizNetworkRetry(() => resetQuizAttemptWithLazarus(profile.id, session.id));
      setAttempt(reopened);
      setResponses([]);
      setEffectiveClosesAt(lazarusDeadline);
      setLazarusCount((count) => Math.max(0, count - 1));
      setLazarusMode(true);
      setInQuiz(true);
    } catch (e: any) {
      alert(e.message || 'The Lazarus Coin could not reopen this quiz.');
    }
    setUsingLazarus(false);
  };

  const resultsReleaseAt = localQuizResultsRelease(session.session_date);
  const responderPanel = <QuizResponders sessionId={session.id} />;
  const rankingPanel = session.quiz_type === 'saturday' ? <WeeklyQuizRankings sessionId={session.id} /> : null;

  const shareQuiz = async () => {
    const url = new URL(window.location.href);
    url.search = '';
    url.hash = '';
    url.searchParams.set('share', 'quiz');
    url.searchParams.set('id', session.id);
    const shareData = {
      title: session.title || 'Full Circle Weekly Quiz',
      text: 'Take this week\'s Full Circle quiz, then join the camp to see your result.',
      url: url.toString(),
    };
    try {
      if (navigator.share) {
        await navigator.share(shareData);
      } else {
        await navigator.clipboard.writeText(shareData.url);
        alert('Quiz link copied.');
      }
      await recordExternalShare('quiz', session.id).catch(() => undefined);
    } catch (error: any) {
      if (error?.name !== 'AbortError') alert('Could not share this quiz.');
    }
  };

  // If attempt is forfeited or submitted, show the correct terminal view.
  if (attempt?.status === 'forfeited') {
    return <div className="space-y-5 max-w-2xl mx-auto"><QuizReadingReview archive={readingArchive} verseIndex={reviewVerseIndex} onNext={() => setReviewVerseIndex((index) => index + 1)} />{responderPanel}{rankingPanel}<ForfeitedView attempt={attempt} image={quizImage} canUseLazarus={canUseLazarus} lazarusCount={lazarusCount} usingLazarus={usingLazarus} onUseLazarus={startWithLazarus} /></div>;
  }
  if (attempt && (attempt.status === 'submitted' || attempt.status === 'timed_out')) {
    if (session.quiz_type === 'saturday' && now < resultsReleaseAt) {
      return <div className="space-y-5 max-w-2xl mx-auto"><QuizReadingReview archive={readingArchive} verseIndex={reviewVerseIndex} onNext={() => setReviewVerseIndex((index) => index + 1)} />{responderPanel}{rankingPanel}<SubmittedView releaseAt={resultsReleaseAt} image={quizImage} canUseLazarus={canUseLazarus} lazarusCount={lazarusCount} usingLazarus={usingLazarus} onUseLazarus={startWithLazarus} /></div>;
    }
    return <div className="space-y-5 max-w-2xl mx-auto"><QuizReadingReview archive={readingArchive} verseIndex={reviewVerseIndex} onNext={() => setReviewVerseIndex((index) => index + 1)} />{responderPanel}{rankingPanel}<ResultsView attempt={attempt} result={releasedResult} weekly={session.quiz_type === 'saturday'} image={quizImage} questions={questions} responses={responses} canUseLazarus={canUseLazarus} lazarusCount={lazarusCount} usingLazarus={usingLazarus} onUseLazarus={startWithLazarus} /></div>;
  }

  // In quiz
  if (inQuiz && (phase === 'live' || lazarusMode || attemptLazarusActive) && attempt?.status === 'in_progress') {
    return (
      <QuizPlay
        questions={questions}
        initialResponses={responses}
        attempt={attempt}
        userId={profile!.id}
        liveCloses={effectiveClosesAt ?? (phase === 'live' && !lazarusMode ? liveCloses : lazarusDeadline)}
        serverClockOffsetMs={serverClockOffsetMs}
        verifyDeadline={verifyQuizDeadline}
        onSubmit={() => { setInQuiz(false); load(); onQuizSubmitted(); }}
      />
    );
  }

  // Pre-quiz views
  const timeToLive = liveOpens - now;
  const timeToClose = liveCloses - now;

  return (
    <div className="space-y-5 animate-fade-in max-w-2xl mx-auto">
      {/* Quiz card — session header */}
      <div className="card relative overflow-hidden p-4 sm:p-6 animate-slide-up">
        <PanelImageBackdrop image={quizImage} opacityFallback={22} veilClassName="bg-navy-2/76" />
        <div className="relative text-center">
          <div className="eyebrow text-brass mb-3">{session.quiz_type === 'fortune' ? 'Fortune Quiz' : 'Saturday Quiz'}</div>
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl mb-3 bg-surface-2 border border-border">
            <FileQuestion size={28} className="text-brass" />
          </div>
          <h2 className="font-display text-xl font-semibold text-ink">{session.title}</h2>
          <p className="text-sm text-stone mt-1">
            {formatDate(session.session_date)}
          </p>
          <button type="button" className="btn-secondary mt-4 text-xs" onClick={() => void shareQuiz()}>
            <Share2 size={14} /> Share quiz
          </button>
        </div>
      </div>

      {responderPanel}

      {rankingPanel}

      <QuizReadingReview archive={readingArchive} verseIndex={reviewVerseIndex} onNext={() => setReviewVerseIndex((index) => index + 1)} />

      {/* Phase-specific content */}
      {phase === 'scheduled' && (
        <WaitingRoom
          eyebrow="Scheduled"
          title="Awaiting Instructor Launch"
          description="Programmed quiz start:"
          countdownMs={Math.max(0, timeToLive)}
          footnote={`Launch opens the countdown automatically · Live at ${new Date(session.live_opens_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`}
          progressLabel="Time to programmed start"
          sessionId={session.id}
          userId={profile!.id}
        />
      )}

      {phase === 'countdown' && (
        <WaitingRoom
          eyebrow="Waiting Room"
          title="Waiting Room"
          description="Quiz starts in:"
          countdownMs={timeToLive}
          footnote="Get ready — 10 questions, 15 minutes, no skips forward."
          progressLabel="Countdown to live"
          pulse
          sessionId={session.id}
          userId={profile!.id}
        />
      )}

      {phase === 'live' && (
        <div className="card p-6 text-center animate-scale-in border-moss/40">
          <div className="eyebrow text-moss mb-3">Live Now</div>
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl mb-3 bg-moss/10 border border-moss/30">
            <Zap size={28} className="text-moss" />
          </div>
          <h3 className="font-display font-medium text-ink mb-1">Quiz is LIVE</h3>
          <p className="text-sm text-stone mb-4">Time remaining to start:</p>
          <div className={cn(
            'font-display text-3xl font-semibold',
            timeToClose <= 60_000 ? 'text-roman animate-pulse' : 'text-brass',
          )}>
            {formatCountdown(timeToClose)}
          </div>
          <button
            onClick={startStandardAttempt}
            className="btn-primary mt-4 w-full"
          >
            <Zap size={18} /> Enter Quiz
          </button>
          <p className="text-xs text-moss mt-3 flex items-center justify-center gap-1">
            <CheckCircle2 size={12} /> Saved answers remain safe if the app sleeps or reconnects
          </p>
        </div>
      )}

      {phase === 'closed' && !attempt && (
        <div className="card p-6 text-center animate-fade-in">
          <div className="eyebrow text-stone mb-3">Closed</div>
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl mb-3 bg-surface-2 border border-border">
            <Lock size={28} className="text-stone" />
          </div>
          <h3 className="font-display font-medium text-ink mb-1">Quiz Closed</h3>
          <p className="text-sm text-stone">This quiz session has ended. You did not attempt it.</p>
          <p className="text-xs text-roman mt-2">Missing the Saturday quiz breaks your streak.</p>
          {lazarusWindowOpen && (
            <button
              onClick={startWithLazarus}
              disabled={!canUseLazarus || usingLazarus}
              className="btn-primary mt-4 w-full"
            >
              {usingLazarus ? <Loader2 size={18} className="animate-spin" /> : <RefreshCw size={18} />}
              Use Lazarus Coin Before 2:45 PM {lazarusCount > 0 ? `(${lazarusCount})` : ''}
            </button>
          )}
        </div>
      )}

      {/* Rules */}
      <div className="card p-5 animate-slide-up">
        <SectionHeader title="Quiz Rules" />
        <div className="space-y-2 text-sm text-stone">
          <RuleItem icon={Clock} text={`${QUIZ_LIVE_DURATION_MINUTES}-minute live window — no late submissions`} />
          <RuleItem icon={ChevronRight} text="Forward-gated: can't skip ahead without answering" />
          <RuleItem icon={ChevronLeft} text="Can navigate back to review/change earlier answers" />
          <RuleItem icon={Ban} text="Leaving an active quiz before submitting forfeits the attempt" />
          <RuleItem icon={RefreshCw} text="Lazarus Coin can reopen or retake the Saturday quiz before 2:45 PM" />
          <RuleItem
            icon={Trophy}
            text={session.quiz_type === 'fortune'
              ? 'Perfect = 6,000 Ð. Less than perfect = 1,000 Ð. Figs are weighted by difficulty.'
              : 'Figs: easy answers = 1, medium = 3, hard = 5. Perfect score earns 6,000 Ð; any imperfect score with at least one correct answer earns 1,000 Ð.'}
          />
        </div>
      </div>

    </div>
  );
}

function QuizReadingReview({ archive, verseIndex, onNext }: { archive: (DailyNarrative & { meditation_text?: string | null; best_verse?: string | null })[]; verseIndex: number; onNext: () => void }) {
  const verses = archive.flatMap((item) => (item.highlighted_verses || []).map((verse) => ({ ...verse, date: item.narrative_date, title: item.title, bestVerse: item.best_verse })));
  const verse = verses.length ? verses[verseIndex % verses.length] : null;
  return <section className="card relative overflow-hidden p-5 animate-slide-up">
    <div className="flex items-center justify-between gap-3"><div><p className="eyebrow text-stone">Quiz Reading Review</p><p className="mt-1 text-sm text-ink">Previous readings and verses to carry into the quiz</p></div><BookOpen size={20} className="text-brass" /></div>
    {!verse ? <p className="mt-4 text-sm text-stone">Your previous readings will appear here once narratives have been published.</p> : <div className="mt-4 rounded-lg border border-brass/25 bg-brass-soft p-4"><p className="text-xs font-semibold text-brass">{verse.reference} · {verse.title}</p><p className="mt-2 text-sm leading-relaxed text-ink">{verse.text}</p>{verse.bestVerse === verse.reference && <p className="mt-2 text-xs text-sage">Your selected best verse</p>}<button type="button" onClick={onNext} className="btn-secondary mt-3 text-xs">Next verse</button></div>}
    <details className="mt-4 border-t border-border pt-3"><summary className="cursor-pointer text-xs font-semibold text-ink">Open previous readings and my meditations</summary><div className="mt-3 space-y-2">{archive.map((item) => <details key={item.id} className="rounded-md border border-border bg-surface-2 p-3"><summary className="cursor-pointer text-sm text-ink">{item.title} · {item.narrative_date}</summary><p className="mt-2 whitespace-pre-wrap text-xs leading-relaxed text-stone">{item.main_text}</p>{item.meditation_text && <p className="mt-2 whitespace-pre-wrap text-xs leading-relaxed text-ink">{item.meditation_text}</p>}</details>)}</div></details>
  </section>;
}

// ── Waiting / countdown room — Dove + rotating scripture + thin progress bar ──
function WaitingRoom({
  eyebrow, title, description, countdownMs, footnote, progressLabel, pulse, sessionId, userId,
}: {
  eyebrow: string;
  title: string;
  description: string;
  countdownMs: number;
  footnote: string;
  progressLabel: string;
  pulse?: boolean;
  sessionId: string;
  userId: string;
}) {
  const [factIdx, setFactIdx] = useState(0);
  const totalSec = Math.max(1, Math.floor(countdownMs / 1000));

  // Rotate scripture facts every 6 seconds
  useEffect(() => {
    const id = setInterval(() => setFactIdx((i) => (i + 1) % SCRIPTURE_FACTS.length), 6000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className={cn('card p-6 text-center animate-fade-in', pulse && 'animate-pulse')}>
      <div className="eyebrow text-brass mb-4">{eyebrow}</div>

      {/* Centered Dove */}
      <div className="flex justify-center mb-4">
        <Dove size={56} className="text-brass" />
      </div>

      <h3 className="font-display font-medium text-ink mb-1">{title}</h3>
      <p className="text-sm text-stone mb-4">{description}</p>

      <div className={cn(
        'font-display text-4xl font-semibold',
        countdownMs <= 60_000 ? 'text-roman' : 'text-brass',
      )}>
        {formatCountdown(countdownMs)}
      </div>

      {/* Thin progress bar */}
      <div className="mt-4 mb-3">
        <div className="h-1 bg-surface-2 rounded-full overflow-hidden">
          <div
            className="h-full bg-brass rounded-full transition-all duration-1000"
            style={{ width: `${Math.min(100, (totalSec > 0 ? 100 : 0))}%` }}
          />
        </div>
        <p className="text-[10px] text-stone uppercase tracking-wider mt-1.5">{progressLabel}</p>
      </div>

      {/* Rotating scripture fact */}
      <p className="text-xs text-stone italic mt-4 min-h-[2.5rem] flex items-center justify-center px-2 animate-fade-in" key={factIdx}>
        {SCRIPTURE_FACTS[factIdx]}
      </p>

      <p className="text-xs text-stone mt-3">{footnote}</p>
      <QuizWaitingChat sessionId={sessionId} userId={userId} />
    </div>
  );
}

function QuizWaitingChat({ sessionId, userId }: { sessionId: string; userId: string }) {
  const [messages, setMessages] = useState<any[]>([]);
  const [body, setBody] = useState('');
  const load = useCallback(async () => { try { setMessages(await fetchQuizWaitingMessages(sessionId)); } catch (error) { console.error('Quiz chat load failed', error); } }, [sessionId]);
  useEffect(() => { void load(); const channel = supabase.channel(`quiz-waiting-chat-${sessionId}`).on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'quiz_waiting_messages', filter: `quiz_session_id=eq.${sessionId}` }, () => void load()).subscribe(); return () => { void supabase.removeChannel(channel); }; }, [sessionId, load]);
  const send = async () => { if (!body.trim()) return; try { await sendQuizWaitingMessage(sessionId, userId, body); setBody(''); } catch (error) { console.error('Quiz chat send failed', error); } };
  return <div className="mt-5 border-t border-border pt-4 text-left"><p className="mb-2 text-xs font-semibold text-ink">Waiting room chat</p><div className="max-h-28 space-y-1.5 overflow-y-auto">{messages.length === 0 ? <p className="py-2 text-center text-xs text-stone">Say hello while you wait.</p> : messages.map((message) => <p key={message.id} className="rounded-md bg-surface-2 px-2 py-1.5 text-xs text-ink"><b>{message.sender_id === userId ? 'You' : message.sender?.display_name || 'Cadet'}:</b> {message.body}</p>)}</div><div className="mt-2 flex gap-2"><input className="input-field min-w-0 flex-1 text-xs" value={body} onChange={(event) => setBody(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); void send(); } }} placeholder="Message the waiting room..." /><button type="button" onClick={() => void send()} className="btn-primary px-3 text-xs">Send</button></div></div>;
}

function RuleItem({ icon: Icon, text }: { icon: typeof Clock; text: string }) {
  return (
    <div className="flex gap-2.5 items-start">
      <Icon size={16} className="text-brass flex-shrink-0 mt-0.5" />
      <p>{text}</p>
    </div>
  );
}

function QuizPlay({ questions, initialResponses, attempt, userId, liveCloses, serverClockOffsetMs, verifyDeadline, onSubmit }: {
  questions: GeneratedQuestion[];
  initialResponses: QuestionResponse[];
  attempt: QuizAttempt;
  userId: string;
  liveCloses: number;
  serverClockOffsetMs: number;
  verifyDeadline: () => Promise<boolean>;
  onSubmit: () => void;
}) {
  const initialAnsweredIds = new Set(initialResponses.map((response) => response.question_id));
  const firstUnansweredIndex = questions.findIndex((question) => !initialAnsweredIds.has(question.id));
  const initialQuestionIndex = firstUnansweredIndex >= 0
    ? firstUnansweredIndex
    : Math.max(0, questions.length - 1);
  const initialQuestion = questions[initialQuestionIndex];
  const [currentIdx, setCurrentIdx] = useState(initialQuestionIndex);
  const [localResponses, setLocalResponses] = useState<Map<string, any>>(
    () => new Map(initialResponses.map((response) => [response.question_id, response.answer])),
  );
  const [selectedAnswer, setSelectedAnswer] = useState<any>(() => {
    const savedResponse = initialResponses.find((response) => response.question_id === initialQuestion?.id);
    const saved = savedResponse
      ? savedResponse.answer
      : readQuizDrafts(attempt.id)[initialQuestion?.id || ''] ?? null;
    return initialQuestion?.question_payload.type === 'order_sequence' && typeof saved === 'string'
      ? saved.split('|')
      : saved;
  });
  const [showFeedback, setShowFeedback] = useState(
    () => initialResponses.some((response) => response.question_id === initialQuestion?.id),
  );
  const [savingAnswer, setSavingAnswer] = useState(false);
  const [timeLeft, setTimeLeft] = useState(
    Math.max(0, Math.floor((liveCloses - (Date.now() + serverClockOffsetMs)) / 1000)),
  );
  const [submitting, setSubmitting] = useState(false);
  const [relicInventory, setRelicInventory] = useState<Record<string, number>>({});
  const [usingGoliath, setUsingGoliath] = useState(false);
  const [usingQuestionRelic, setUsingQuestionRelic] = useState<string | null>(null);
  const [relicNotice, setRelicNotice] = useState<string | null>(null);
  const [eliminatedOptions, setEliminatedOptions] = useState<string[]>([]);
  const submissionStartedRef = useRef(false);
  const deadlineCheckRef = useRef(false);
  const exitForfeitArmedRef = useRef(false);
  const exitForfeitSentRef = useRef(false);

  useEffect(() => {
    // React development mode probes effect cleanup immediately after mount.
    // Arm after that probe so only a real departure forfeits the attempt.
    const armTimer = window.setTimeout(() => { exitForfeitArmedRef.current = true; }, 1_000);
    const forfeitOnExit = () => {
      if (!exitForfeitArmedRef.current || exitForfeitSentRef.current || submissionStartedRef.current) return;
      exitForfeitSentRef.current = true;
      void forfeitQuizAttemptOnExit(attempt.id).catch((error) => {
        console.warn('Quiz exit forfeiture could not be confirmed:', error);
      });
    };
    const forfeitWhenHidden = () => { if (document.hidden) forfeitOnExit(); };
    window.addEventListener('pagehide', forfeitOnExit);
    window.addEventListener('beforeunload', forfeitOnExit);
    document.addEventListener('visibilitychange', forfeitWhenHidden);
    return () => {
      window.clearTimeout(armTimer);
      window.removeEventListener('pagehide', forfeitOnExit);
      window.removeEventListener('beforeunload', forfeitOnExit);
      document.removeEventListener('visibilitychange', forfeitWhenHidden);
      forfeitOnExit();
    };
  }, [attempt.id]);

  const handleSubmit = useCallback(async (status: 'submitted' | 'timed_out' = 'submitted', forcePerfect = false) => {
    if (submissionStartedRef.current) return;
    submissionStartedRef.current = true;
    setSubmitting(true);
    try {
      await withQuizNetworkRetry(() => completeQuizAttempt(attempt.id, status, forcePerfect));
      clearQuizDraft(attempt.id);
      void playSoundEffect('sound_quiz_finish', 0.62);
      onSubmit();
    } catch (error: any) {
      submissionStartedRef.current = false;
      setRelicNotice(error.message || 'The quiz could not be submitted. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }, [attempt.id, onSubmit]);

  useEffect(() => {
    let cancelled = false;
    supabase
      .from('relic_inventory')
      .select('quantity, relic_types(slug)')
      .eq('user_id', userId)
      .then(({ data }) => {
        if (cancelled || !data) return;
        const map: Record<string, number> = {};
        data.forEach((r: any) => {
          const relic = Array.isArray(r.relic_types) ? r.relic_types[0] : r.relic_types;
          if (relic?.slug) map[relic.slug] = r.quantity;
        });
        setRelicInventory(map);
      });
    return () => { cancelled = true; };
  }, [userId]);

  // Display the database-aligned countdown, then ask the database to confirm
  // expiry before submitting a timed-out attempt.
  useEffect(() => {
    const interval = setInterval(() => {
      const remaining = Math.floor((liveCloses - (Date.now() + serverClockOffsetMs)) / 1000);
      setTimeLeft(Math.max(0, remaining));
      if (remaining > 0 || deadlineCheckRef.current || submissionStartedRef.current) return;
      deadlineCheckRef.current = true;
      void verifyDeadline()
        .then((expired) => {
          if (expired) void handleSubmit('timed_out');
        })
        .finally(() => { deadlineCheckRef.current = false; });
    }, 1000);
    return () => clearInterval(interval);
  }, [handleSubmit, liveCloses, serverClockOffsetMs, verifyDeadline]);

  if (questions.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 animate-fade-in">
        <Dove size={48} className="text-brass mb-4" />
        <p className="text-sm text-stone">Loading questions…</p>
      </div>
    );
  }

  const q = questions[currentIdx];
  const payload = q?.question_payload;
  if (!q || !payload || typeof payload !== 'object' || typeof payload.type !== 'string' || typeof payload.question !== 'string') {
    return (
      <div className="card mx-auto max-w-lg p-6 text-center animate-fade-in">
        <AlertTriangle size={30} className="mx-auto mb-3 text-roman" />
        <h2 className="font-display text-xl font-semibold text-ink">This question needs correction</h2>
        <p className="mt-2 text-sm text-stone">The question record is incomplete. Your attempt is safe.</p>
        <div className="mt-4 flex justify-center gap-2">
          {currentIdx > 0 && <button type="button" className="btn-secondary" onClick={() => setCurrentIdx((value) => value - 1)}>Back</button>}
          {currentIdx < questions.length - 1
            ? <button type="button" className="btn-primary" onClick={() => setCurrentIdx((value) => value + 1)}>Next question</button>
            : <button type="button" className="btn-primary" onClick={() => void handleSubmit('submitted')}>Submit quiz</button>}
        </div>
      </div>
    );
  }
  const hasResponse = localResponses.has(q.id);
  const isLastQuestion = currentIdx === questions.length - 1;

  const saveResponse = async (answer: any) => {
    const result = await withQuizNetworkRetry(() => saveQuizResponse(attempt.id, q.id, answer));
    if (!result.accepted) {
      setRelicNotice(result.warning || 'That answer was not saved.');
      return false;
    }
    setLocalResponses((previous) => new Map(previous).set(q.id, answer));
    clearQuizDraft(attempt.id, q.id);
    return true;
  };

  const handleAnswer = async (answer: any) => {
    if (savingAnswer || submitting) return;
    const replacingAnswer = localResponses.has(q.id);
    setSavingAnswer(true);
    try {
      const accepted = await saveResponse(answer);
      if (!accepted) return;
      setSelectedAnswer(answer);
      setShowFeedback(true);
      setRelicNotice(`${replacingAnswer ? 'Answer updated' : 'Answer saved'}. You can change it until final submission.`);
    } catch (error: any) {
      setRelicNotice(error.message || 'Your answer could not be saved. Please try again.');
    } finally {
      setSavingAnswer(false);
    }
  };

  const moveToQuestion = (nextIndex: number) => {
    const nextQuestion = questions[nextIndex];
    const saved = localResponses.has(nextQuestion.id)
      ? localResponses.get(nextQuestion.id)
      : readQuizDrafts(attempt.id)[nextQuestion.id] ?? null;
    setCurrentIdx(nextIndex);
    setSelectedAnswer(nextQuestion.question_payload.type === 'order_sequence' && typeof saved === 'string'
      ? saved.split('|')
      : saved);
    setShowFeedback(localResponses.has(nextQuestion.id));
    setRelicNotice(null);
    setEliminatedOptions([]);
  };

  const goNext = () => {
    if (currentIdx < questions.length - 1) {
      moveToQuestion(currentIdx + 1);
    }
  };

  const goBack = () => {
    if (currentIdx > 0) {
      moveToQuestion(currentIdx - 1);
    }
  };

  const useGoliathSword = async () => {
    if (submitting || usingGoliath || (relicInventory[RELIC_SLUGS.SWORD_GOLIATH] || 0) <= 0) return;
    setUsingGoliath(true);
    try {
      setRelicInventory((prev) => ({
        ...prev,
        [RELIC_SLUGS.SWORD_GOLIATH]: Math.max(0, (prev[RELIC_SLUGS.SWORD_GOLIATH] || 0) - 1),
      }));
      await handleSubmit('submitted', true);
    } catch (e: any) {
      alert(e.message || 'Failed to use Sword of Goliath');
      setSubmitting(false);
    }
    setUsingGoliath(false);
  };

  const consumeQuestionRelic = async (slug: string) => {
    if (showFeedback || usingQuestionRelic || (relicInventory[slug] || 0) <= 0) return;
    setUsingQuestionRelic(slug);
    try {
      const result = await withQuizNetworkRetry(() => consumeQuizQuestionRelic(attempt.id, q.id, slug));
      setRelicInventory((previous) => ({
        ...previous,
        [slug]: Math.max(0, (previous[slug] || 0) - 1),
      }));
      if (result.notice) setRelicNotice(result.notice);
      if (result.eliminated_options) setEliminatedOptions(result.eliminated_options);
      if (result.skipped || result.auto_answered) {
        setLocalResponses((previous) => new Map(previous).set(q.id, null));
        setSelectedAnswer(null);
        setShowFeedback(true);
      }
    } catch (error: any) {
      setRelicNotice(error.message || 'This relic could not be used.');
    } finally {
      setUsingQuestionRelic(null);
    }
  };

  const useRelicHint = () => consumeQuestionRelic(RELIC_SLUGS.HINT);
  const useEliminate = () => consumeQuestionRelic(RELIC_SLUGS.ELIMINATE);
  const useSkip = () => consumeQuestionRelic(RELIC_SLUGS.SKIP);
  const useReference = () => consumeQuestionRelic(RELIC_SLUGS.REVEAL_REFERENCE);
  const useWitchBall = () => consumeQuestionRelic(RELIC_SLUGS.WITCH_BALL);
  const useTalkingDonkey = () => consumeQuestionRelic(RELIC_SLUGS.TALKING_DONKEY);

  const minutes = Math.floor(timeLeft / 60);
  const seconds = timeLeft % 60;
  const lowTime = timeLeft <= 60;
  const goliathCount = relicInventory[RELIC_SLUGS.SWORD_GOLIATH] || 0;

  return (
    <div className="space-y-4 animate-fade-in max-w-2xl mx-auto">
      {/* Header with timer */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="badge badge-roman">
            <Zap size={10} /> LIVE
          </span>
          <span className="text-sm text-stone">Q {currentIdx + 1}/{questions.length}</span>
        </div>
        <div className="flex items-center gap-2">
          {goliathCount > 0 && (
            <button
              onClick={useGoliathSword}
              disabled={submitting || usingGoliath}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-medium border border-roman/30 bg-roman/10 text-roman hover:bg-roman/15 transition-colors disabled:opacity-40"
              title="Use Sword of Goliath for a perfect quiz score"
            >
              {usingGoliath ? <Loader2 size={12} className="animate-spin" /> : <Swords size={12} />}
              Perfect ({goliathCount})
            </button>
          )}
          <div className={cn(
            'px-3 py-1.5 rounded-lg font-display font-semibold',
            lowTime ? 'bg-roman/15 text-roman animate-pulse' : 'bg-surface-2 text-brass border border-border',
          )}>
            {minutes}:{String(seconds).padStart(2, '0')}
          </div>
        </div>
      </div>

      {/* Progress bar */}
      <div className="h-1.5 bg-surface-2 rounded-full overflow-hidden">
        <div
          className={cn('h-full rounded-full transition-all', lowTime ? 'bg-roman' : 'bg-brass')}
          style={{ width: `${((currentIdx + 1) / questions.length) * 100}%` }}
        />
      </div>

      {!showFeedback && (
        <div className="flex flex-wrap gap-1.5">
          {( [
            [RELIC_SLUGS.HINT, 'Hint', Lightbulb, useRelicHint, true],
            [RELIC_SLUGS.ELIMINATE, 'Eliminate', Wand2, useEliminate, !!payload.options?.length],
            [RELIC_SLUGS.SKIP, 'Skip', SkipForward, useSkip, true],
            [RELIC_SLUGS.REVEAL_REFERENCE, 'Reference', BookOpen, useReference, true],
            [RELIC_SLUGS.TALKING_DONKEY, 'Donkey', Volume2, useTalkingDonkey, true],
            [RELIC_SLUGS.WITCH_BALL, 'Answer', Eye, useWitchBall, true],
          ] as Array<[string, string, LucideIcon, () => void, boolean]>).map(([slug, label, Icon, onClick, applicable]) => {
            const amount = relicInventory[slug as string] || 0;
            if (!amount || !applicable) return null;
            const isUsing = usingQuestionRelic === slug;
            return (
              <button
                key={slug}
                type="button"
                onClick={onClick}
                disabled={!!usingQuestionRelic}
                className="flex items-center gap-1 rounded-full border border-royal/25 bg-royal-soft px-2 py-1 text-[10px] font-medium text-royal transition-colors hover:bg-royal/10 disabled:opacity-45"
                title={`Use ${label} relic`}
              >
                {isUsing ? <Loader2 size={12} className="animate-spin" /> : <Icon size={12} />}
                <span>{label}</span> ({amount})
              </button>
            );
          })}
        </div>
      )}

      {/* Question card with scroll-edge motif */}
      <div key={`${q.id}-${currentIdx}`} className="card p-5 relative animate-slide-up">
        <ScrollEdge position="top" className="text-stone mb-2" />

        {/* Badges */}
        <div className="flex flex-wrap gap-1.5 mb-3">
          {q.recycled_from_game && (
            <span className="badge badge-brass text-[10px]">Recycled from game (harder)</span>
          )}
          {q.difficulty_tag === 'hard' && (
            <span className="badge badge-roman text-[10px]">Hard</span>
          )}
          {payload.type === 'scriptorium' && (
            <span className="badge badge-neutral text-[10px]"><BookOpen size={10} /> The Scriptorium</span>
          )}
        </div>

        <h3 className="font-display font-medium text-ink text-lg mb-4 mt-1">{payload.question}</h3>

        {relicNotice && (
          <div className="mb-4 flex items-start gap-1.5 rounded-lg border border-royal/20 bg-royal-soft p-2.5 text-xs text-royal animate-fade-in">
            <Sparkles size={14} className="mt-0.5 flex-shrink-0" /> {relicNotice}
          </div>
        )}

        {payload.passage && payload.type !== 'standard_text' && payload.type !== 'scriptorium' && (
          <div className="mb-4 max-h-40 overflow-y-auto rounded-lg border border-border bg-surface-2 p-4 font-serif text-sm leading-relaxed text-ink">
            <p className="mb-2 font-sans text-xs not-italic text-stone">Passage:</p>
            {payload.passage}
          </div>
        )}

        {/* Scriptorium */}
        {payload.type === 'scriptorium' && payload.blanked_text && (
          <div className="mb-4">
            <div className="p-4 rounded-lg bg-surface-2 font-serif text-ink text-center text-lg tracking-wider mb-3 border border-border">
              {payload.blanked_text}
            </div>
            <div>
              <textarea
                className="w-full min-h-[80px] p-3 rounded-lg bg-surface-2 border border-border text-ink font-serif focus:outline-none focus:border-brass transition-colors"
                placeholder="Type the verse from memory..."
                autoFocus
                value={selectedAnswer || ''}
                onChange={(e) => {
                  setSelectedAnswer(e.target.value);
                  writeQuizDraft(attempt.id, q.id, e.target.value);
                }}
              />
              <button
                onClick={() => selectedAnswer?.trim() && handleAnswer(selectedAnswer.trim())}
                disabled={!selectedAnswer?.trim() || savingAnswer}
                className="btn-primary mt-2 w-full disabled:opacity-50"
              >
                {savingAnswer ? <Loader2 size={16} className="animate-spin" /> : null}
                {showFeedback ? 'Update Answer' : 'Save Answer'}
              </button>
            </div>
          </div>
        )}

        {/* Standard written answer — exact/case-sensitive */}
        {payload.type === 'standard_text' && (
          <div className="mb-4">
            {payload.passage && (
              <div className="p-4 rounded-lg bg-surface-2 font-serif text-ink text-sm leading-relaxed border border-border mb-3 max-h-40 overflow-y-auto">
                <p className="text-xs text-stone mb-2 font-sans not-italic">Passage:</p>
                {payload.passage}
              </div>
            )}
            <div>
              <textarea
                className="w-full min-h-[80px] p-3 rounded-lg bg-surface-2 border border-border text-ink font-serif focus:outline-none focus:border-brass transition-colors"
                placeholder="Type the exact answer..."
                autoFocus
                value={selectedAnswer || ''}
                onChange={(e) => {
                  setSelectedAnswer(e.target.value);
                  writeQuizDraft(attempt.id, q.id, e.target.value);
                }}
              />
              <button
                onClick={() => selectedAnswer?.trim() && handleAnswer(selectedAnswer.trim())}
                disabled={!selectedAnswer?.trim() || savingAnswer}
                className="btn-primary mt-2 w-full disabled:opacity-50"
              >
                {savingAnswer ? <Loader2 size={16} className="animate-spin" /> : null}
                {showFeedback ? 'Update Answer' : 'Save Answer'}
              </button>
            </div>
          </div>
        )}

        {/* Multiple choice / True-false */}
        {['multiple_choice', 'true_false', 'fill_blank', 'spot_error'].includes(payload.type) && payload.options && (
          <div className="space-y-2">
            {cleanQuizOptions(payload.options, payload.correct_answer).filter((opt) => !eliminatedOptions.includes(opt)).map((opt, i) => {
              const isSelected = selectedAnswer === opt;
              return (
                <button
                  key={i}
                  onClick={() => handleAnswer(opt)}
                  disabled={savingAnswer}
                  className={cn(
                    'btn-ghost w-full text-left justify-start',
                    'hover:border-brass hover:bg-brass/5',
                    isSelected && 'border-brass bg-brass/10 text-ink',
                  )}
                >
                  <span className="flex-1">{opt}</span>
                </button>
              );
            })}
          </div>
        )}

        {/* Order sequence */}
        {payload.type === 'order_sequence' && payload.items && (
          <div className="space-y-2">
            <p className="text-xs text-stone">Click items in the correct order:</p>
            {payload.items.map((item) => {
              const savedOrder = localResponses.get(q.id);
              const userOrder = Array.isArray(selectedAnswer)
                ? selectedAnswer as string[]
                : typeof savedOrder === 'string' && savedOrder
                  ? savedOrder.split('|')
                  : [];
              const idx = userOrder.indexOf(item);
              return (
                <button
                  key={item}
                  onClick={() => {
                    const newOrder = userOrder.includes(item)
                      ? userOrder.filter((x) => x !== item)
                      : [...userOrder, item];
                    setSelectedAnswer(newOrder);
                    writeQuizDraft(attempt.id, q.id, newOrder);
                  }}
                  disabled={savingAnswer}
                  className={cn(
                    'btn-ghost w-full text-left justify-between',
                    userOrder.includes(item) && 'border-brass bg-brass/5',
                    !userOrder.includes(item) && 'hover:border-brass',
                  )}
                >
                  <span>{item}</span>
                  {userOrder.includes(item) && <span className="font-display font-semibold text-brass">{idx + 1}</span>}
                </button>
              );
            })}
            <button
              type="button"
              className="btn-primary mt-3 w-full disabled:opacity-50"
              disabled={!Array.isArray(selectedAnswer) || selectedAnswer.length !== payload.items.length || savingAnswer}
              onClick={() => void handleAnswer((selectedAnswer as string[]).join('|'))}
            >
              {savingAnswer ? <Loader2 size={16} className="animate-spin" /> : null}
              {showFeedback ? 'Update Order' : 'Save Order'}
            </button>
          </div>
        )}

        {/* Feedback + navigation */}
        {showFeedback && (
          <div className="mt-4 animate-slide-up">
            <div className="p-3 rounded-lg flex items-center gap-2 bg-surface-2 text-stone border border-border">
              <CheckCircle2 size={18} />
              <span className="text-sm font-medium">Answer saved. You can change it until final submission.</span>
            </div>
            {payload.reference && <p className="text-xs text-brass mt-2">Reference: {payload.reference}</p>}

            <div className="flex gap-2 mt-3">
              {currentIdx > 0 && (
                <button onClick={goBack} className="btn-ghost flex-1">
                  <ChevronLeft size={16} /> Back
                </button>
              )}
              {!isLastQuestion ? (
                <button onClick={goNext} className="btn-primary flex-1">
                  Next <ChevronRight size={16} />
                </button>
              ) : (
                <button
                  onClick={() => handleSubmit('submitted')}
                  disabled={submitting}
                  className="btn-primary flex-1"
                >
                  {submitting ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle2 size={16} />}
                  Submit Quiz
                </button>
              )}
            </div>
          </div>
        )}

        {/* If already answered (navigating back), allow forward without re-answering */}
        {hasResponse && !showFeedback && (
          <div className="mt-4 flex gap-2">
            {currentIdx > 0 && (
              <button onClick={goBack} className="btn-ghost flex-1">
                <ChevronLeft size={16} /> Back
              </button>
            )}
            <button onClick={goNext} className="btn-primary flex-1">
              Next <ChevronRight size={16} />
            </button>
          </div>
        )}

        <ScrollEdge position="bottom" className="text-stone mt-3" />
      </div>

      <div className="text-center text-xs text-moss flex items-center justify-center gap-1">
        <CheckCircle2 size={12} /> Every saved answer remains attached to this attempt across reconnects
      </div>
    </div>
  );
}

function LazarusQuizButton({
  canUseLazarus, lazarusCount, usingLazarus, onUseLazarus, className = '',
}: {
  canUseLazarus: boolean;
  lazarusCount: number;
  usingLazarus: boolean;
  onUseLazarus: () => void;
  className?: string;
}) {
  if (!canUseLazarus) return null;
  return (
    <button onClick={onUseLazarus} disabled={usingLazarus} className={cn('btn-primary w-full', className)}>
      {usingLazarus ? <Loader2 size={18} className="animate-spin" /> : <RefreshCw size={18} />}
      Use Lazarus Coin Before 2:45 PM ({lazarusCount})
    </button>
  );
}

function SubmittedView({ releaseAt, image, canUseLazarus, lazarusCount, usingLazarus, onUseLazarus }: {
  releaseAt: number;
  image: PanelImageSetting | null;
  canUseLazarus: boolean;
  lazarusCount: number;
  usingLazarus: boolean;
  onUseLazarus: () => void;
}) {
  return (
    <div className="max-w-md mx-auto animate-scale-in">
      <div className="card relative overflow-hidden p-5 sm:p-8 text-center border-moss/30">
        <PanelImageBackdrop image={image} veilClassName="bg-surface/80" />
        <div className="relative">
          <div className="eyebrow text-moss mb-3">Submitted</div>
          <div className="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4 bg-moss/10 border border-moss/30">
            <CheckCircle2 size={32} className="text-moss" />
          </div>
          <h2 className="font-display text-2xl font-semibold text-ink mb-2">Quiz Submitted</h2>
          <p className="text-sm text-stone">
            Your answers are safely recorded. Your marked answer sheet, denarii, and ranking will be released together at 4:00 PM.
          </p>
          <div className="mt-4 rounded-lg border border-border bg-surface-2 p-3">
            <p className="text-[10px] uppercase tracking-wider text-stone">Results release in</p>
            <p className="font-display text-xl font-semibold text-brass mt-1">
              {formatCountdown(Math.max(0, releaseAt - Date.now()))}
            </p>
          </div>
          <LazarusQuizButton
            canUseLazarus={canUseLazarus}
            lazarusCount={lazarusCount}
            usingLazarus={usingLazarus}
            onUseLazarus={onUseLazarus}
            className="mt-4"
          />
        </div>
      </div>
    </div>
  );
}

function ForfeitedView({ attempt, image, canUseLazarus, lazarusCount, usingLazarus, onUseLazarus }: {
  attempt: QuizAttempt;
  image: PanelImageSetting | null;
  canUseLazarus: boolean;
  lazarusCount: number;
  usingLazarus: boolean;
  onUseLazarus: () => void;
}) {
  return (
    <div className="max-w-md mx-auto animate-scale-in">
      <div className="card relative overflow-hidden p-5 sm:p-8 text-center border-roman/30">
        <PanelImageBackdrop image={image} veilClassName="bg-surface/80" />
        <div className="relative">
          <div className="eyebrow text-roman mb-3">Forfeited</div>
          <div className="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4 bg-roman/10 border border-roman/30">
            <Ban size={32} className="text-roman" />
          </div>
          <h2 className="font-display text-xl font-semibold text-roman mb-2">Quiz Interrupted</h2>
          <p className="text-sm text-stone mb-4">
            You left this quiz before submitting it, so the attempt was forfeited.
          </p>
          <div className="bg-roman/5 rounded-lg p-3 text-sm text-left space-y-2 border border-roman/20">
            <p className="text-roman font-medium">Consequences:</p>
            <div className="space-y-1.5 text-stone">
              <p className="flex items-start gap-2"><SealBullet className="text-roman mt-1.5 flex-shrink-0" /> Zero figs, zero denarii from this quiz</p>
              <p className="flex items-start gap-2"><SealBullet className="text-roman mt-1.5 flex-shrink-0" /> Does not count toward Quiz Champion</p>
              <p className="flex items-start gap-2"><SealBullet className="text-roman mt-1.5 flex-shrink-0" /> Breaks this Saturday's streak unless Lazarus reopens it in time</p>
            </div>
          </div>
          {attempt.forfeited_at && (
            <p className="text-xs text-stone mt-3">
              Forfeited at {new Date(attempt.forfeited_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
            </p>
          )}
          <LazarusQuizButton
            canUseLazarus={canUseLazarus}
            lazarusCount={lazarusCount}
            usingLazarus={usingLazarus}
            onUseLazarus={onUseLazarus}
            className="mt-4"
          />
        </div>
      </div>
    </div>
  );
}

function comparableQuizAnswer(value: unknown) {
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).join('|');
  if (value && typeof value === 'object') return JSON.stringify(value);
  return String(value ?? '').trim();
}

function displayQuizAnswer(value: unknown) {
  if (value == null || value === '') return 'No answer';
  if (Array.isArray(value)) return value.map((item) => String(item)).join(' → ');
  const text = String(value);
  return text.includes('|') ? text.split('|').join(' → ') : text;
}

function quizResponseIsCorrect(question: GeneratedQuestion, answer: unknown) {
  const payload = question.question_payload;
  if (!payload || payload.correct_answer == null || answer == null) return false;
  const given = comparableQuizAnswer(answer);
  const acceptedAnswers = Array.isArray(payload.accepted_answers)
    ? payload.accepted_answers
    : [];
  const accepted = [payload.correct_answer, ...acceptedAnswers];
  if (['standard_text', 'scriptorium'].includes(payload.type)) {
    return accepted.some((candidate) => comparableQuizAnswer(candidate) === given);
  }
  return accepted.some((candidate) => comparableQuizAnswer(candidate).toLowerCase() === given.toLowerCase());
}

function ResultsView({ attempt, result, weekly, image, questions, responses, canUseLazarus, lazarusCount, usingLazarus, onUseLazarus }: {
  attempt: QuizAttempt;
  result: WeeklyQuizReleasedResult | null;
  weekly: boolean;
  image: PanelImageSetting | null;
  questions: GeneratedQuestion[];
  responses: QuestionResponse[];
  canUseLazarus: boolean;
  lazarusCount: number;
  usingLazarus: boolean;
  onUseLazarus: () => void;
}) {
  const responseByQuestion = new Map(responses.map((response) => [response.question_id, response]));
  const correctByQuestion = questions.map((question) => (
    quizResponseIsCorrect(question, responseByQuestion.get(question.id)?.answer)
  ));
  const answersReady = questions.length > 0
    && questions.every((question) => question.question_payload?.correct_answer !== undefined);
  const correctCount = Number(result?.correct_count ?? correctByQuestion.filter(Boolean).length) || 0;
  const questionCount = Number(result?.question_count ?? questions.length) || questions.length;
  const perfect = result?.perfect ?? (questionCount > 0 && correctCount === questionCount);
  const denarii = Number(result?.denarii_awarded ?? (perfect ? 6000 : correctCount > 0 ? 1000 : 0));

  if (weekly && !result?.released) {
    return (
      <div className="card relative mx-auto max-w-2xl overflow-hidden p-6 text-center animate-fade-in">
        <PanelImageBackdrop image={image} veilClassName="bg-surface/80" />
        <div className="relative flex flex-col items-center">
          <Loader2 size={26} className="animate-spin text-brass" />
          <h2 className="mt-3 font-display text-xl font-semibold text-ink">Releasing your quiz result</h2>
          <p className="mt-1 text-sm text-stone">Your answer sheet and denarii are being settled now.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto animate-fade-in space-y-4">
      <div className="card relative overflow-hidden p-5 sm:p-8 text-center animate-scale-in">
        <PanelImageBackdrop image={image} veilClassName="bg-surface/80" />
        <div className="relative">
          <div className="eyebrow text-brass mb-3">Complete</div>
          <div className="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4 bg-brass/10 border border-brass/30">
            <Trophy size={32} className="text-brass" />
          </div>
          <h2 className="font-display text-2xl font-semibold text-ink mb-1">Quiz Complete</h2>
          <p className="text-sm text-stone mb-4">
            {attempt.status === 'timed_out' ? 'Time expired' : 'Submitted'} · {correctCount}/{questionCount} correct
          </p>

          <div className="mb-4 rounded-lg border border-border bg-surface-2 p-3">
            <p className="text-xs text-stone uppercase tracking-wider">Denarii</p>
            <p className="font-display text-xl font-semibold text-brass">{formatDenarii(denarii)}</p>
          </div>

          <p className="text-xs text-stone mb-3">
            {perfect ? 'Perfect score reward: 1 talent' : correctCount > 0 ? 'Quiz reward: 1,000 denarii' : 'No denarii were earned this time'}
          </p>
          <div className="flex flex-wrap items-center justify-center gap-1">
            {Array.from({ length: questions.length }, (_, i) => (
              <div key={i} className={cn(
                'w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold',
                (perfect || correctByQuestion[i]) ? 'bg-brass text-bg' : 'bg-surface-2 text-stone/40 border border-border',
              )}>
                {i + 1}
              </div>
            ))}
          </div>
          <LazarusQuizButton
            canUseLazarus={canUseLazarus}
            lazarusCount={lazarusCount}
            usingLazarus={usingLazarus}
            onUseLazarus={onUseLazarus}
            className="mt-5"
          />
        </div>
      </div>

      {!answersReady ? (
        <div className="card relative overflow-hidden p-6 text-center">
          <PanelImageBackdrop image={image} veilClassName="bg-surface/80" />
          <div className="relative flex flex-col items-center">
            <Loader2 size={24} className="animate-spin text-brass" />
            <h3 className="mt-3 font-display text-lg font-semibold text-ink">Opening your answer sheet</h3>
            <p className="mt-1 text-sm text-stone">The 4:00 PM seal is lifting. This will update automatically.</p>
          </div>
        </div>
      ) : (
        <section className="card relative overflow-hidden p-5 sm:p-6">
          <PanelImageBackdrop image={image} veilClassName="bg-surface/80" />
          <div className="relative">
            <div className="flex items-start justify-between gap-3 pb-4">
              <div>
                <p className="eyebrow text-brass">{weekly ? 'Released at 4:00 PM' : 'Quiz Review'}</p>
                <h3 className="mt-1 font-display text-xl font-semibold text-ink">Your Answer Sheet</h3>
                <p className="mt-1 text-xs text-stone">Your choices are marked against the released answers.</p>
              </div>
              <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg border border-brass/30 bg-brass-soft">
                <BookOpen size={20} className="text-brass" />
              </div>
            </div>

            <div className="divide-y divide-border">
              {questions.map((question, questionIndex) => {
                const payload = question.question_payload;
                const response = responseByQuestion.get(question.id);
                const selectedAnswer = response?.answer;
                const isCorrect = correctByQuestion[questionIndex];
                const options = cleanQuizOptions(payload?.options, payload?.correct_answer);
                const hasOptions = options.length > 0;

                return (
                  <article key={question.id} className="py-5 first:pt-1 last:pb-1">
                    <div className="flex items-start gap-3">
                      <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full border border-border bg-surface/75 text-xs font-semibold text-ink">
                        {questionIndex + 1}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="font-display text-base font-semibold leading-snug text-ink">{payload.question}</p>
                        {payload.blanked_text && (
                          <p className="mt-2 rounded-md border border-border bg-surface/70 p-3 font-serif text-sm text-ink">{payload.blanked_text}</p>
                        )}

                        {hasOptions ? (
                          <div className="mt-3 space-y-2">
                            {options.map((option, optionIndex) => {
                              const selected = comparableQuizAnswer(selectedAnswer).toLowerCase() === comparableQuizAnswer(option).toLowerCase();
                              const correct = comparableQuizAnswer(payload.correct_answer).toLowerCase() === comparableQuizAnswer(option).toLowerCase();
                              const wrongSelection = selected && !correct;
                              return (
                                <div
                                  key={`${question.id}-${optionIndex}`}
                                  className={cn(
                                    'flex min-h-11 items-center gap-2.5 rounded-lg border px-3 py-2 text-sm',
                                    correct && 'border-moss/50 bg-moss/15 text-ink',
                                    wrongSelection && 'border-roman/50 bg-roman/12 text-ink',
                                    !correct && !wrongSelection && 'border-border bg-surface/70 text-stone',
                                  )}
                                >
                                  <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full border border-current/25 text-[10px] font-semibold">
                                    {String.fromCharCode(65 + optionIndex)}
                                  </span>
                                  <span className="min-w-0 flex-1">{option}</span>
                                  {correct && <CheckCircle2 size={19} className="flex-shrink-0 text-moss" aria-label="Correct answer" />}
                                  {wrongSelection && <XCircle size={19} className="flex-shrink-0 text-roman" aria-label="Your incorrect answer" />}
                                </div>
                              );
                            })}
                            {selectedAnswer == null && (
                              <div className="flex min-h-11 items-center gap-2.5 rounded-lg border border-roman/50 bg-roman/12 px-3 py-2 text-sm text-ink">
                                <XCircle size={19} className="flex-shrink-0 text-roman" />
                                <span>No answer submitted</span>
                              </div>
                            )}
                          </div>
                        ) : (
                          <div className="mt-3 space-y-2">
                            <div className={cn(
                              'flex items-start gap-2 rounded-lg border px-3 py-2.5 text-sm',
                              isCorrect ? 'border-moss/50 bg-moss/15 text-ink' : 'border-roman/50 bg-roman/12 text-ink',
                            )}>
                              {isCorrect
                                ? <CheckCircle2 size={19} className="mt-0.5 flex-shrink-0 text-moss" />
                                : <XCircle size={19} className="mt-0.5 flex-shrink-0 text-roman" />}
                              <div className="min-w-0">
                                <p className="text-[10px] font-semibold uppercase text-stone">Your answer</p>
                                <p className="mt-0.5 whitespace-pre-wrap break-words">{displayQuizAnswer(selectedAnswer)}</p>
                              </div>
                            </div>
                            {!isCorrect && (
                              <div className="flex items-start gap-2 rounded-lg border border-moss/50 bg-moss/15 px-3 py-2.5 text-sm text-ink">
                                <CheckCircle2 size={19} className="mt-0.5 flex-shrink-0 text-moss" />
                                <div className="min-w-0">
                                  <p className="text-[10px] font-semibold uppercase text-stone">Correct answer</p>
                                  <p className="mt-0.5 whitespace-pre-wrap break-words">{displayQuizAnswer(payload.correct_answer)}</p>
                                </div>
                              </div>
                            )}
                          </div>
                        )}

                        {payload.reference && <p className="mt-2 text-xs font-medium text-brass">{payload.reference}</p>}
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
