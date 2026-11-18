import { type MouseEvent, type PointerEvent, useEffect, useRef, useState } from 'react';
import { HelpCircle } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { fetchCampMentionCandidates, fetchPanelImageSetting, type CampMentionCandidate, type BibleChapterLocation } from '../lib/queries';
import { supabase } from '../lib/supabase';
import type { PanelImageSetting } from '../lib/types';
import { AppSelect } from './AppSelect';
import { PanelImageBackdrop } from './PanelImageBackdrop';

export type ScriptureQuestionTarget = { reference: string; narrativeId?: string; chapter?: BibleChapterLocation };

function QuestionDialog({ image, title, dismiss, children }: {
  image: PanelImageSetting | null; title: string; dismiss?: () => void; children: React.ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const startedOnBackdrop = useRef(false);

  const isBackdrop = (event: MouseEvent<HTMLDialogElement> | PointerEvent<HTMLDialogElement>) => {
    if (event.target !== event.currentTarget) return false;
    const { left, top, right, bottom } = event.currentTarget.getBoundingClientRect();
    return event.clientX < left || event.clientX > right || event.clientY < top || event.clientY > bottom;
  };
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, []);
  return <dialog ref={dialog} aria-label={title} data-artwork-theme={image?.url ? 'night' : undefined}
    className="card fixed inset-0 m-auto max-h-[85dvh] w-[min(92vw,36rem)] overflow-auto p-5 text-ink backdrop:bg-black/75"
    onPointerDown={(event) => { startedOnBackdrop.current = isBackdrop(event); }}
    onClick={(event) => {
      const shouldDismiss = startedOnBackdrop.current && isBackdrop(event);
      startedOnBackdrop.current = false;
      if (shouldDismiss) dismiss?.();
    }}
    onCancel={(event) => { event.preventDefault(); dismiss?.(); }}>
    <PanelImageBackdrop image={image} opacityOverride={60} veilClassName="welcome-slide-veil" modeFilter={false} />
    <div className="relative z-10 space-y-4">
      <h2 className="flex items-center gap-2 font-display text-xl font-bold text-peri"><HelpCircle size={21} /> {title}</h2>
      {children}
    </div>
  </dialog>;
}

function useQuestionArtwork(enabled: boolean) {
  const [artwork, setArtwork] = useState<PanelImageSetting | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    void fetchPanelImageSetting('meditation').then(image => { if (active) setArtwork(image); }).catch(() => {});
    return () => { active = false; };
  }, [enabled]);
  return artwork;
}

export function ScriptureQuestionComposer({ target, close, onPosted }: {
  target: ScriptureQuestionTarget; close: () => void; onPosted: () => void;
}) {
  const { profile } = useAuth();
  const image = useQuestionArtwork(true);
  const [candidates, setCandidates] = useState<CampMentionCandidate[]>([]);
  const [selected, setSelected] = useState<CampMentionCandidate[]>([]);
  const [scope, setScope] = useState<'people' | 'camp' | 'community'>('people');
  const [search, setSearch] = useState('');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const request = useRef<string | null>(null);
  useEffect(() => {
    let active = true;
    void fetchCampMentionCandidates().then(result => {
      if (active) setCandidates(result.filter(person => person.user_id !== profile?.id));
    }).catch(() => { if (active) setError('Member names could not load. Reopen this form to try again.'); });
    return () => { active = false; };
  }, [profile?.id]);
  const tagged = selected.length > 0 || scope !== 'people';
  const matches = candidates.filter(person => !selected.some(chosen => chosen.user_id === person.user_id)
    && person.display_name.toLowerCase().includes(search.trim().toLowerCase())).slice(0, 15);
  const post = async () => {
    if (!tagged || !body.trim() || busy) return;
    setBusy(true);
    setError('');
    request.current ??= crypto.randomUUID();
    const { error: failure } = await supabase.rpc('post_scripture_question', {
      p_id: request.current, p_narrative_id: target.narrativeId ?? null,
      p_book: target.chapter?.book ?? null, p_chapter: target.chapter?.chapter ?? null,
      p_reference: target.reference, p_body: body,
      p_people: selected.map(person => person.user_id), p_scope: scope,
    });
    setBusy(false);
    if (failure) { setError(failure.message); return; }
    onPosted();
    close();
  };

  return <QuestionDialog image={image} title="Ask a question" dismiss={busy ? undefined : close}>
    <p className="text-sm text-ink">{target.reference}</p>
    <div>
      <p className="mb-1 text-xs font-semibold text-stone">Tag</p>
      <AppSelect
        ariaLabel="Tag"
        value={scope}
        disabled={busy}
        onChange={value => setScope(value as typeof scope)}
        options={[
          { value: 'people', label: 'Specific people' },
          { value: 'camp', label: 'Entire camp' },
          { value: 'community', label: 'Entire community' },
        ]}
      />
    </div>
    {scope !== 'community' && <>
      <div className="flex flex-wrap gap-2">
        {selected.map(person => <button key={person.user_id} type="button" className="btn-secondary text-xs" disabled={busy}
          aria-label={`Remove ${person.display_name}`} onClick={() => setSelected(items => items.filter(item => item.user_id !== person.user_id))}>
          {person.display_name} ×
        </button>)}
      </div>
      <input className="input-field w-full" aria-label="Find people to tag" placeholder="Search members by name" value={search} disabled={busy} onChange={event => setSearch(event.target.value)} />
      <div className="max-h-28 space-y-1 overflow-y-auto">
        {matches.map(person => <button key={person.user_id} type="button" className="btn-ghost block w-full text-left text-sm" disabled={busy}
          onClick={() => { setSelected(items => [...items, person]); setSearch(''); }}>{person.display_name}</button>)}
      </div>
    </>}
    <textarea className="input-field min-h-24 w-full" aria-label="Your question" maxLength={1200} value={body} disabled={!tagged || busy}
      placeholder={tagged ? 'Write your question' : 'Tag someone to write your question'}
      onChange={event => setBody(event.target.value)} />
    {error && <p role="alert" className="text-sm text-coral">{error}</p>}
    <div className="flex flex-wrap justify-end gap-2">
      <button type="button" className="btn-secondary" disabled={busy} onClick={close}>Cancel</button>
      <button type="button" className="btn-primary" disabled={busy || !tagged || !body.trim()} onClick={() => void post()}>{busy ? 'Posting…' : 'Post question'}</button>
    </div>
  </QuestionDialog>;
}

type PendingQuestion = { id: string; verse_reference: string; body: string; author: string };

export function ScriptureQuestionInbox() {
  const { profile } = useAuth();
  const [question, setQuestion] = useState<PendingQuestion | null>(null);
  const [answering, setAnswering] = useState(false);
  const [answer, setAnswer] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const image = useQuestionArtwork(Boolean(question));
  const generation = useRef(0);
  const load = async () => {
    const request = ++generation.current;
    const result = await supabase.rpc('get_pending_scripture_question');
    if (!result.error && request === generation.current) setQuestion((result.data as PendingQuestion[] | null)?.[0] ?? null);
  };
  useEffect(() => {
    if (!profile?.id) return;
    void load();
    const refresh = () => { if (document.visibilityState === 'visible') void load(); };
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    const interval = window.setInterval(refresh, 30_000);
    return () => {
      generation.current += 1;
      window.clearInterval(interval);
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
      setQuestion(null);
    };
  }, [profile?.id]);
  useEffect(() => {
    setAnswering(false);
    setAnswer('');
    setError('');
  }, [question?.id]);

  if (!question) return null;
  const resolve = async (decision: 'answer' | 'ignore') => {
    if (busy) return;
    setBusy(true);
    setError('');
    const { error: failure } = await supabase.rpc('resolve_scripture_question', {
      p_question_id: question.id, p_decision: decision, p_answer: decision === 'answer' ? answer : null,
    });
    if (failure) setError(failure.message);
    else {
      generation.current += 1;
      setQuestion(null);
      await load();
    }
    setBusy(false);
  };
  return <QuestionDialog key={question.id} image={image} title="You were tagged in a question">
    <p className="text-sm font-semibold">{question.author} · {question.verse_reference}</p>
    <p className="whitespace-pre-wrap text-base">{question.body}</p>
    {answering && <textarea autoFocus className="input-field min-h-24 w-full" aria-label="Your answer" maxLength={1200}
      value={answer} onChange={event => setAnswer(event.target.value)} placeholder="Write your answer" />}
    {error && <p role="alert" className="text-sm text-coral">{error}</p>}
    <div className="flex flex-wrap justify-end gap-2">
      <button type="button" className="btn-secondary" disabled={busy} onClick={() => void resolve('ignore')}>Ignore</button>
      {answering
        ? <button type="button" className="btn-primary" disabled={busy || !answer.trim()} onClick={() => void resolve('answer')}>Send answer</button>
        : <button type="button" className="btn-primary" onClick={() => setAnswering(true)}>Answer</button>}
    </div>
  </QuestionDialog>;
}
