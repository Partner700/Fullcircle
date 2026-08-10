import { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '../../context/AuthContext';
import { SectionHeader, EmptyState } from '../../components/AppShell';
import { Dove } from '../../components/Dove';
import { ScrollEdge, SealBullet } from '../../components/AncientMotifs';
import { PanelImageBackdrop } from '../../components/PanelImageBackdrop';
import {
  fetchLatestQuizSession, fetchPlayableQuestionsForSession, fetchQuizAttempt, fetchResponsesForAttempt,
  fetchNarratives, fetchRelicInventory, resetQuizAttemptWithLazarus, startQuizAttempt,
  saveQuizResponse, consumeQuizQuestionRelic, completeQuizAttempt, forfeitQuizAttempt,
  fetchPanelImageSetting, fetchQuizWaitingMessages, sendQuizWaitingMessage,
} from '../../lib/queries';
import { supabase } from '../../lib/supabase';
import { QUIZ_LIVE_DURATION_MINUTES, RELIC_SLUGS } from '../../lib/constants';
import { formatCountdown, formatDate, formatDenarii, getAppDateTimeMs, getTodayISODate, cn } from '../../lib/utils';
import { setScenarioSound, playSoundEffect } from '../../lib/soundscape';
import type { QuizSession, GeneratedQuestion, QuizAttempt, QuestionResponse, DailyNarrative, PanelImageSetting } from '../../lib/types';
import {
  FileQuestion, Clock, CheckCircle2, AlertTriangle, Loader2, ChevronLeft, ChevronRight,
  Trophy, Zap, Lock, Ban, BookOpen, Swords, RefreshCw, Lightbulb, Wand2,
  SkipForward, Volume2, Eye, Sparkles,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

type Phase = 'not_scheduled' | 'scheduled' | 'countdown' | 'live' | 'closed';

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
  return getAppDateTimeMs(sessionDate, 15, 0);
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
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState(Date.now());
  const [inQuiz, setInQuiz] = useState(false);
  const [lazarusCount, setLazarusCount] = useState(0);
  const [usingLazarus, setUsingLazarus] = useState(false);
  const [lazarusMode, setLazarusMode] = useState(false);
  const [quizImage, setQuizImage] = useState<PanelImageSetting | null>(null);
  const [readingArchive, setReadingArchive] = useState<(DailyNarrative & { meditation_text?: string | null; best_verse?: string | null })[]>([]);
  const [reviewVerseIndex, setReviewVerseIndex] = useState(0);

  useEffect(() => {
    void setScenarioSound(inQuiz ? 'sound_quiz_start' : 'sound_quiz_waiting');
    return () => { void setScenarioSound(null); };
  }, [inQuiz]);

  const load = useCallback(async () => {
    if (!profile) { setLoading(false); return; }
    setLoading(true);
    try {
    const sess = await fetchLatestQuizSession();
    setSession(sess);
    if (sess) {
      const [qs, att, relics, image] = await Promise.allSettled([
        fetchPlayableQuestionsForSession(sess.id),
        fetchQuizAttempt(profile.id, sess.id),
        fetchRelicInventory(profile.id),
        fetchPanelImageSetting('quiz'),
      ]);
      setQuestions(qs.status === 'fulfilled' ? qs.value : []);
      setAttempt(att.status === 'fulfilled' ? att.value : null);
      setQuizImage(image.status === 'fulfilled' ? image.value : null);
      if (relics.status === 'fulfilled') {
        const lazarus = relics.value.find((item) => item.relic_types?.slug === RELIC_SLUGS.LAZARUS_COIN);
        setLazarusCount(lazarus?.quantity || 0);
      }
      if (att.status === 'fulfilled' && att.value) {
        try {
          const resps = await fetchResponsesForAttempt(att.value.id);
          setResponses(resps);
        } catch { setResponses([]); }
      }
    }
    try {
      const narrs = await fetchNarratives(90);
      const { data: records } = await supabase.from('daily_records').select('record_date,meditation_text,best_verse').eq('user_id', profile.id);
      const recordsByDate = new Map((records || []).map((record: any) => [record.record_date, record]));
      setReadingArchive(narrs.filter((item) => item.narrative_date < getTodayISODate()).map((item) => ({ ...item, ...(recordsByDate.get(item.narrative_date) || {}) })));
    } catch { setReadingArchive([]); }
    } catch (e) { console.error('Quiz load error:', e); }
    setLoading(false);
  }, [profile]);

  useEffect(() => { load(); }, [load]);

  // Tick every second
  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-16 animate-fade-in">
        <Dove size={56} className="text-brass mb-4" />
        <p className="eyebrow text-stone">Loading</p>
        <p className="text-sm text-stone mt-1">Preparing the quiz chamber…</p>
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
  if (now < countdownOpens) phase = 'scheduled';
  else if (now < liveOpens) phase = 'countdown';
  else if (now < liveCloses) phase = 'live';
  else phase = 'closed';

  const startStandardAttempt = async () => {
    if (questions.length === 0) {
      alert('This quiz has no approved questions yet. Please wait for the instructor.');
      return;
    }
    try {
      const activeAttempt = await startQuizAttempt(session.id);
      setAttempt(activeAttempt);
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
      const reopened = await resetQuizAttemptWithLazarus(profile.id, session.id);
      setAttempt(reopened);
      setResponses([]);
      setLazarusCount((count) => Math.max(0, count - 1));
      setLazarusMode(true);
      setInQuiz(true);
    } catch (e: any) {
      alert(e.message || 'The Lazarus Coin could not reopen this quiz.');
    }
    setUsingLazarus(false);
  };

  const resultsReleaseAt = localQuizResultsRelease(session.session_date);

  // If attempt is forfeited or submitted, show the correct terminal view.
  if (attempt?.status === 'forfeited') {
    return <div className="space-y-5 max-w-2xl mx-auto"><QuizReadingReview archive={readingArchive} verseIndex={reviewVerseIndex} onNext={() => setReviewVerseIndex((index) => index + 1)} /><ForfeitedView attempt={attempt} image={quizImage} canUseLazarus={canUseLazarus} lazarusCount={lazarusCount} usingLazarus={usingLazarus} onUseLazarus={startWithLazarus} /></div>;
  }
  if (attempt && (attempt.status === 'submitted' || attempt.status === 'timed_out')) {
    if (session.quiz_type === 'saturday' && now < resultsReleaseAt) {
      return <div className="space-y-5 max-w-2xl mx-auto"><QuizReadingReview archive={readingArchive} verseIndex={reviewVerseIndex} onNext={() => setReviewVerseIndex((index) => index + 1)} /><SubmittedView releaseAt={resultsReleaseAt} image={quizImage} canUseLazarus={canUseLazarus} lazarusCount={lazarusCount} usingLazarus={usingLazarus} onUseLazarus={startWithLazarus} /></div>;
    }
    return <div className="space-y-5 max-w-2xl mx-auto"><QuizReadingReview archive={readingArchive} verseIndex={reviewVerseIndex} onNext={() => setReviewVerseIndex((index) => index + 1)} /><ResultsView attempt={attempt} image={quizImage} questions={questions} responses={responses} canUseLazarus={canUseLazarus} lazarusCount={lazarusCount} usingLazarus={usingLazarus} onUseLazarus={startWithLazarus} /></div>;
  }

  // In quiz
  if (inQuiz && (phase === 'live' || lazarusMode || attemptLazarusActive) && attempt?.status === 'in_progress') {
    return (
      <QuizPlay
        questions={questions}
        initialResponses={responses}
        attempt={attempt}
        userId={profile!.id}
        liveCloses={phase === 'live' && !lazarusMode ? liveCloses : lazarusDeadline}
        onSubmit={() => { setInQuiz(false); load(); onQuizSubmitted(); }}
        onForfeit={() => { setInQuiz(false); load(); }}
      />
    );
  }

  // Pre-quiz views
  const timeToCountdown = countdownOpens - now;
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
        </div>
      </div>

      <QuizReadingReview archive={readingArchive} verseIndex={reviewVerseIndex} onNext={() => setReviewVerseIndex((index) => index + 1)} />

      {/* Phase-specific content */}
      {phase === 'scheduled' && (
        <WaitingRoom
          eyebrow="Not Yet Open"
          title="Quiz Not Yet Open"
          description="The waiting room opens in:"
          countdownMs={timeToCountdown}
          footnote={`Waiting room opens at ${new Date(session.countdown_opens_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })} · Live at ${new Date(session.live_opens_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`}
          progressLabel="Time to waiting room"
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
          <p className="text-xs text-roman mt-3 flex items-center justify-center gap-1">
            <AlertTriangle size={12} /> Exiting the app during the quiz = instant forfeiture
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
          <RuleItem icon={AlertTriangle} text="App-exit = instant forfeiture, zero figs, broken streak" />
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

function QuizPlay({ questions, initialResponses, attempt, userId, liveCloses, onSubmit, onForfeit }: {
  questions: GeneratedQuestion[];
  initialResponses: QuestionResponse[];
  attempt: QuizAttempt;
  userId: string;
  liveCloses: number;
  onSubmit: () => void;
  onForfeit: () => void;
}) {
  const [currentIdx, setCurrentIdx] = useState(0);
  const [localResponses, setLocalResponses] = useState<Map<string, any>>(
    () => new Map(initialResponses.map((response) => [response.question_id, response.answer])),
  );
  const [selectedAnswer, setSelectedAnswer] = useState<any>(null);
  const [showFeedback, setShowFeedback] = useState(false);
  const [timeLeft, setTimeLeft] = useState(Math.max(0, Math.floor((liveCloses - Date.now()) / 1000)));
  const [submitting, setSubmitting] = useState(false);
  const [relicInventory, setRelicInventory] = useState<Record<string, number>>({});
  const [usingGoliath, setUsingGoliath] = useState(false);
  const [usingQuestionRelic, setUsingQuestionRelic] = useState<string | null>(null);
  const [relicNotice, setRelicNotice] = useState<string | null>(null);
  const [eliminatedOptions, setEliminatedOptions] = useState<string[]>([]);
  const forfeitedRef = useRef(false);
  const submissionStartedRef = useRef(false);

  const handleSubmit = useCallback(async (status: 'submitted' | 'timed_out' = 'submitted', forcePerfect = false) => {
    if (submissionStartedRef.current) return;
    submissionStartedRef.current = true;
    setSubmitting(true);
    try {
      await completeQuizAttempt(attempt.id, status, forcePerfect);
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

  // Timer
  useEffect(() => {
    const interval = setInterval(() => {
      const remaining = Math.floor((liveCloses - Date.now()) / 1000);
      setTimeLeft(Math.max(0, remaining));
      if (remaining <= 0) {
        handleSubmit('timed_out');
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [handleSubmit, liveCloses]);

  // App-exit forfeiture detection (visibility change + blur)
  useEffect(() => {
    const handleVisibilityChange = async () => {
      if (document.hidden && !forfeitedRef.current) {
        forfeitedRef.current = true;
        await forfeitQuizAttempt(attempt.id);
        onForfeit();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('blur', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('blur', handleVisibilityChange);
    };
  }, [attempt.id, onForfeit]);

  if (questions.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 animate-fade-in">
        <Dove size={48} className="text-brass mb-4" />
        <p className="text-sm text-stone">Loading questions…</p>
      </div>
    );
  }

  const q = questions[currentIdx];
  const payload = q.question_payload;
  const hasResponse = localResponses.has(q.id);
  const isLastQuestion = currentIdx === questions.length - 1;

  const saveResponse = async (answer: any) => {
    const result = await saveQuizResponse(attempt.id, q.id, answer);
    if (!result.accepted) {
      setRelicNotice(result.warning || 'That answer was not saved.');
      return false;
    }
    setLocalResponses((previous) => new Map(previous).set(q.id, answer));
    return true;
  };

  const handleAnswer = async (answer: any) => {
    if (showFeedback) return;
    try {
      const accepted = await saveResponse(answer);
      if (!accepted) return;
      setSelectedAnswer(answer);
      setShowFeedback(true);
      setRelicNotice('Answer saved. Results remain sealed until the quiz is released.');
    } catch (error: any) {
      setRelicNotice(error.message || 'Your answer could not be saved. Please try again.');
    }
  };

  const goNext = () => {
    if (currentIdx < questions.length - 1) {
      setCurrentIdx(currentIdx + 1);
      setSelectedAnswer(localResponses.get(questions[currentIdx + 1].id) ?? null);
      setShowFeedback(localResponses.has(questions[currentIdx + 1].id));
      setRelicNotice(null);
      setEliminatedOptions([]);
    }
  };

  const goBack = () => {
    if (currentIdx > 0) {
      setCurrentIdx(currentIdx - 1);
      setSelectedAnswer(localResponses.get(questions[currentIdx - 1].id) ?? null);
      setShowFeedback(true);
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
      const result = await consumeQuizQuestionRelic(attempt.id, q.id, slug);
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
      <div className="card p-5 relative animate-slide-up">
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

        {/* Scriptorium */}
        {payload.type === 'scriptorium' && payload.blanked_text && (
          <div className="mb-4">
            <div className="p-4 rounded-lg bg-surface-2 font-serif text-ink text-center text-lg tracking-wider mb-3 border border-border">
              {payload.blanked_text}
            </div>
            {!showFeedback ? (
              <div>
                <textarea
                  className="w-full min-h-[80px] p-3 rounded-lg bg-surface-2 border border-border text-ink font-serif focus:outline-none focus:border-brass transition-colors"
                  placeholder="Type the verse from memory..."
                  autoFocus
                  value={selectedAnswer || ''}
                  onChange={(e) => setSelectedAnswer(e.target.value)}
                />
                <button
                  onClick={() => selectedAnswer?.trim() && handleAnswer(selectedAnswer.trim())}
                  disabled={!selectedAnswer?.trim()}
                  className="btn-primary mt-2 w-full disabled:opacity-50"
                >
                  Save Answer
                </button>
              </div>
            ) : null}
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
            {!showFeedback ? (
              <div>
                <textarea
                  className="w-full min-h-[80px] p-3 rounded-lg bg-surface-2 border border-border text-ink font-serif focus:outline-none focus:border-brass transition-colors"
                  placeholder="Type the exact answer..."
                  autoFocus
                  value={selectedAnswer || ''}
                  onChange={(e) => setSelectedAnswer(e.target.value)}
                />
                <button
                  onClick={() => selectedAnswer?.trim() && handleAnswer(selectedAnswer.trim())}
                  disabled={!selectedAnswer?.trim()}
                  className="btn-primary mt-2 w-full disabled:opacity-50"
                >
                  Save Answer
                </button>
              </div>
            ) : null}
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
                  onClick={() => !showFeedback && handleAnswer(opt)}
                  disabled={showFeedback}
                  className={cn(
                    'btn-ghost w-full text-left justify-start',
                    !showFeedback && 'hover:border-brass hover:bg-brass/5',
                    showFeedback && isSelected && 'border-brass bg-brass/10 text-ink',
                    showFeedback && !isSelected && 'opacity-50',
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
                    if (showFeedback) return;
                    const newOrder = userOrder.includes(item)
                      ? userOrder.filter((x) => x !== item)
                      : [...userOrder, item];
                    setSelectedAnswer(newOrder);
                  }}
                  className={cn(
                    'btn-ghost w-full text-left justify-between',
                    !showFeedback && userOrder.includes(item) && 'border-brass bg-brass/5',
                    !showFeedback && !userOrder.includes(item) && 'hover:border-brass',
                  )}
                >
                  <span>{item}</span>
                  {userOrder.includes(item) && <span className="font-display font-semibold text-brass">{idx + 1}</span>}
                </button>
              );
            })}
            {!showFeedback && (
              <button
                type="button"
                className="btn-primary mt-3 w-full disabled:opacity-50"
                disabled={!Array.isArray(selectedAnswer) || selectedAnswer.length !== payload.items.length}
                onClick={() => void handleAnswer((selectedAnswer as string[]).join('|'))}
              >
                Save Order
              </button>
            )}
          </div>
        )}

        {/* Feedback + navigation */}
        {showFeedback && (
          <div className="mt-4 animate-slide-up">
            <div className="p-3 rounded-lg flex items-center gap-2 bg-surface-2 text-stone border border-border">
              <CheckCircle2 size={18} />
              <span className="text-sm font-medium">Answer saved.</span>
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

      {/* Warning */}
      <div className="text-center text-xs text-roman flex items-center justify-center gap-1">
        <AlertTriangle size={12} /> Do not leave this page — exiting = forfeiture
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
            Your answers are safely recorded. Your question results and the updated Quiz Board will be released together at 3:00 PM.
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
          <h2 className="font-display text-xl font-semibold text-roman mb-2">Quiz Forfeited</h2>
          <p className="text-sm text-stone mb-4">
            You left the quiz screen while it was live. The forfeiture is irreversible.
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

function ResultsView({ attempt, image, questions, responses, canUseLazarus, lazarusCount, usingLazarus, onUseLazarus }: {
  attempt: QuizAttempt;
  image: PanelImageSetting | null;
  questions: GeneratedQuestion[];
  responses: QuestionResponse[];
  canUseLazarus: boolean;
  lazarusCount: number;
  usingLazarus: boolean;
  onUseLazarus: () => void;
}) {
  const correctByQuestion = questions.map((q) => {
    const resp = responses.find((r) => r.question_id === q.id);
    const expected = q.question_payload.correct_answer;
    if (!resp || expected == null) return false;
    if (['standard_text', 'scriptorium'].includes(q.question_payload.type)) {
      return String(resp.answer).trim() === String(expected).trim();
    }
    return String(resp.answer).trim().toLowerCase() === String(expected).trim().toLowerCase();
  });
  const maxFigs = questions.reduce((total, question) => total + (
    question.difficulty_tag === 'hard' ? 5 : question.difficulty_tag === 'moderate' ? 3 : 1
  ), 0);
  const figs = Number(attempt.talents_scored) || 0;
  const perfect = maxFigs > 0 && figs === maxFigs;
  const denarii = perfect ? 6000 : figs > 0 ? 1000 : 0;

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
            {attempt.status === 'timed_out' ? 'Time expired' : 'Submitted'} · {figs}/{maxFigs} figs
          </p>

          <div className="grid grid-cols-2 gap-3 mb-4">
            <div className="rounded-lg border border-border bg-surface-2 p-3">
              <p className="text-xs text-stone uppercase tracking-wider">Figs</p>
              <p className="font-display text-xl font-semibold text-brass">{figs}/{maxFigs}</p>
            </div>
            <div className="rounded-lg border border-border bg-surface-2 p-3">
              <p className="text-xs text-stone uppercase tracking-wider">Denarii</p>
              <p className="font-display text-xl font-semibold text-brass">{formatDenarii(denarii)}</p>
            </div>
          </div>

          <p className="text-xs text-stone mb-3">
            {perfect ? 'Perfect score reward: 1 talent' : figs > 0 ? 'Imperfect score reward: 1,000 denarii' : 'No reward was earned this time'}
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
    </div>
  );
}
