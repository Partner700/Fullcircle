import { useEffect, useMemo, useState } from 'react';
import { BookMarked, Bookmark, CheckCircle2, ChevronLeft, ChevronRight, Flame, Heart, Lightbulb, Loader2, Lock, MessageCircle, Quote, ScrollText, Send, Sun, UserPlus, X } from 'lucide-react';
import { ScrollEdge } from '../components/AncientMotifs';
import { Dove } from '../components/Dove';
import { PanelImageBackdrop } from '../components/PanelImageBackdrop';
import { VallumAvatarBadge } from '../components/VallumAvatarBadge';
import {
  completeSharedQuiz,
  fetchSharedQuiz,
  fetchSharedDailyGame,
  fetchSharedReading,
  fetchPublicDailyQuotes,
  saveSharedQuizAnswer,
  toggleSharedInsightReaction,
  addSharedInsight,
  type SharedReading,
  type SharedReadingInsight,
  type VerseInsightReactionType,
} from '../lib/queries';
import { cn } from '../lib/utils';
import type { DailyQuoteFeedItem, PanelImageSetting } from '../lib/types';

type ShareKind = 'reading' | 'quiz' | 'game';

const memoryGuestKeys = new Map<string, string>();

function publicGuestKey(scope: string) {
  const key = `full-circle-public:${scope}`;
  let existing = memoryGuestKeys.get(key) || null;
  try {
    existing = window.localStorage.getItem(key) || existing;
  } catch {
    // Some mobile browsers disable storage while still allowing the shared page.
  }
  if (existing) return existing;
  const value = typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  memoryGuestKeys.set(key, value);
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // The in-memory key still keeps this visit playable.
  }
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
  signupHref,
  pending,
  onReact,
}: {
  insight: SharedReadingInsight;
  signupHref: string;
  pending: string | null;
  onReact: (insightId: string, reactionType: VerseInsightReactionType) => void;
}) {
  const authorName = insight.profiles?.display_name || 'Reader';
  return (
    <div className="rounded-xl border border-border bg-surface-2 p-3">
      <div className="flex items-start gap-2.5">
        <span className="relative flex h-8 w-8 flex-shrink-0 items-center justify-center text-xs font-bold text-peri"><span className="flex h-full w-full items-center justify-center overflow-hidden rounded-full border border-border bg-peri-soft">{insight.profiles?.avatar_url ? <img src={insight.profiles.avatar_url} alt={authorName} className="h-full w-full object-cover" loading="lazy" /> : authorName.charAt(0).toUpperCase()}</span><VallumAvatarBadge userId={insight.user_id} size="sm" /></span>
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
              <span key={actor.user_id} title={actor.display_name} className="relative inline-flex h-4 w-4 items-center justify-center text-[7px] font-bold text-peri"><span className="inline-flex h-full w-full items-center justify-center overflow-hidden rounded-full border border-surface-2 bg-peri-soft shadow-sm">{actor.is_guest ? <Dove size={14} /> : actor.avatar_url ? <img src={actor.avatar_url} alt={actor.display_name} className="h-full w-full object-cover" loading="lazy" /> : actor.display_name.charAt(0).toUpperCase()}</span><VallumAvatarBadge userId={actor.is_guest ? null : actor.user_id} size="xs" /></span>
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
                  <span className="relative inline-flex h-8 w-8 shrink-0 items-center justify-center text-[10px] font-bold text-peri"><span className="inline-flex h-full w-full items-center justify-center overflow-hidden rounded-full border border-border bg-peri-soft">{comment.profile?.avatar_url ? <img src={comment.profile.avatar_url} alt={commenterName} className="h-full w-full object-cover" loading="lazy" /> : commenterName.charAt(0).toUpperCase()}</span><VallumAvatarBadge userId={comment.user_id} size="sm" /></span>
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
      <a href={signupHref} className="mt-2 inline-flex items-center gap-1 text-[11px] font-semibold text-peri">
        <MessageCircle size={13} /> Reply
      </a>
    </div>
  );
}

function PublicQuoteCarousel({ quotes, signupHref, image }: { quotes: DailyQuoteFeedItem[]; signupHref: string; image?: PanelImageSetting | null }) {
  const slides = [...quotes.map((quote) => ({ kind: 'quote' as const, quote })), { kind: 'join' as const }];
  const [index, setIndex] = useState(0);
  const [joinOpen, setJoinOpen] = useState(false);

  useEffect(() => {
    if (slides.length < 2 || joinOpen) return;
    const timer = window.setInterval(() => setIndex((current) => (current + 1) % slides.length), 6500);
    return () => window.clearInterval(timer);
  }, [joinOpen, slides.length]);

  return (
    <section className="space-y-2" aria-label="Quotes from Full Circle meditations">
      <div className="quote-glass-panel relative min-h-[16rem] overflow-hidden rounded-2xl border border-border">
        <PanelImageBackdrop image={image || null} opacityOverride={100} imageClassName="quote-glass-image" veilClassName="quote-picture-veil" modeFilter={false} textGradient={false} simple />
        <div className="panel-veil-layer quote-glass-tint pointer-events-none absolute inset-0" aria-hidden="true" />
        <div className="relative z-10 flex transition-transform duration-500 ease-out" style={{ transform: `translateX(-${index * 100}%)` }}>
          {slides.map((slide, slideIndex) => (
            <article key={slide.kind === 'quote' ? `${slide.quote.user_id}:${slide.quote.record_date}` : 'join'} className="flex min-h-[16rem] min-w-full flex-col justify-between p-5">
              <div>
                <p className="eyebrow flex items-center gap-1.5 text-brass"><Quote size={14} /> Quotes From Daily Meditations</p>
                {slide.kind === 'quote' ? (
                  <p className="mt-5 font-display text-2xl font-medium italic leading-snug text-ink">&ldquo;{slide.quote.daily_quote}&rdquo;<button type="button" disabled={!slide.quote.has_public_meditation} className="ml-2 inline-flex align-baseline text-gold disabled:cursor-default disabled:text-stone-dim disabled:opacity-45" aria-label={slide.quote.has_public_meditation ? 'Join to read this meditation' : 'This meditation is private'} title={slide.quote.has_public_meditation ? 'Join to read this meditation' : 'This meditation is private'} onClick={() => { if (slide.quote.has_public_meditation) setJoinOpen(true); }}><Bookmark size={16} fill={slide.quote.has_public_meditation ? 'currentColor' : 'none'} /></button></p>
                ) : (
                  <p className="mt-5 font-display text-2xl font-medium italic leading-snug text-ink">&ldquo;Come and read, reflect, and grow with us.&rdquo;</p>
                )}
              </div>
              <div className="mt-6 flex items-center gap-3">
                {slide.kind === 'quote' ? (
                  <>
                    <span className="relative flex h-11 w-11 items-center justify-center"><span className="flex h-full w-full items-center justify-center overflow-hidden rounded-full border border-border-bright bg-surface-2">{slide.quote.avatar_url ? <img src={slide.quote.avatar_url} alt={slide.quote.display_name} className="h-full w-full object-cover" loading="lazy" /> : <span className="flex h-full w-full items-center justify-center font-bold text-peri">{slide.quote.display_name.charAt(0)}</span>}</span><VallumAvatarBadge userId={slide.quote.user_id} size="sm" /></span>
                    <div><p className="text-sm font-extrabold text-ink">{slide.quote.display_name}</p><p className="mt-0.5 flex items-center gap-1 text-xs font-bold text-stone"><Flame size={12} className="text-gold" /> {slide.quote.current_streak || 0}</p></div>
                  </>
                ) : (
                  <><span className="flex h-11 w-11 items-center justify-center rounded-full border border-border-bright bg-surface-2"><Dove size={36} /></span><div><p className="text-sm font-extrabold text-ink">Full Circle</p><a href={signupHref} className="mt-1 inline-flex items-center gap-1 text-xs font-bold text-peri"><UserPlus size={13} /> Join the app</a></div></>
                )}
              </div>
            </article>
          ))}
        </div>
        {slides.length > 1 && <><button type="button" className="absolute left-2 top-1/2 z-20 -translate-y-1/2 rounded-full border border-border bg-surface/80 p-1.5 text-ink backdrop-blur" onClick={() => setIndex((current) => (current - 1 + slides.length) % slides.length)} aria-label="Previous quote"><ChevronLeft size={16} /></button><button type="button" className="absolute right-2 top-1/2 z-20 -translate-y-1/2 rounded-full border border-border bg-surface/80 p-1.5 text-ink backdrop-blur" onClick={() => setIndex((current) => (current + 1) % slides.length)} aria-label="Next quote"><ChevronRight size={16} /></button></>}
      </div>
      <div className="flex justify-center gap-1.5">{slides.map((_, dot) => <button key={dot} type="button" className={cn('h-1.5 rounded-full transition-all', dot === index ? 'w-5 bg-brass' : 'w-1.5 bg-border-bright')} onClick={() => setIndex(dot)} aria-label={`Open quote ${dot + 1}`} />)}</div>
      {joinOpen && <div className="fixed inset-0 z-[190] flex items-center justify-center bg-black/55 p-4" onMouseDown={() => setJoinOpen(false)} role="dialog" aria-modal="true"><div className="card max-w-sm p-5 text-center shadow-2xl" onMouseDown={(event) => event.stopPropagation()}><button type="button" className="btn-icon ml-auto" onClick={() => setJoinOpen(false)} aria-label="Close"><X size={16} /></button><Dove size={42} className="mx-auto" /><h2 className="mt-3 font-display text-xl font-semibold text-ink">Join Full Circle to read meditations</h2><p className="mt-2 text-sm text-stone">Join Full Circle to share an insight, comment, or reply. Full meditations are reserved for camp members.</p><a href={signupHref} className="btn-primary mt-4"><UserPlus size={15} /> Join Full Circle</a></div></div>}
    </section>
  );
}

function SharedReadingView({
  reading,
  quotes,
  signupHref,
  pendingReaction,
  onReact,
  onAddInsight,
}: {
  reading: SharedReading;
  quotes: DailyQuoteFeedItem[];
  signupHref: string;
  pendingReaction: string | null;
  onReact: (insightId: string, reactionType: VerseInsightReactionType) => void;
  onAddInsight: (narrativeId: string, verseReference: string, body: string) => Promise<void>;
}) {
  const verses = readingVerses(reading);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [savingVerse, setSavingVerse] = useState<string | null>(null);
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
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-[10px] font-bold uppercase text-stone">Reader insights</p>
                      <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-stone"><Lightbulb size={12} /> Add insight</span>
                    </div>
                    <div className="mt-2 flex gap-2">
                      <textarea
                        value={drafts[verse.reference] || ''}
                        onChange={(event) => setDrafts((current) => ({ ...current, [verse.reference]: event.target.value }))}
                        className="input-field min-h-16 flex-1 resize-y text-xs"
                        placeholder="Share what this verse gave you..."
                        maxLength={3000}
                      />
                      <button
                        type="button"
                        className="btn-primary self-end px-3 text-xs"
                        disabled={!drafts[verse.reference]?.trim() || savingVerse === verse.reference}
                        onClick={() => {
                          const body = drafts[verse.reference]?.trim();
                          if (!body) return;
                          setSavingVerse(verse.reference);
                          void onAddInsight(verse.narrativeId, verse.reference, body)
                            .then(() => setDrafts((current) => ({ ...current, [verse.reference]: '' })))
                            .finally(() => setSavingVerse(null));
                        }}
                      >
                        {savingVerse === verse.reference ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
                        <span className="sr-only">Share insight</span>
                      </button>
                    </div>
                    {insights.length ? (
                      <div className="mt-3 space-y-3">
                        {insights.map((insight) => <InsightThread key={insight.id} insight={insight} signupHref={signupHref} pending={pendingReaction} onReact={onReact} />)}
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

      <PublicQuoteCarousel quotes={quotes} signupHref={signupHref} image={reading.panel_images?.reading} />
    </article>
  );
}

function SharedGameView({ game, signupHref }: { game: { title: string; questions: Array<{ id: string; question_text: string; options: string[] }> }; signupHref: string }) {
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [submitted, setSubmitted] = useState(false);
  return (
    <article className="space-y-4">
      <section className="card p-5 sm:p-7"><p className="eyebrow text-gold">Level 1 · Daily Trivia</p><h1 className="mt-2 font-display text-3xl font-black text-ink">{game.title}</h1><p className="mt-2 text-sm text-stone">Play Level 1 here. Join Full Circle to unlock the remaining levels and keep your progress.</p></section>
      {game.questions.length === 0 ? <section className="card p-6 text-center text-sm text-stone">Level 1 is not open yet.</section> : submitted ? (
        <section className="card p-6 text-center"><CheckCircle2 size={32} className="mx-auto text-moss" /><h2 className="mt-3 font-display text-xl font-bold text-ink">Level 1 complete.</h2><p className="mt-2 text-sm text-stone">Join Full Circle to see your result and continue to the next level.</p><a href={signupHref} className="btn-primary mt-4">Join Full Circle</a></section>
      ) : <>
        {game.questions.map((question, index) => <section key={question.id} className="card p-5"><p className="text-xs font-bold text-gold">Question {index + 1}</p><p className="mt-2 text-base font-semibold leading-relaxed text-ink">{question.question_text}</p>{question.options?.length ? <div className="mt-4 space-y-2">{question.options.map((option) => <label key={option} className={cn('flex cursor-pointer items-center gap-2 rounded-lg border p-3 text-sm', answers[question.id] === option ? 'border-gold bg-gold-soft text-ink' : 'border-border bg-surface-2 text-stone')}><input type="radio" name={question.id} checked={answers[question.id] === option} onChange={() => setAnswers((current) => ({ ...current, [question.id]: option }))} /><span>{option}</span></label>)}</div> : <input className="input-field mt-4" value={answers[question.id] || ''} onChange={(event) => setAnswers((current) => ({ ...current, [question.id]: event.target.value }))} placeholder="Your answer" />}</section>)}
        <button type="button" className="btn-primary w-full justify-center" disabled={game.questions.some((question) => !answers[question.id]?.trim())} onClick={() => setSubmitted(true)}><Send size={15} /> Submit Level 1 and join</button>
      </>}
    </article>
  );
}

export function PublicShareScreen({ kind, value }: { kind: ShareKind; value: string }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reading, setReading] = useState<SharedReading | null>(null);
  const [publicQuotes, setPublicQuotes] = useState<DailyQuoteFeedItem[]>([]);
  const [quiz, setQuiz] = useState<any>(null);
  const [game, setGame] = useState<any>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [savingQuestion, setSavingQuestion] = useState<string | null>(null);
  const [submittingQuiz, setSubmittingQuiz] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [pendingReaction, setPendingReaction] = useState<string | null>(null);
  const [savingInsight, setSavingInsight] = useState(false);

  const signupHref = useMemo(() => {
    const search = new URLSearchParams({ signup: '1' });
    if (kind === 'quiz') search.set('claim-quiz', value);
    return `${window.location.pathname}?${search.toString()}`;
  }, [kind, value]);
  const readingGuestKey = useMemo(
    () => kind === 'reading' ? publicGuestKey(`reading:${value}`) : '',
    [kind, value],
  );
  const quizGuestKey = useMemo(
    () => kind === 'quiz' ? publicGuestKey(`quiz:${value}`) : '',
    [kind, value],
  );

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    const load = kind === 'reading' ? fetchSharedReading(value, readingGuestKey) : kind === 'quiz' ? fetchSharedQuiz(value) : fetchSharedDailyGame(value);
    void load
      .then((data) => {
        if (cancelled) return;
        if (!data) throw new Error('This shared item is no longer available.');
        if (kind === 'reading') {
          setReading(data as SharedReading);
          void fetchPublicDailyQuotes(value).then(setPublicQuotes).catch(() => setPublicQuotes([]));
        }
        else if (kind === 'quiz') setQuiz(data as NonNullable<Awaited<ReturnType<typeof fetchSharedQuiz>>>);
        else setGame(data);
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
          const guestActor = {
            user_id: `guest:${readingGuestKey.slice(0, 16)}`,
            display_name: 'Guest reader',
            avatar_url: null,
            is_guest: true,
            is_current_guest: true,
          };
          return {
            ...insight,
            reactions: {
              ...insight.reactions,
              [reactionType]: {
                ...previous,
                reacted,
                count: Math.max(0, previous.count + (reacted ? 1 : -1)),
                actors: reacted
                  ? previous.actors.some((actor) => actor.user_id === guestActor.user_id)
                    ? previous.actors
                    : [guestActor, ...previous.actors]
                  : previous.actors.filter((actor) => !actor.is_current_guest && actor.user_id !== guestActor.user_id),
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

  const addInsightToSharedReading = async (narrativeId: string, verseReference: string, body: string) => {
    if (!reading || savingInsight) return;
    setSavingInsight(true);
    try {
      await addSharedInsight(narrativeId, verseReference, body, readingGuestKey);
      const refreshed = await fetchSharedReading(value, readingGuestKey);
      if (refreshed) setReading(refreshed);
    } catch (saveError: any) {
      setError(saveError?.message || 'Your insight could not be shared.');
    } finally {
      setSavingInsight(false);
    }
  };

  const saveAnswer = async (questionId: string, answer: string) => {
    if (!quiz?.session?.id) return;
    setAnswers((current) => ({ ...current, [questionId]: answer }));
    setSavingQuestion(questionId);
    try {
      await saveSharedQuizAnswer(quiz.session.id, quizGuestKey, questionId, answer);
    } catch (saveError: any) {
      setError(saveError?.message || 'Your answer could not be saved.');
    } finally {
      setSavingQuestion(null);
    }
  };

  const submitQuiz = async () => {
    if (!quiz?.session?.id || submittingQuiz) return;
    setSubmittingQuiz(true);
    try {
      await Promise.all(Object.entries(answers).map(([questionId, answer]) => (
        saveSharedQuizAnswer(quiz.session.id, quizGuestKey, questionId, answer.trim())
      )));
      await completeSharedQuiz(quiz.session.id, quizGuestKey);
      try {
        window.localStorage.setItem('full-circle-pending-quiz-claim', quiz.session.id);
      } catch {
        // The claim query in the join URL remains available if storage is blocked.
      }
      setSubmitted(true);
      window.setTimeout(() => window.location.assign(signupHref), 700);
    } catch (submitError: any) {
      setError(submitError?.message || 'Your quiz could not be submitted.');
    } finally {
      setSubmittingQuiz(false);
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
            quotes={publicQuotes}
            signupHref={signupHref}
            pendingReaction={pendingReaction}
            onReact={(insightId, reactionType) => void reactToSharedInsight(insightId, reactionType)}
            onAddInsight={addInsightToSharedReading}
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
              <section className="card p-6 text-center"><CheckCircle2 size={32} className="mx-auto text-moss" /><h2 className="mt-3 font-display text-xl font-bold text-ink">Your answers are in.</h2><p className="mt-2 text-sm text-stone">Taking you to create your Full Circle account so this result can open in Weekly Quiz.</p><a href={signupHref} className="btn-primary mt-4">Continue now</a></section>
            ) : (
              <>
                {quiz.questions.map((question: any, index: number) => {
                  const payload = question.question_payload || {};
                  const options = Array.isArray(payload.options) ? payload.options : [];
                  const currentAnswer = answers[question.id] || '';
                  return <section key={question.id} className="card p-5"><p className="text-xs font-bold text-brass">Question {index + 1}</p><p className="mt-2 text-base font-semibold leading-relaxed text-ink">{payload.question || payload.question_text}</p>{options.length ? <div className="mt-4 space-y-2">{options.map((option: string, optionIndex: number) => <label key={`${option}-${optionIndex}`} className={cn('flex cursor-pointer items-center gap-2 rounded-lg border p-3 text-sm', currentAnswer === option ? 'border-brass bg-brass-soft text-ink' : 'border-border bg-surface-2 text-stone')}><input type="radio" name={question.id} value={option} checked={currentAnswer === option} onChange={() => void saveAnswer(question.id, option)} /><span>{option}</span></label>)}</div> : <input className="input-field mt-4" value={currentAnswer} onChange={(event) => setAnswers((current) => ({ ...current, [question.id]: event.target.value }))} onBlur={(event) => { if (event.target.value.trim()) void saveAnswer(question.id, event.target.value.trim()); }} placeholder="Your answer" />}{savingQuestion === question.id && <p className="mt-2 text-[10px] text-stone">Saving...</p>}</section>;
                })}
                <button type="button" className="btn-primary w-full justify-center" disabled={submittingQuiz || Boolean(savingQuestion) || quiz.questions.some((question: any) => !answers[question.id]?.trim())} onClick={() => void submitQuiz()}>{submittingQuiz ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />} Submit and join to see results</button>
              </>
            )}
          </article>
        )}
        {!loading && !error && kind === 'game' && game && (
          <SharedGameView game={game} signupHref={signupHref} />
        )}
      </div>
    </main>
  );
}
