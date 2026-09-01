import { useEffect, useMemo, useState } from 'react';
import { BookMarked, CheckCircle2, Heart, Lightbulb, Loader2, Lock, MessageCircle, ScrollText, Send, Sun, UserPlus } from 'lucide-react';
import { ScrollEdge } from '../components/AncientMotifs';
import { Dove } from '../components/Dove';
import { PanelImageBackdrop } from '../components/PanelImageBackdrop';
import {
  completeSharedQuiz,
  fetchSharedQuiz,
  fetchSharedReading,
  saveSharedQuizAnswer,
  toggleSharedInsightReaction,
  type SharedReading,
  type SharedReadingInsight,
  type VerseInsightReactionType,
} from '../lib/queries';
import { cn } from '../lib/utils';

type ShareKind = 'reading' | 'quiz';

function publicGuestKey(scope: string) {
  const key = `full-circle-public:${scope}`;
  const existing = window.localStorage.getItem(key);
  if (existing) return existing;
  const value = typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  window.localStorage.setItem(key, value);
  return value;
}

type SharedVerse = {
  narrativeId: string;
  reference: string;
  text: string;
  meditation?: string;
};

function readingVerses(reading: SharedReading): SharedVerse[] {
  if (reading.weekly_highlights?.length) {
    return reading.weekly_highlights.map((highlight) => ({
      narrativeId: highlight.narrative_id,
      reference: highlight.reference,
      text: highlight.text,
    }));
  }

  const passages = reading.scripture_passages?.length
    ? reading.scripture_passages
    : [{
      reference: reading.scripture_reference,
      main_text: reading.main_text,
      highlighted_verses: reading.highlighted_verses || [],
      source_narrative_id: undefined,
    }];

  return passages.flatMap((passage) => {
    const verses = passage.highlighted_verses?.length
      ? passage.highlighted_verses
      : [{ reference: passage.reference, text: passage.main_text, meditation: '', source_narrative_id: undefined }];
    return verses.map((verse) => ({
      narrativeId: verse.source_narrative_id || passage.source_narrative_id || reading.id,
      reference: verse.reference || passage.reference,
      text: verse.text,
      meditation: verse.meditation,
    }));
  });
}

const PUBLIC_INSIGHT_REACTIONS: Array<{
  type: VerseInsightReactionType;
  label: string;
  icon: typeof Heart;
}> = [
  { type: 'heart', label: 'Love this insight', icon: Heart },
  { type: 'lightbulb', label: 'This gave me an idea', icon: Lightbulb },
];

function InsightThread({
  insight,
  pending,
  onReact,
}: {
  insight: SharedReadingInsight;
  pending: string | null;
  onReact: (insightId: string, reactionType: VerseInsightReactionType) => void;
}) {
  const authorName = insight.profiles?.display_name || 'Reader';
  return (
    <div className="rounded-xl border border-border bg-surface-2 p-3">
      <div className="flex items-start gap-2.5">
        <div className="h-8 w-8 flex-shrink-0 overflow-hidden rounded-full border border-border bg-peri-soft text-center text-xs font-bold leading-8 text-peri">
          {insight.profiles?.avatar_url
            ? <img src={insight.profiles.avatar_url} alt={authorName} className="h-full w-full object-cover" loading="lazy" />
            : authorName.charAt(0).toUpperCase()}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-bold text-ink">{authorName}</p>
          <p className="mt-1 whitespace-pre-wrap text-xs leading-relaxed text-stone">{insight.body}</p>
        </div>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-1.5" aria-label={`Reactions to ${authorName}'s insight`}>
        {PUBLIC_INSIGHT_REACTIONS.map(({ type, label, icon: ReactionIcon }) => {
          const reaction = insight.reactions?.[type] || { count: 0, reacted: false, actors: [] };
          const isPending = pending === `${insight.id}:${type}`;
          return (
            <button
              key={type}
              type="button"
              disabled={Boolean(pending)}
              onClick={() => onReact(insight.id, type)}
              className={cn(
                'inline-flex h-7 min-w-9 items-center justify-center gap-1 rounded-full border px-2 text-[10px] font-bold transition-colors disabled:opacity-60',
                reaction.reacted
                  ? type === 'heart'
                    ? 'border-coral/50 bg-coral-soft text-coral'
                    : 'border-gold/50 bg-gold-soft text-gold'
                  : 'border-border bg-surface text-stone hover:border-border-bright hover:text-ink',
                isPending && 'animate-pulse',
              )}
              title={label}
              aria-label={`${label}: ${reaction.count}`}
              aria-pressed={reaction.reacted}
            >
              <ReactionIcon size={13} fill={type === 'heart' && reaction.reacted ? 'currentColor' : 'none'} />
              <span>{reaction.count}</span>
            </button>
          );
        })}
      </div>

      {(() => {
        const actors = Array.from(new Map(
          PUBLIC_INSIGHT_REACTIONS.flatMap(({ type }) => insight.reactions?.[type]?.actors || [])
            .map((actor) => [actor.user_id, actor]),
        ).values()).slice(0, 5);
        if (!actors.length) return null;
        return (
          <div className="mt-2 flex items-center -space-x-2" aria-label={`${actors.length} camp members reacted`}>
            {actors.map((actor) => (
              <span key={actor.user_id} title={actor.display_name} className="inline-flex h-4 w-4 overflow-hidden rounded-full border border-surface-2 bg-peri-soft text-center text-[7px] font-bold leading-4 text-peri shadow-sm">
                {actor.avatar_url
                  ? <img src={actor.avatar_url} alt={actor.display_name} className="h-full w-full object-cover" loading="lazy" />
                  : actor.display_name.charAt(0).toUpperCase()}
              </span>
            ))}
          </div>
        );
      })()}

      {insight.comments?.length > 0 && (
        <div className="mt-3 space-y-2 border-l-2 border-peri/25 pl-3">
          <p className="flex items-center gap-1 text-[10px] font-bold uppercase text-stone">
            <MessageCircle size={11} /> {insight.comments.length} {insight.comments.length === 1 ? 'reply' : 'replies'}
          </p>
          {insight.comments.map((comment) => {
            const commenterName = comment.profile?.display_name || 'Reader';
            return (
              <div key={comment.id} className={cn('rounded-lg bg-surface/75 p-2', comment.parent_comment_id && 'ml-3')}>
                <div className="flex items-start gap-2">
                  <span className="inline-flex h-8 w-8 shrink-0 overflow-hidden rounded-full border border-border bg-peri-soft text-center text-[10px] font-bold leading-8 text-peri">
                    {comment.profile?.avatar_url
                      ? <img src={comment.profile.avatar_url} alt={commenterName} className="h-full w-full object-cover" loading="lazy" />
                      : commenterName.charAt(0).toUpperCase()}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-[11px] font-bold text-ink">{commenterName}</p>
                    <p className="mt-0.5 whitespace-pre-wrap text-xs leading-relaxed text-stone">{comment.body}</p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function SharedReadingView({
  reading,
  signupHref,
  pendingReaction,
  onReact,
}: {
  reading: SharedReading;
  signupHref: string;
  pendingReaction: string | null;
  onReact: (insightId: string, reactionType: VerseInsightReactionType) => void;
}) {
  const verses = readingVerses(reading);
  const isSundayReading = new Date(`${reading.narrative_date}T12:00:00`).getDay() === 0;
  return (
    <article className="today-reading-screen space-y-5">
      <section
        className="card relative overflow-hidden p-4 sm:p-5 animate-slide-up border-border backdrop-blur-sm"
        style={{ background: 'color-mix(in srgb, var(--color-navy-3) 42%, transparent)', backdropFilter: 'blur(18px) saturate(1.18)' }}
      >
        <PanelImageBackdrop image={reading.panel_images?.reading} opacityOverride={58} veilClassName="" />
        <div className="relative">
          {!isSundayReading && (
            <div className="eyebrow mb-2 flex items-center gap-2 text-brass">
              <BookMarked size={14} strokeWidth={1.5} />
              {reading.scripture_reference} · {reading.translation}
            </div>
          )}
          <h1 className="font-display text-2xl font-semibold leading-tight text-ink">{reading.title}</h1>
          <p className="mt-1.5 text-sm text-stone">{reading.theme}</p>
        </div>
      </section>

      {reading.verse_of_day && (
        <section className="card reading-glass-panel relative overflow-hidden border-brass/30 p-5 animate-slide-up" style={{ backdropFilter: 'blur(26px) saturate(1.22)' }}>
          <PanelImageBackdrop image={reading.panel_images?.scripture} opacityFallback={100} imageClassName="quote-glass-image" veilClassName="quote-picture-veil" modeFilter={false} textGradient={false} simple />
          <div className="relative z-10">
            <div className="mb-3 flex items-center gap-2"><Sun size={18} className="text-brass" strokeWidth={1.5} /><span className="eyebrow text-stone">{isSundayReading ? 'Verse of the Week' : 'Verse of the Day'}</span></div>
            <ScrollEdge position="top" className="mb-3 text-brass" />
            <p className="font-display text-xl leading-snug text-ink">&ldquo;{reading.verse_of_day}&rdquo;</p>
            <ScrollEdge position="bottom" className="mt-3 text-brass" />
          </div>
        </section>
      )}

      <section className="card reading-glass-panel relative isolate overflow-hidden border-border p-5 animate-slide-up" style={{ backdropFilter: 'blur(26px) saturate(1.22)' }}>
        <PanelImageBackdrop image={reading.panel_images?.scripture} opacityFallback={100} imageClassName="quote-glass-image" veilClassName="quote-picture-veil" modeFilter={false} textGradient={false} simple />
        <div className="relative z-10">
          <div className="mb-3 flex items-center gap-2"><ScrollText size={18} className="text-brass" strokeWidth={1.5} /><span className="eyebrow text-stone">Scripture</span></div>
          <ScrollEdge position="top" className="mb-4 text-brass" />
          <div className="space-y-4 sm:space-y-5">
            {verses.map((verse, index) => {
              const insights = (reading.insights || []).filter((insight) => (
                insight.narrative_id === verse.narrativeId && insight.verse_reference === verse.reference
              ));
              const verseNumber = verse.reference.match(/:(\d+)(?:\D|$)/)?.[1] || String(index + 1);
              return (
                <section key={`${verse.narrativeId}:${verse.reference}:${index}`} className={cn('rounded-xl border border-transparent px-2 py-2', insights.length > 0 && 'verse-highlight-insight')}>
                  <p className="text-[15px] leading-8 text-ink"><span className="mr-1.5 font-bold text-brass">{verseNumber}.</span>{verse.text}</p>
                  <p className="mt-2 text-[10px] font-bold uppercase text-brass">
                    {verse.reference}{verse.meditation?.trim() ? ' · Instructor annotation available' : ''}{insights.length ? ` · ${insights.length} reader insight${insights.length === 1 ? '' : 's'}` : ''}
                  </p>
                  {verse.meditation?.trim() && (
                    <div className="mt-3 border-l-2 border-brass/50 bg-brass-soft px-4 py-3">
                      <p className="text-[10px] font-bold uppercase text-brass">Instructor insight</p>
                      <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-ink">{verse.meditation}</p>
                    </div>
                  )}
                  <div className="mt-3 rounded-xl border border-border bg-surface/70 p-3">
                    <p className="text-[10px] font-bold uppercase text-stone">Reader insights</p>
                    {insights.length ? (
                      <div className="mt-3 space-y-3">
                        {insights.map((insight) => <InsightThread key={insight.id} insight={insight} pending={pendingReaction} onReact={onReact} />)}
                      </div>
                    ) : (
                      <p className="mt-2 text-xs text-stone">No reader insight has been shared on this verse yet.</p>
                    )}
                  </div>
                </section>
              );
            })}
          </div>
          <ScrollEdge position="bottom" className="mt-4 text-brass" />
        </div>
      </section>

      {!isSundayReading && reading.reflection_prompts?.length > 0 && (
        <section className="card border-border bg-surface p-5 animate-slide-up">
          <div className="mb-4 flex items-center gap-2">
            <Lightbulb size={18} className="text-moss" strokeWidth={1.5} />
            <span className="eyebrow text-stone">Reflection Prompts</span>
          </div>
          <ol className="space-y-2.5">
            {reading.reflection_prompts.map((prompt, index) => (
              <li key={`${index}:${prompt}`} className="flex items-start gap-3 text-sm leading-relaxed text-ink">
                <span className="mt-0.5 font-bold text-brass">{index + 1}.</span>
                <span>{prompt}</span>
              </li>
            ))}
          </ol>
        </section>
      )}

      <section className="rounded-xl border border-brass/25 bg-brass-soft p-4">
        <p className="font-display text-lg font-bold text-ink">Join the conversation.</p>
        <p className="mt-1 text-sm text-stone">You can react here now. Join Full Circle to share an insight, comment, or reply.</p>
        <a href={signupHref} className="btn-primary mt-3"><UserPlus size={16} /> Join Full Circle</a>
      </section>
    </article>
  );
}

export function PublicShareScreen({ kind, value }: { kind: ShareKind; value: string }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reading, setReading] = useState<SharedReading | null>(null);
  const [quiz, setQuiz] = useState<any>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [savingQuestion, setSavingQuestion] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [pendingReaction, setPendingReaction] = useState<string | null>(null);

  const signupHref = useMemo(() => `${window.location.pathname}?signup=1`, []);
  const readingGuestKey = useMemo(() => publicGuestKey(`reading:${value}`), [value]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    const load = kind === 'reading' ? fetchSharedReading(value, readingGuestKey) : fetchSharedQuiz(value);
    void load
      .then((data) => {
        if (cancelled) return;
        if (!data) throw new Error('This shared item is no longer available.');
        if (kind === 'reading') setReading(data as SharedReading);
        else setQuiz(data as NonNullable<Awaited<ReturnType<typeof fetchSharedQuiz>>>);
      })
      .catch((loadError: any) => { if (!cancelled) setError(loadError?.message || 'This shared item could not load.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [kind, readingGuestKey, value]);

  const reactToSharedInsight = async (insightId: string, reactionType: VerseInsightReactionType) => {
    if (!reading || pendingReaction) return;
    const key = `${insightId}:${reactionType}`;
    setPendingReaction(key);
    try {
      const reacted = await toggleSharedInsightReaction(insightId, readingGuestKey, reactionType);
      setReading((current) => current ? {
        ...current,
        insights: current.insights.map((insight) => {
          if (insight.id !== insightId) return insight;
          const previous = insight.reactions?.[reactionType] || { count: 0, reacted: false, actors: [] };
          return {
            ...insight,
            reactions: {
              ...insight.reactions,
              [reactionType]: {
                ...previous,
                reacted,
                count: Math.max(0, previous.count + (reacted ? 1 : -1)),
              },
            },
          };
        }),
      } : current);
    } catch (reactionError: any) {
      setError(reactionError?.message || 'Your reaction could not be saved.');
    } finally {
      setPendingReaction(null);
    }
  };

  const saveAnswer = async (questionId: string, answer: string) => {
    if (!quiz?.session?.id) return;
    setAnswers((current) => ({ ...current, [questionId]: answer }));
    setSavingQuestion(questionId);
    try {
      await saveSharedQuizAnswer(quiz.session.id, publicGuestKey(`quiz:${quiz.session.id}`), questionId, answer);
    } catch (saveError: any) {
      setError(saveError?.message || 'Your answer could not be saved.');
    } finally {
      setSavingQuestion(null);
    }
  };

  const submitQuiz = async () => {
    if (!quiz?.session?.id) return;
    try {
      await completeSharedQuiz(quiz.session.id, publicGuestKey(`quiz:${quiz.session.id}`));
      setSubmitted(true);
    } catch (submitError: any) {
      setError(submitError?.message || 'Your quiz could not be submitted.');
    }
  };

  return (
    <main className="min-h-screen bg-navy px-4 py-8 text-ink">
      <div className="mx-auto max-w-2xl space-y-5">
        <header className="flex items-center justify-between gap-3">
          <a href={window.location.pathname} className="flex items-center gap-2 text-peri">
            <Dove size={36} />
            <span className="font-display text-lg font-black">Full Circle</span>
          </a>
          <a href={signupHref} className="btn-secondary text-xs"><UserPlus size={14} /> Join</a>
        </header>

        {loading && <section className="card flex min-h-64 items-center justify-center gap-2 text-stone"><Loader2 size={18} className="animate-spin" /> Opening shared content...</section>}
        {!loading && error && <section className="card p-6 text-center"><Dove size={32} className="mx-auto text-brass" /><h1 className="mt-3 font-display text-xl font-bold text-ink">This link is unavailable</h1><p className="mt-2 text-sm text-stone">{error}</p><a href={signupHref} className="btn-primary mt-4">Join Full Circle</a></section>}

        {!loading && !error && kind === 'reading' && reading && (
          <SharedReadingView
            reading={reading}
            signupHref={signupHref}
            pendingReaction={pendingReaction}
            onReact={(insightId, reactionType) => void reactToSharedInsight(insightId, reactionType)}
          />
        )}

        {!loading && !error && kind === 'quiz' && quiz && (
          <article className="space-y-4">
            <section className="card p-5 sm:p-7">
              <p className="eyebrow text-brass">Shared weekly quiz</p>
              <h1 className="mt-2 font-display text-3xl font-black text-ink">{quiz.session.title}</h1>
              <p className="mt-2 text-sm text-stone">Answer as a guest, then join Full Circle to see your result.</p>
            </section>
            {quiz.session.status !== 'live' ? (
              <section className="card p-6 text-center"><Lock size={28} className="mx-auto text-brass" /><h2 className="mt-3 font-display text-xl font-bold text-ink">Quiz window closed</h2><p className="mt-2 text-sm text-stone">Join Full Circle to take future quizzes and receive results.</p><a href={signupHref} className="btn-primary mt-4">Join Full Circle</a></section>
            ) : submitted ? (
              <section className="card p-6 text-center"><CheckCircle2 size={32} className="mx-auto text-moss" /><h2 className="mt-3 font-display text-xl font-bold text-ink">Your answers are in.</h2><p className="mt-2 text-sm text-stone">Create your Full Circle account to see your result when it is released.</p><a href={signupHref} className="btn-primary mt-4">Join to see results</a></section>
            ) : (
              <>
                {quiz.questions.map((question: any, index: number) => {
                  const payload = question.question_payload || {};
                  const options = Array.isArray(payload.options) ? payload.options : [];
                  const currentAnswer = answers[question.id] || '';
                  return <section key={question.id} className="card p-5"><p className="text-xs font-bold text-brass">Question {index + 1}</p><p className="mt-2 text-base font-semibold leading-relaxed text-ink">{payload.question}</p>{options.length ? <div className="mt-4 space-y-2">{options.map((option: string, optionIndex: number) => <label key={`${option}-${optionIndex}`} className={cn('flex cursor-pointer items-center gap-2 rounded-lg border p-3 text-sm', currentAnswer === option ? 'border-brass bg-brass-soft text-ink' : 'border-border bg-surface-2 text-stone')}><input type="radio" name={question.id} value={option} checked={currentAnswer === option} onChange={() => void saveAnswer(question.id, option)} /><span>{option}</span></label>)}</div> : <input className="input-field mt-4" value={currentAnswer} onChange={(event) => setAnswers((current) => ({ ...current, [question.id]: event.target.value }))} onBlur={(event) => { if (event.target.value.trim()) void saveAnswer(question.id, event.target.value.trim()); }} placeholder="Your answer" />}{savingQuestion === question.id && <p className="mt-2 text-[10px] text-stone">Saving...</p>}</section>;
                })}
                <button type="button" className="btn-primary w-full justify-center" disabled={Object.keys(answers).length < quiz.questions.length} onClick={() => void submitQuiz()}><Send size={16} /> Submit and join to see results</button>
              </>
            )}
          </article>
        )}
      </div>
    </main>
  );
}
