import { useEffect, useRef, useState, type TouchEvent } from 'react';
import { BookOpen, ChevronLeft, ChevronRight, HelpCircle, Heart, Lightbulb, MessageCircle } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useSubscriptionAccess } from '../../context/SubscriptionAccessContext';
import { AppSelect } from '../../components/AppSelect';
import { PanelImageBackdrop } from '../../components/PanelImageBackdrop';
import { ScriptureQuestionComposer, type ScriptureQuestionTarget } from '../../components/ScriptureQuestion';
import { BIBLE_BOOKS } from '../../lib/bibleBooks';
import { fetchEditionChapter, readScriptureEdition, SCRIPTURE_EDITIONS } from '../../lib/scriptureEditions';
import { addVerseInsightComment, fetchPanelImageSetting, fetchVerseInsights, toggleVerseInsightReaction } from '../../lib/queries';
import { supabase } from '../../lib/supabase';
import type { PanelImageSetting } from '../../lib/types';

const books = BIBLE_BOOKS.map((book, index) => ({
  value: String(index),
  label: book.name,
  description: index < 39 ? 'Old Testament' : 'New Testament',
}));
const editions = SCRIPTURE_EDITIONS.filter(item => item.value !== 'published');
const reactions = [
  { key: 'heart', Icon: Heart, label: 'Like' },
  { key: 'lightbulb', Icon: Lightbulb, label: 'Thinking about it' },
] as const;

export function BibleReader() {
  const { profile } = useAuth();
  const { hasPremiumAccess, requirePremiumAccess } = useSubscriptionAccess();
  const [bookIndex, setBookIndex] = useState(0);
  const [chapter, setChapter] = useState(1);
  const reader = useRef<HTMLDivElement>(null);
  const swipeStart = useRef<{ identifier: number; x: number; y: number } | null>(null);
  const [edition, setEdition] = useState(() => {
    const stored = readScriptureEdition(profile?.id);
    return stored === 'published' ? 'web' : stored;
  });
  const book = BIBLE_BOOKS[bookIndex];
  const [artwork, setArtwork] = useState<PanelImageSetting | null>(null);
  const [text, setText] = useState<Awaited<ReturnType<typeof fetchEditionChapter>> | null>(null);
  const [textError, setTextError] = useState(false);
  const [retry, setRetry] = useState(0);
  const [insights, setInsights] = useState<Awaited<ReturnType<typeof fetchVerseInsights>>>([]);
  const [refresh, setRefresh] = useState(0);
  const [openVerse, setOpenVerse] = useState<number | null>(null);
  const [question, setQuestion] = useState<ScriptureQuestionTarget | null>(null);
  const [draft, setDraft] = useState('');
  const [replyTarget, setReplyTarget] = useState<string | null>(null);
  const [reply, setReply] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    void fetchPanelImageSetting('meditation').then(image => { if (active) setArtwork(image); }).catch(() => {});
    return () => { active = false; };
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    setText(null);
    setTextError(false);
    void fetchEditionChapter(edition, book.slug, chapter, controller.signal).then(result => {
      if (!controller.signal.aborted) setText(result);
    }).catch(() => { if (!controller.signal.aborted) setTextError(true); });
    return () => controller.abort();
  }, [edition, book.slug, chapter, retry]);
  useEffect(() => {
    let active = true;
    if (!hasPremiumAccess) { setInsights([]); return; }
    void fetchVerseInsights({ book: book.slug, chapter }).then(rows => { if (active) setInsights(rows); });
    return () => { active = false; };
  }, [book.slug, chapter, hasPremiumAccess, refresh]);

  const resetThread = () => {
    setDraft('');
    setReply('');
    setReplyTarget(null);
    setError('');
  };
  const openChapter = (nextBook: number, nextChapter: number) => {
    setBookIndex(nextBook);
    setChapter(nextChapter);
    setText(null);
    setInsights([]);
    setOpenVerse(null);
    resetThread();
  };
  const move = (direction: -1 | 1) => {
    const nextChapter = chapter + direction;
    if (nextChapter >= 1 && nextChapter <= book.chapters) openChapter(bookIndex, nextChapter);
    else {
      const nextBook = bookIndex + direction;
      if (BIBLE_BOOKS[nextBook]) openChapter(nextBook, direction === 1 ? 1 : BIBLE_BOOKS[nextBook].chapters);
    }
  };
  const turnPage = (direction: -1 | 1) => {
    if (direction === -1 && bookIndex === 0 && chapter === 1) return;
    if (direction === 1 && bookIndex === BIBLE_BOOKS.length - 1 && chapter === book.chapters) return;
    move(direction);
    reader.current?.scrollIntoView({ block: 'start' });
  };
  const startSwipe = (event: TouchEvent<HTMLElement>) => {
    swipeStart.current = null;
    if (event.touches.length !== 1 || window.getSelection()?.toString()) return;
    if (event.target instanceof Element && event.target.closest('button, a, input, textarea, select, [contenteditable]')) return;
    const touch = event.touches[0];
    swipeStart.current = { identifier: touch.identifier, x: touch.clientX, y: touch.clientY };
  };
  const finishSwipe = (event: TouchEvent<HTMLElement>) => {
    const start = swipeStart.current;
    swipeStart.current = null;
    if (!start || event.touches.length || window.getSelection()?.toString()) return;
    const touch = Array.from(event.changedTouches).find(item => item.identifier === start.identifier);
    if (!touch) return;
    const horizontal = touch.clientX - start.x;
    const vertical = touch.clientY - start.y;
    if (Math.abs(horizontal) >= 64 && Math.abs(horizontal) > Math.abs(vertical) * 1.5) {
      turnPage(horizontal < 0 ? 1 : -1);
    }
  };
  const updateThread = async (action: () => Promise<unknown>) => {
    if (!requirePremiumAccess() || busy) return;
    setError('');
    setBusy(true);
    try {
      await action();
      setRefresh(value => value + 1);
    } catch (failure) {
      setError((failure as { message?: string })?.message || 'This change could not be saved. Try again.');
    } finally {
      setBusy(false);
    }
  };
  const postInsight = (reference: string) => updateThread(async () => {
    if (!profile?.id) return;
    const { error: failure } = await supabase.from('scripture_verse_insights').insert({
      bible_book: book.slug, bible_chapter: chapter, verse_reference: reference,
      user_id: profile.id, body: draft.trim(),
    });
    if (failure) throw failure;
    setDraft('');
  });
  const ask = (reference: string, verse: number) => {
    if (!requirePremiumAccess()) return;
    setOpenVerse(verse);
    resetThread();
    setQuestion({ reference, chapter: { book: book.slug, chapter } });
  };

  return <div ref={reader} className="today-reading-screen mx-auto max-w-3xl space-y-4">
    <section className="card reading-glass-panel relative isolate overflow-hidden border-border p-5"
      data-artwork-theme={artwork?.url ? 'night' : undefined}>
      <PanelImageBackdrop image={artwork} opacityOverride={58} veilClassName="welcome-slide-veil" modeFilter={false} />
      <div className="relative z-10 space-y-4">
        <h1 className="flex items-center gap-2 font-display text-2xl font-bold text-peri"><BookOpen size={24} /> Bible</h1>
        <div className="grid grid-cols-[minmax(0,1fr)_7.5rem] gap-3">
          <div className="min-w-0">
            <p className="mb-1 text-xs font-semibold text-stone">Book</p>
            <AppSelect
              ariaLabel="Book"
              value={String(bookIndex)}
              options={books}
              onChange={value => {
                const nextBook = Number(value);
                if (nextBook !== bookIndex) openChapter(nextBook, 1);
              }}
            />
          </div>
          <div>
            <p className="mb-1 text-xs font-semibold text-stone">Chapter</p>
            <AppSelect
              ariaLabel="Chapter"
              buttonClassName="tabular-nums gap-2"
              value={String(chapter)}
              options={Array.from({ length: book.chapters }, (_, index) => {
                const number = String(index + 1);
                return { value: number, label: number };
              })}
              onChange={value => {
                const nextChapter = Number(value);
                if (nextChapter !== chapter) openChapter(bookIndex, nextChapter);
              }}
            />
          </div>
          <div className="col-span-2">
            <p className="mb-1 text-xs font-semibold text-stone">Bible edition</p>
            <AppSelect
              ariaLabel="Bible edition"
              value={edition}
              options={editions}
              onChange={value => {
                if (value === edition) return;
                setText(null);
                setEdition(value);
              }}
            />
          </div>
        </div>
      </div>
    </section>
    <section className="reading-glass-panel relative isolate overflow-hidden rounded-2xl border p-4 sm:p-6"
      style={{ touchAction: 'pan-y pinch-zoom' }}
      onTouchStart={startSwipe} onTouchEnd={finishSwipe}
      onTouchCancel={() => { swipeStart.current = null; }}>
      <div className="relative z-10">
        <h2 className="mb-3 font-display text-xl font-bold text-peri">{book.name} {chapter}</h2>
        {!text && !textError && <p role="status">Loading chapter…</p>}
        {textError && <div role="alert"><p>This chapter could not load.</p><button className="btn-secondary mt-2" onClick={() => setRetry(value => value + 1)}>Try again</button></div>}
        {text?.verses.map(verse => {
          const reference = `${book.name} ${chapter}:${verse.number}`;
          const rows = hasPremiumAccess ? insights.filter(item => item.verse_reference === reference) : [];
          return <article key={verse.number} className="space-y-2 border-b border-border py-3 last:border-0">
            <p className="text-[15px] leading-8 text-ink"><span className="mr-2 font-bold text-brass">{verse.number}.</span>{verse.text}</p>
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" className="btn-ghost text-xs" aria-expanded={openVerse === verse.number} onClick={() => {
                if (!requirePremiumAccess()) return;
                setOpenVerse(openVerse === verse.number ? null : verse.number);
                resetThread();
              }}><MessageCircle size={14} /> {hasPremiumAccess ? `Insights${rows.length ? ` (${rows.length})` : ''}` : 'Subscribe for insights'}</button>
              <button type="button" className="btn-ghost text-xs" aria-label={`Ask a question about ${reference}`} onClick={() => ask(reference, verse.number)}><HelpCircle size={16} /> Ask a question</button>
            </div>
            {hasPremiumAccess && openVerse === verse.number && <div className="space-y-3 rounded-xl border border-border bg-surface p-3">
              {rows.map(item => <div key={item.id} className="space-y-2 border-b border-border pb-3">
                <p className="text-sm font-semibold">{(Array.isArray(item.profiles) ? item.profiles[0] : item.profiles)?.display_name || 'Reader'}{item.is_question ? ' · Question' : ''}</p>
                <p className="whitespace-pre-wrap text-sm">{item.body}</p>
                <div className="flex flex-wrap gap-1">
                  {reactions.map(({ key, Icon, label }) => <button key={key} type="button" className="btn-ghost text-xs" title={label} aria-label={label}
                    disabled={busy} aria-pressed={item.reactions?.[key]?.reacted ?? false}
                    onClick={() => void updateThread(() => toggleVerseInsightReaction(item.id, key))}>
                    <Icon size={14} fill={item.reactions?.[key]?.reacted ? 'currentColor' : 'none'} /> {item.reactions?.[key]?.count ?? 0}
                  </button>)}
                  <button className="btn-ghost text-xs" aria-label="Ask a question" onClick={() => ask(reference, verse.number)}><HelpCircle size={15} /></button>
                  <button type="button" className="btn-ghost text-xs" onClick={() => { setReplyTarget(replyTarget === item.id ? null : item.id); setReply(''); }}>Comment</button>
                </div>
                {item.comments?.map(comment => <div key={comment.id} className="ml-3 border-l border-brass/40 pl-3 text-sm">
                  <p className="font-semibold">{comment.profile?.display_name || 'Reader'}</p><p className="whitespace-pre-wrap">{comment.body}</p>
                </div>)}
                {replyTarget === item.id && <div className="space-y-2">
                  <textarea className="input-field w-full" aria-label="Your comment" value={reply} maxLength={1200} onChange={event => setReply(event.target.value)} />
                  <button className="btn-secondary text-xs" disabled={busy || !reply.trim()} onClick={() => void updateThread(async () => {
                    if (!profile?.id) return;
                    await addVerseInsightComment({ insightId: item.id, userId: profile.id, body: reply });
                    setReply('');
                    setReplyTarget(null);
                  })}>Send comment</button>
                </div>}
              </div>)}
              <textarea className="input-field w-full" aria-label="Your insight" placeholder="Write an insight" maxLength={3000}
                value={draft} onChange={event => setDraft(event.target.value)} />
              <button className="btn-secondary text-xs" disabled={busy || !draft.trim()} onClick={() => void postInsight(reference)}>Post insight</button>
              {error && <p role="alert" className="text-sm text-coral">{error}</p>}
            </div>}
          </article>;
        })}
        {text?.credit && <p className="mt-4 whitespace-pre-line text-xs text-stone">{text.credit}</p>}
      </div>
    </section>
    <nav aria-label="Bible chapters" className="flex justify-between gap-2">
      <button className="btn-secondary" disabled={bookIndex === 0 && chapter === 1} onClick={() => turnPage(-1)}><ChevronLeft size={16} /> Previous chapter</button>
      <button className="btn-secondary" disabled={bookIndex === BIBLE_BOOKS.length - 1 && chapter === book.chapters} onClick={() => turnPage(1)}>Next chapter <ChevronRight size={16} /></button>
    </nav>
    {question && <ScriptureQuestionComposer target={question} close={() => setQuestion(null)} onPosted={() => setRefresh(value => value + 1)} />}
  </div>;
}
