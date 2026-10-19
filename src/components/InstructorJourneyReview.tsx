import { useCallback, useEffect, useState } from 'react';
import { Check, ChevronDown, ChevronUp, Loader2, RotateCw, X } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { InstructorJourneyImport } from './InstructorJourneyImport';

type ReviewCharacter = { slug: string; displayName: string; ready: boolean };
type StageCount = { stage: number; pending: number; approved: number; rejected: number; discontinued: number };
type ReviewQuestion = {
  id: string;
  question_stage: number;
  question_type: string;
  question_text: string;
  options: string[];
  correct_answer: string;
  accepted_answers: string[];
  explanation: string | null;
  source_reference: string | null;
  source_kind: string;
  answer_key_text: string | null;
  source_number: number | null;
  source_question_page: number | null;
  source_answer_page: number | null;
  review_status: 'pending' | 'approved' | 'rejected';
  review_note: string | null;
  question_set_name: string;
  retired_at: string | null;
};
type ReviewPage = {
  character: ReviewCharacter & { narrativeBeats: string[] };
  sets: { name: string; total: number }[];
  counts: StageCount[];
  total: number;
  questions: ReviewQuestion[];
};

const PAGE_SIZE = 20;

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'The question review could not be updated.';
}

export function InstructorJourneyReview({ defaultOpen = false }: { defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const [characters, setCharacters] = useState<ReviewCharacter[]>([]);
  const [slug, setSlug] = useState('');
  const [stage, setStage] = useState<number | null>(null);
  const [status, setStatus] = useState<'pending' | 'approved' | 'rejected' | 'discontinued' | 'all'>('pending');
  const [setName, setSetName] = useState('');
  const [offset, setOffset] = useState(0);
  const [page, setPage] = useState<ReviewPage | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const loadCharacters = useCallback(async () => {
    const { data, error: queryError } = await supabase.rpc('list_arena_journey_review_characters');
    if (queryError) throw queryError;
    const list = (data || []) as ReviewCharacter[];
    setCharacters(list);
    setSlug((current) => current || list[0]?.slug || '');
  }, []);

  const loadPage = useCallback(async () => {
    if (!slug) return;
    setLoading(true);
    try {
      const { data, error: queryError } = await supabase.rpc('get_arena_journey_bank_page', {
        p_slug: slug, p_stage: stage, p_status: status, p_set_name: setName || null,
        p_offset: offset, p_limit: PAGE_SIZE,
      });
      if (queryError) throw queryError;
      setPage(data as ReviewPage);
      setSelected([]);
      setError(null);
    } catch (loadError) {
      setError(errorMessage(loadError));
    } finally {
      setLoading(false);
    }
  }, [slug, stage, status, setName, offset]);

  useEffect(() => {
    if (!open) return;
    void loadCharacters().catch((loadError) => setError(errorMessage(loadError)));
  }, [open, loadCharacters]);

  useEffect(() => {
    if (open && slug) void loadPage();
  }, [open, slug, loadPage]);

  const decide = async (ids: string[], decision: 'approved' | 'rejected') => {
    if (!ids.length) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const { data, error: updateError } = await supabase.rpc('review_arena_journey_question_batch', {
        p_question_ids: ids, p_status: decision, p_note: null,
      });
      if (updateError) throw updateError;
      const outcome = data as { reviewed: number; approved: number; rejected: number };
      setNotice(`${outcome.reviewed} reviewed: ${outcome.approved} approved, ${outcome.rejected} rejected${decision === 'approved' && outcome.rejected ? ' (exact duplicates are rejected)' : ''}.`);
      await loadPage();
      await loadCharacters();
    } catch (updateError) {
      setError(errorMessage(updateError));
    } finally {
      setBusy(false);
    }
  };

  const setCharacterReady = async (ready: boolean) => {
    if (!slug) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const { error: updateError } = await supabase.rpc('set_arena_journey_character_ready', {
        p_slug: slug, p_ready: ready,
      });
      if (updateError) throw updateError;
      setNotice(ready ? 'This character is now available for Arena matches.' : 'New matches for this character are paused.');
      await loadPage();
      await loadCharacters();
    } catch (updateError) {
      setError(errorMessage(updateError));
    } finally {
      setBusy(false);
    }
  };

  const setRetired = async (question: ReviewQuestion, retired: boolean) => {
    if (retired && page?.character.ready && (page.counts.find((count) => count.stage === question.question_stage)?.approved || 0) <= 10
      && !window.confirm('This stage would fall below ten active questions, so new matches for this volume will pause. Discontinue anyway?')) return;
    setBusy(true); setError(null); setNotice(null);
    try {
      const { error: updateError } = await supabase.rpc('set_arena_journey_question_retired', {
        p_question_id: question.id, p_retired: retired,
      });
      if (updateError) throw updateError;
      setNotice(retired ? 'Question discontinued for new matches.' : 'Question restored to the playable bank.');
      await loadPage();
      await loadCharacters();
    } catch (updateError) { setError(errorMessage(updateError)); }
    finally { setBusy(false); }
  };

  const totalApproved = page?.counts.reduce((sum, count) => sum + count.approved, 0) || 0;
  const canActivate = Boolean(page?.counts.length === 5 && page.counts.every((count) => count.approved >= 10));
  const visiblePending = page?.questions.filter((question) => question.review_status === 'pending') || [];
  const allVisibleSelected = visiblePending.length > 0 && visiblePending.every((question) => selected.includes(question.id));

  return <section className="border-t border-border py-4">
    <button type="button" aria-expanded={open} onClick={() => setOpen((value) => !value)} className="flex w-full items-center justify-between gap-3 text-left font-display text-sm font-semibold text-ink">
      <span>Biblical Journey Questions</span>{open ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
    </button>
    {open && <div className="mt-4 space-y-4">
      {characters.length > 0 && <div className="flex flex-wrap items-end gap-3">
        <label className="min-w-[10rem] flex-1 text-xs text-stone">Character
          <select className="input-field mt-1" value={slug} onChange={(event) => { setSlug(event.target.value); setSetName(''); setOffset(0); }}>
            {characters.map((character) => <option key={character.slug} value={character.slug}>{character.displayName}</option>)}
          </select>
        </label>
        <label className="min-w-[8rem] flex-1 text-xs text-stone">Set
          <select className="input-field mt-1" value={setName} onChange={(event) => { setSetName(event.target.value); setOffset(0); }}>
            <option value="">All sets</option>{page?.sets.map((set) => <option key={set.name} value={set.name}>{set.name} ({set.total})</option>)}
          </select>
        </label>
        <label className="min-w-[8rem] flex-1 text-xs text-stone">Stage
          <select className="input-field mt-1" value={stage ?? 'all'} onChange={(event) => { setStage(event.target.value === 'all' ? null : Number(event.target.value)); setOffset(0); }}>
            <option value="all">All stages</option>
            {[1, 2, 3, 4, 5].map((number) => <option key={number} value={number}>Stage {number}</option>)}
          </select>
        </label>
        <label className="min-w-[8rem] flex-1 text-xs text-stone">Review
          <select className="input-field mt-1" value={status} onChange={(event) => { setStatus(event.target.value as typeof status); setOffset(0); }}>
            <option value="pending">Pending</option><option value="approved">Approved</option>
            <option value="rejected">Rejected</option><option value="discontinued">Discontinued</option><option value="all">All</option>
          </select>
        </label>
        <button type="button" title="Refresh questions" aria-label="Refresh questions" className="btn-secondary h-10 w-10 p-0" onClick={() => void loadPage()} disabled={loading}><RotateCw size={16} /></button>
      </div>}

      {slug && <InstructorJourneyImport key={slug} slug={slug} onImported={async () => { setStatus('pending'); setSetName(''); setOffset(0); await loadPage(); }} />}

      {page && <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-stone">
        {page.counts.map((count) => <span key={count.stage} className={count.approved >= 10 ? 'text-sage' : ''}>
          Stage {count.stage}: {count.approved} active · {count.pending} pending{count.discontinued ? ` · ${count.discontinued} discontinued` : ''}
        </span>)}
      </div>}
      {page && <div className="flex flex-wrap items-center gap-2 border-y border-border py-3 text-xs text-stone">
        <strong className="text-ink">{page.character.displayName}</strong>
        <span>{totalApproved} approved</span>
        <span>{page.character.ready ? 'Ready for matches' : 'Not yet playable'}</span>
        <button type="button" className="btn-secondary ml-auto text-xs" disabled={busy || (!canActivate && !page.character.ready)}
          onClick={() => void setCharacterReady(!page.character.ready)}>
          {page.character.ready ? 'Pause character' : 'Make playable'}
        </button>
      </div>}

      {visiblePending.length > 0 && <div className="flex flex-wrap items-center gap-2">
        <label className="mr-auto flex items-center gap-2 text-xs text-stone"><input type="checkbox" checked={allVisibleSelected}
          onChange={(event) => setSelected(event.target.checked ? visiblePending.map((question) => question.id) : [])} /> Select page</label>
        <button type="button" className="btn-secondary text-xs" disabled={busy || !selected.length} onClick={() => void decide(selected.slice(0, 25), 'rejected')}><X size={14} /> Reject selected</button>
        <button type="button" className="btn-primary text-xs" disabled={busy || !selected.length} onClick={() => void decide(selected.slice(0, 25), 'approved')}><Check size={14} /> Approve selected</button>
      </div>}

      {loading && <div className="flex justify-center py-6"><Loader2 className="animate-spin text-brass" size={20} /></div>}
      {!loading && page?.questions.map((question) => <article key={question.id} className="border-b border-border pb-4 text-sm text-ink">
        <div className="mb-2 flex items-start gap-2">
          {question.review_status === 'pending' && <input type="checkbox" className="mt-1" aria-label={`Select question ${question.source_number ?? question.id}`}
            checked={selected.includes(question.id)} onChange={(event) => setSelected((current) => event.target.checked ? [...current, question.id] : current.filter((id) => id !== question.id))} />}
          <div className="min-w-0 flex-1">
            <p className="text-xs text-stone">{question.question_set_name} · Stage {question.question_stage} · {question.question_type.replace(/_/g, ' ')} · #{question.source_number ?? 'new'} · {question.retired_at ? 'discontinued' : question.review_status}</p>
            <p className="mt-1 whitespace-pre-wrap font-medium">{question.question_text}</p>
            {question.options.length > 0 && <ol className="mt-2 list-inside list-decimal space-y-1 text-xs text-stone">
              {question.options.map((option, index) => <li key={`${index}-${option}`}>{option}</li>)}
            </ol>}
            <p className="mt-2 text-xs"><strong>Answer:</strong> {question.correct_answer}</p>
            {question.answer_key_text && <p className="mt-1 text-xs text-stone"><strong>Source answer key:</strong> {question.answer_key_text}</p>}
            {question.accepted_answers.length > 0 && <p className="mt-1 text-xs text-stone">Also accepted: {question.accepted_answers.join(', ')}</p>}
            <p className="mt-1 text-xs text-stone">{question.source_reference || 'No reference'} · {question.source_kind.replace(/-/g, ' ')}
              {question.source_question_page ? ` · question page ${question.source_question_page}` : ''}
              {question.source_answer_page ? ` · answer page ${question.source_answer_page}` : ''}</p>
            {question.explanation && <p className="mt-1 text-xs text-stone">{question.explanation}</p>}
            {question.review_note && <p className="mt-1 text-xs text-coral">{question.review_note}</p>}
          </div>
        </div>
        {question.review_status === 'pending' && <div className="flex justify-end gap-2">
          <button type="button" className="btn-secondary text-xs" disabled={busy} onClick={() => void decide([question.id], 'rejected')}><X size={14} /> Reject</button>
          <button type="button" className="btn-primary text-xs" disabled={busy} onClick={() => void decide([question.id], 'approved')}><Check size={14} /> Approve</button>
        </div>}
        {question.review_status === 'approved' && <div className="flex justify-end">
          <button type="button" className="btn-secondary text-xs" disabled={busy} onClick={() => void setRetired(question, !question.retired_at)}>
            {question.retired_at ? 'Restore question' : 'Discontinue question'}
          </button>
        </div>}
      </article>)}
      {!loading && page?.questions.length === 0 && <p className="py-4 text-sm text-stone">No questions in this view.</p>}
      {page && page.total > PAGE_SIZE && <div className="flex items-center justify-between text-xs text-stone">
        <button type="button" className="btn-secondary text-xs" disabled={loading || offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}>Previous</button>
        <span>{offset + 1}-{Math.min(offset + PAGE_SIZE, page.total)} of {page.total}</span>
        <button type="button" className="btn-secondary text-xs" disabled={loading || offset + PAGE_SIZE >= page.total} onClick={() => setOffset(offset + PAGE_SIZE)}>Next</button>
      </div>}
      {notice && <p className="text-xs text-sage" role="status">{notice}</p>}
      {error && <p className="text-xs text-coral" role="alert">{error}</p>}
    </div>}
  </section>;
}
