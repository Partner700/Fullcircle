import { useEffect, useMemo, useState } from 'react';
import { Award, BookMarked, Bookmark, Cake, CheckCircle2, ChevronLeft, ChevronRight, Flame, Heart, Lightbulb, Loader2, Lock, Quote, ScrollText, Send, Sun, UserPlus, X } from 'lucide-react';
import { ScrollEdge } from '../components/AncientMotifs';
import { Dove } from '../components/Dove';
import { PanelImageBackdrop } from '../components/PanelImageBackdrop';
import { AwardBadgeGlyph } from '../components/VallumAvatarBadge';
import { QuoteReleaseTime } from '../components/QuoteReleaseTime';
import { TentHouseSymbol } from '../components/TentHouseSymbol';
import { RelativeTime } from '../components/RelativeTime';
import { UserAvatar } from '../components/UserAvatar';
import {
  completeSharedQuiz,
  fetchSharedQuiz,
  fetchSharedDailyGame,
  fetchSharedReading,
  fetchPublicDailyQuotes,
  saveSharedQuizAnswer,
  fetchPublicRestDayAwards,
  type PublicRestDayAward,
  type SharedReading,
  type SharedReadingInsight,
  type VerseInsightReactionType,
  toggleSharedInsightReaction,
} from '../lib/queries';
import { cn } from '../lib/utils';
import type { DailyQuoteFeedItem, PanelImageSetting } from '../lib/types';
import { fetchPublicBirthdayAnnouncement, type PublicBirthdayView } from '../lib/birthdays';

type ShareKind = 'reading' | 'quiz' | 'game' | 'birthday';

function PublicRestDayAwards({ readingDate }: { readingDate: string }) {
  const [awards, setAwards] = useState<PublicRestDayAward[]>([]);

  useEffect(() => {
    let cancelled = false;
    void fetchPublicRestDayAwards(readingDate)
      .then((items) => { if (!cancelled) setAwards(items); })
      .catch((error) => console.warn('Public rest-day awards could not load:', error));
    return () => { cancelled = true; };
  }, [readingDate]);

  if (!awards.length) return null;
  return (
    <section className="card border-gold/30 bg-surface p-5 animate-slide-up" aria-label="Rest day honors">
      <div className="mb-4 flex items-center gap-2">
        <Award size={18} className="text-gold" />
        <div><p className="eyebrow text-gold">Rest Day</p><h2 className="font-display text-lg font-bold text-ink">Full Circle Honors</h2></div>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        {awards.map((award) => (
          <div key={award.id} className="flex min-w-0 items-center gap-3 rounded-lg border border-border bg-surface-2 p-3">
            <span className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-gold/45 bg-gold-soft text-gold">
              <UserAvatar userId={award.user_id} name={award.display_name} avatarUrl={award.avatar_url} className="h-full w-full" showAwardBadge={false} />
              <span className="absolute -bottom-1 -right-1 inline-flex h-4 w-4 items-center justify-center rounded-full border border-gold/80 bg-navy-2 text-gold">
                <AwardBadgeGlyph awardType={award.award_type} title={award.title} size={9} />
              </span>
            </span>
            <div className="min-w-0 flex-1"><p className="truncate text-xs font-black text-ink">{award.display_name}</p><p className="truncate text-[11px] font-semibold text-brass">{award.title}</p></div>
            {award.tent_house_id && <TentHouseSymbol houseId={award.tent_house_id} size={19} />}
          </div>
        ))}
      </div>
    </section>
  );
}

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

function readingPanels(reading: SharedReading): Array<{ reference: string; verses: SharedVerse[] }> {
  if (reading.weekly_highlights?.length) {
    return [{ reference: 'Scripture', verses: reading.weekly_highlights.map((highlight) => ({
      narrativeId: highlight.narrative_id,
      reference: highlight.reference,
      text: highlight.text,
    })) }];
  }

  const passages = reading.scripture_passages?.length
    ? reading.scripture_passages
    : [{
      reference: reading.scripture_reference,
      main_text: reading.main_text,
      highlighted_verses: reading.highlighted_verses || [],
      source_narrative_id: undefined,
    }];

  return passages.map((passage) => {
    const verses = passage.highlighted_verses?.length
      ? passage.highlighted_verses
      : [{ reference: passage.reference, text: passage.main_text, meditation: '', source_narrative_id: undefined }];
    return { reference: passage.reference, verses: verses.map((verse) => ({
      narrativeId: verse.source_narrative_id || passage.source_narrative_id || reading.id,
      reference: verse.reference || passage.reference,
      text: verse.text,
      meditation: verse.meditation,
    })) };
  });
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
      <div data-artwork-theme={(image || null)?.url ? 'night' : undefined} className="quote-glass-panel relative min-h-[16rem] overflow-hidden rounded-2xl border border-border">
        <PanelImageBackdrop image={image || null} opacityOverride={100} imageClassName="quote-glass-image" veilClassName="quote-picture-veil" modeFilter={false} textGradient={false} simple />
        <div className="panel-veil-layer quote-glass-tint pointer-events-none absolute inset-0" aria-hidden="true" />
        <div className="relative z-10 flex transition-transform duration-500 ease-out" style={{ transform: `translateX(-${index * 100}%)` }}>
          {slides.map((slide, slideIndex) => (
            <article key={slide.kind === 'quote' ? `${slide.quote.user_id}:${slide.quote.record_date}` : 'join'} className="flex min-h-[16rem] min-w-full flex-col justify-between p-5">
              <div>
                <p className="eyebrow flex items-center gap-1.5 text-brass"><Quote size={14} /> Quotes From Daily Meditations</p>
                {slide.kind === 'quote' ? (
                  <p className="mt-5 font-display text-2xl font-medium italic leading-snug text-ink">&ldquo;{slide.quote.daily_quote}&rdquo;<button type="button" disabled={!slide.quote.has_public_meditation} className="ml-2 inline-flex align-baseline text-gold disabled:cursor-default disabled:text-stone-dim disabled:opacity-45" aria-label={slide.quote.has_public_meditation ? 'Join to read this meditation' : 'This meditation is private'} title={slide.quote.has_public_meditation ? 'Join to read this meditation' : 'This meditation is private'} onClick={() => { if (slide.quote.has_public_meditation) setJoinOpen(true); }}><Bookmark size={16} fill={slide.quote.has_public_meditation ? 'currentColor' : 'none'} /></button><QuoteReleaseTime quote={slide.quote} /></p>
                ) : (
                  <p className="mt-5 font-display text-2xl font-medium italic leading-snug text-ink">&ldquo;Come and read, reflect, and grow with us.&rdquo;</p>
                )}
              </div>
              <div className="mt-6 flex items-center gap-3">
                {slide.kind === 'quote' ? (
                  <>
                    <span className="relative flex h-11 w-11"><UserAvatar userId={slide.quote.user_id} name={slide.quote.display_name} avatarUrl={slide.quote.avatar_url} className="h-full w-full border border-border-bright" /></span>
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

function PublicInsight({ insight, guestKey, signupHref }: { insight: SharedReadingInsight; guestKey: string; signupHref: string }) {
  const [reactions,setReactions]=useState(insight.reactions);
  const [pendingReaction,setPendingReaction]=useState<string|null>(null);
  const [error,setError]=useState('');
  useEffect(()=>{setReactions(insight.reactions);},[insight.reactions]);
  const toggle=async(kind:VerseInsightReactionType)=>{
    if(pendingReaction || !guestKey || !reactions?.[kind])return;
    const key=kind;
    const previous=reactions[kind];
    const optimisticReacted=!previous.reacted;
    const applyReaction=(reacted:boolean)=>setReactions(current=>({...current,[kind]:{...previous,reacted,count:Math.max(0,previous.count+Number(reacted)-Number(previous.reacted)),actors:previous.actors.filter(actor=>!actor.is_current_guest)}}));
    setError('');
    setPendingReaction(key);
    applyReaction(optimisticReacted);
    try {
      const reacted = await toggleSharedInsightReaction(insight.id,guestKey,kind);
      applyReaction(reacted);
    } catch {
      setReactions(current=>({...current,[kind]:previous}));setError('Reaction could not be saved. Please retry.');
    } finally {setPendingReaction(null);}
  };
  return <div className="mt-3 rounded-lg border border-border bg-surface/80 p-3">
    <div className="flex items-center gap-2"><UserAvatar userId={insight.user_id} name={insight.profiles?.display_name} avatarUrl={insight.profiles?.avatar_url} className="h-8 w-8"/><div><p className="text-xs font-bold text-ink">{insight.profiles?.display_name || 'Member'}</p><RelativeTime value={insight.created_at}/></div></div>
    <p className="mt-2 whitespace-pre-wrap text-sm text-ink">{insight.body}</p>
    <div className="mt-2 flex flex-wrap items-center gap-2">
      {(['heart','lightbulb'] as const).map(kind=>{const state=reactions?.[kind];const Icon=kind==='heart'?Heart:Lightbulb;return <div key={kind} className="flex items-center gap-1"><button type="button" disabled={!!pendingReaction||!state} aria-pressed={!!state?.reacted} aria-label={kind==='heart'?'Like insight':'Thinking about it'} onClick={()=>void toggle(kind)} className="btn-secondary text-xs"><Icon size={14} fill={state?.reacted?'currentColor':'none'}/>{state?.count||0}</button>{state?.actors?.slice(0,4).map(actor=><span key={actor.user_id} className="relative inline-flex h-4 w-4" title={actor.display_name}><UserAvatar userId={actor.is_guest?undefined:actor.user_id} name={actor.display_name} avatarUrl={actor.is_guest ? null : actor.avatar_url} className="h-full w-full"/></span>)}</div>;})}
    </div>
    {error&&<p role="alert" className="text-xs text-coral">{error}</p>}
    <div className="mt-2 space-y-2">{insight.comments.map(comment=><div key={comment.id} className="rounded border border-border p-2"><div className="flex gap-2 items-center"><UserAvatar userId={comment.user_id} name={comment.profile?.display_name} avatarUrl={comment.profile?.avatar_url} className="h-6 w-6"/><span className="text-xs font-bold">{comment.profile?.display_name||'Member'}</span><RelativeTime value={comment.created_at}/></div><p className="mt-1 whitespace-pre-wrap text-xs">{comment.body}</p></div>)}</div>
    <a href={signupHref} className="mt-2 inline-flex items-center gap-1 text-xs text-brass"><Send size={12}/> Reply</a>
  </div>;
}
function SharedReadingView({
  reading,
  quotes,
  signupHref,
  guestKey,
}: {
  reading: SharedReading;
  quotes: DailyQuoteFeedItem[];
  signupHref: string;
  guestKey: string;
}) {
  const panels = readingPanels(reading);
  const isSundayReading = new Date(`${reading.narrative_date}T12:00:00`).getDay() === 0;
  return (
    <article className="today-reading-screen space-y-5">
      <section data-artwork-theme={(reading.panel_images?.reading)?.url ? 'night' : undefined}
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
        <section data-artwork-theme={(reading.panel_images?.scripture)?.url ? 'night' : undefined} className={cn('card reading-glass-panel relative overflow-hidden border-brass/30 animate-slide-up', isSundayReading ? 'max-h-[60svh] p-4' : 'p-5')} style={{ backdropFilter: 'blur(26px) saturate(1.22)' }}>
          <PanelImageBackdrop image={reading.panel_images?.scripture} opacityFallback={100} imageClassName="quote-glass-image" veilClassName="quote-picture-veil" modeFilter={false} textGradient={false} simple />
          <div className="relative z-10">
            <div className={cn('flex items-center gap-2', isSundayReading ? 'mb-2' : 'mb-3')}><Sun size={18} className="text-brass" strokeWidth={1.5} /><span className="eyebrow text-stone">{isSundayReading ? 'Verse of the Week' : 'Verse of the Day'}</span></div>
            <ScrollEdge position="top" className={cn('text-brass', isSundayReading ? 'mb-2' : 'mb-3')} />
            <p className={cn('font-display text-ink', isSundayReading ? 'max-h-[calc(60svh-7.5rem)] overflow-y-auto pr-1 text-base leading-relaxed sm:text-lg' : 'text-xl leading-snug')}>&ldquo;{reading.verse_of_day}&rdquo;</p>
            <ScrollEdge position="bottom" className={cn('text-brass', isSundayReading ? 'mt-2' : 'mt-3')} />
          </div>
        </section>
      )}

      {panels.map((panel, panelIndex) => (
        <section key={`${panel.reference}-${panelIndex}`} aria-label={panel.reference} data-artwork-theme={(reading.panel_images?.scripture)?.url ? 'night' : undefined} className="card reading-glass-panel relative isolate overflow-hidden border-border p-5 animate-slide-up" style={{ backdropFilter: 'blur(26px) saturate(1.22)' }}>
          <PanelImageBackdrop image={reading.panel_images?.scripture} opacityFallback={100} imageClassName="quote-glass-image" veilClassName="quote-picture-veil" modeFilter={false} textGradient={false} simple />
          <div className="relative z-10">
            <div className="mb-3 flex items-center gap-2"><ScrollText size={18} className="text-brass" strokeWidth={1.5} /><h2 className="eyebrow text-stone">{panel.reference || 'Scripture'}</h2></div>
            <ScrollEdge position="top" className="mb-4 text-brass" />
            <div className="space-y-4 sm:space-y-5">
              {panel.verses.map((verse, index) => {
                const verseNumber = verse.reference.match(/:(\d+)(?:\D|$)/)?.[1] || String(index + 1);
                return (
                  <section key={`${verse.narrativeId}:${verse.reference}:${index}`} className="rounded-xl border border-transparent px-2 py-2">
                    <p className="text-[15px] leading-8 text-ink"><span className="mr-1.5 font-bold text-brass">{verseNumber}.</span>{verse.text}</p>
                    <p className="mt-2 text-[10px] font-bold uppercase text-brass">
                      {verse.reference}{verse.meditation?.trim() ? ' · Instructor annotation available' : ''}
                    </p>
                    {(reading.insights||[]).filter(insight=>insight.narrative_id===verse.narrativeId && insight.verse_reference===verse.reference).map(insight=><PublicInsight key={insight.id} insight={insight} guestKey={guestKey} signupHref={signupHref}/>)}
                    <a href={signupHref} className="mt-2 inline-flex items-center gap-1 text-xs text-brass"><Lightbulb size={12}/> Add insight</a>
                    {verse.meditation?.trim() && (
                      <div className="mt-3 border-l-2 border-brass/50 bg-brass-soft px-4 py-3">
                        <p className="text-[10px] font-bold uppercase text-brass">Instructor insight</p>
                        <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-ink">{verse.meditation}</p>
                      </div>
                    )}
                  </section>
                );
              })}
            </div>
            <ScrollEdge position="bottom" className="mt-4 text-brass" />
          </div>
        </section>
      ))}

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
      {isSundayReading && <PublicRestDayAwards readingDate={reading.narrative_date} />}
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

export function PublicShareScreen({ kind, value, date }: { kind: ShareKind; value: string; date?: string }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reading, setReading] = useState<SharedReading | null>(null);
  const [publicQuotes, setPublicQuotes] = useState<DailyQuoteFeedItem[]>([]);
  const [quiz, setQuiz] = useState<any>(null);
  const [game, setGame] = useState<any>(null);
  const [birthday, setBirthday] = useState<PublicBirthdayView | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [savingQuestion, setSavingQuestion] = useState<string | null>(null);
  const [submittingQuiz, setSubmittingQuiz] = useState(false);
  const [submitted, setSubmitted] = useState(false);

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
    const load = kind === 'reading'
      ? fetchSharedReading(value, readingGuestKey)
      : kind === 'quiz'
        ? fetchSharedQuiz(value)
        : kind === 'game'
          ? fetchSharedDailyGame(value)
          : date
            ? fetchPublicBirthdayAnnouncement(value, date)
            : Promise.resolve(null);
    void load
      .then((data) => {
        if (cancelled) return;
        if (!data) throw new Error(kind === 'quiz' ? 'Open Full Circle to check access to this quiz.' : 'This shared item is no longer available.');
        if (kind === 'reading') {
          setReading(data as SharedReading);
          void fetchPublicDailyQuotes(value).then(setPublicQuotes).catch(() => setPublicQuotes([]));
        }
        else if (kind === 'quiz') setQuiz(data as NonNullable<Awaited<ReturnType<typeof fetchSharedQuiz>>>);
        else if (kind === 'game') setGame(data);
        else setBirthday(data as PublicBirthdayView);
      })
      .catch((loadError: any) => { if (!cancelled) setError(loadError?.message || 'This shared item could not load.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [date, kind, readingGuestKey, value]);

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
            guestKey={readingGuestKey}
            signupHref={signupHref}
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
        {!loading && !error && kind === 'birthday' && birthday && (
          <article data-artwork-theme={(birthday.panel_image)?.url ? 'night' : undefined} className="card relative isolate min-h-[25rem] overflow-hidden p-6 sm:p-8">
            <PanelImageBackdrop image={birthday.panel_image} opacityFallback={42} veilClassName="welcome-slide-veil" modeFilter={false} />
            <div className="relative z-10 flex min-h-[21rem] flex-col justify-between">
              <div>
                <p className="eyebrow flex items-center gap-1.5 text-brass"><Cake size={15} /> Birthday Celebration</p>
                <div className="mt-5 flex items-center gap-3">
                  <UserAvatar
                    userId={birthday.metadata?.user_id}
                    name={birthday.metadata?.display_name || 'Birthday celebrant'}
                    avatarUrl={birthday.metadata?.avatar_url}
                    className="h-16 w-16 rounded-2xl border border-brass/50 shadow-lg"
                    loading="eager"
                  />
                  <div className="min-w-0">
                    <p className="text-xs font-bold uppercase text-stone">Celebrate with us</p>
                    <h1 className="font-display text-2xl font-black text-ink">{birthday.metadata?.display_name || 'A Full Circle resident'}</h1>
                  </div>
                </div>
                <h2 className="mt-7 font-display text-3xl font-semibold text-ink">Hey Everyone</h2>
                <p className="mt-3 max-w-xl whitespace-pre-wrap text-sm leading-relaxed text-stone">{birthday.content}</p>
              </div>
              <div className="mt-8 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
                <p className="text-xs text-stone">Join Full Circle to react and send a birthday wish.</p>
                <a href={signupHref} className="btn-primary"><UserPlus size={15} /> Join the celebration</a>
              </div>
            </div>
          </article>
        )}
      </div>
    </main>
  );
}
