import { useRef, useState } from 'react';
import { CheckCircle2, ChevronDown, ChevronUp, Clipboard, FileUp, Loader2, ScanSearch } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { userFacingError } from '../lib/connectionErrors';
import { validateJourneyQuestionSet, type JourneyImportQuestion, type JourneyRejectedQuestion } from '../lib/journeyQuestionImport';

type Props = { slug: string; onImported: () => Promise<void> };

const example = JSON.stringify({ questions: [{
  type: 'multiple_choice', question: 'Who called Samuel by name at night?',
  options: ['Eli', 'The Lord', 'Saul', 'David'], correct_answer: 'The Lord',
  reference: '1 Samuel 3:4', explanation: 'The Lord called Samuel.', difficulty_tag: 'easy',
}] }, null, 2);

export function InstructorJourneyImport({ slug, onImported }: Props) {
  const [open, setOpen] = useState(true);
  const [name, setName] = useState('');
  const [source, setSource] = useState('');
  const [preview, setPreview] = useState<JourneyImportQuestion[] | null>(null);
  const [rejected, setRejected] = useState<JourneyRejectedQuestion[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const validate = () => {
    setError(null); setNotice(null); setPreview(null); setRejected([]);
    try {
      const result = validateJourneyQuestionSet(source);
      setPreview(result.questions);
      setRejected(result.rejected);
      if (!result.questions.length) setError('No usable questions were found. Check the issues below and try again.');
    }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not validate this set.'); }
  };
  const importSet = async () => {
    if (busy) return;
    let questions = preview;
    let skipped = rejected;
    if (!questions) {
      try {
        const result = validateJourneyQuestionSet(source);
        questions = result.questions; skipped = result.rejected;
        setPreview(questions); setRejected(skipped);
      } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not check this set.'); return; }
    }
    if (!questions.length) { setError('No usable questions were found. Check the issues below.'); return; }
    if (name.trim() && name.trim().length < 2) { setError('Use at least two letters for the set name, or leave it blank.'); return; }
    setBusy(true); setError(null); setNotice(null);
    try {
      const uploadedSetName = name.trim() || `Upload ${new Date().toISOString().slice(0, 19).replace('T', ' ')}`;
      const { data, error: updateError } = await supabase.rpc('append_arena_journey_question_set', {
        p_slug: slug, p_set_name: uploadedSetName, p_questions: questions,
      });
      if (updateError) throw updateError;
      const result = data as { imported: number; skipped: number; invalid?: number; active?: number; ready?: boolean };
      setNotice(`${uploadedSetName}: ${result.imported} questions added. ${result.skipped} duplicates skipped. ${skipped.length + (result.invalid || 0)} invalid questions skipped. ${result.ready ? 'Ready for matches.' : `${result.active || 0}/200 active questions.`}`);
      if (!skipped.length && !result.invalid) setSource('');
      setPreview(null);
      await onImported();
    } catch (cause) {
      setError(userFacingError(cause, 'The question set could not be imported. Please try again.'));
    } finally { setBusy(false); }
  };
  const readFile = async (file?: File) => {
    if (!file) return;
    if (file.size > 2_000_000) { setError('Choose a JSON file smaller than 2 MB.'); return; }
    try { setSource(await file.text()); setPreview(null); setRejected([]); setError(null); setNotice(file.name); }
    catch { setError('The file could not be read.'); }
  };

  return <section className="border-y border-border py-3">
    <button type="button" className="flex w-full items-center justify-between gap-2 text-left text-sm font-semibold text-ink" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
      <span>Import question set</span>{open ? <ChevronUp size={17} /> : <ChevronDown size={17} />}
    </button>
    {open && <div className="mt-3 space-y-3">
      <label className="block text-xs text-stone">Set name (optional)<input className="input-field mt-1" maxLength={80} value={name} disabled={busy} onChange={(event) => setName(event.target.value)} placeholder="e.g. Elijah: The Carmel challenge" /></label>
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn-secondary text-xs" onClick={() => void navigator.clipboard.writeText(example).then(() => setNotice('Format copied.')).catch(() => setError('Could not copy the format.'))}><Clipboard size={14} /> Copy format</button>
        <button type="button" className="btn-secondary text-xs" disabled={busy} onClick={() => fileRef.current?.click()}><FileUp size={14} /> Open JSON</button>
        <input ref={fileRef} type="file" accept=".json,.txt,application/json,text/plain" className="hidden" onChange={(event) => { void readFile(event.target.files?.[0]); event.target.value = ''; }} />
      </div>
      <textarea aria-label="Question set JSON" className="input-field min-h-40 resize-y font-mono text-xs" value={source} disabled={busy} onChange={(event) => { setSource(event.target.value); setPreview(null); setRejected([]); setError(null); setNotice(null); }} spellCheck={false} placeholder="Paste a JSON question set" />
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn-primary text-xs" disabled={busy || !source.trim()} onClick={() => void importSet()}>{busy ? <Loader2 size={15} className="animate-spin" /> : <CheckCircle2 size={15} />} Import questions</button>
        <button type="button" className="btn-secondary text-xs" disabled={busy || !source.trim()} onClick={validate}><ScanSearch size={14} /> Preview</button>
      </div>
      {preview && preview.length > 0 && <div className="space-y-2 border-t border-border pt-3">
        <div className="flex flex-wrap gap-2 text-xs text-stone"><strong className="text-ink">{preview.length} valid questions</strong>{[1, 2, 3, 4, 5].map((stage) => <span key={stage}>Stage {stage}: {preview.filter((item) => item.stage === stage).length}</span>)}</div>
        <div className="max-h-48 overflow-y-auto border-y border-border text-xs text-ink">{preview.map((item, index) => <p key={`${index}-${item.question}`} className="border-b border-border py-2"><span className="text-brass">{index + 1}. Stage {item.stage}</span> · {item.question}</p>)}</div>
      </div>}
      {rejected.length > 0 && <div className="border-t border-border pt-3 text-xs" role="status">
        <p className="font-semibold text-coral">{rejected.length} questions skipped. The original JSON remains above so you can correct them.</p>
        <div className="mt-1 max-h-40 overflow-y-auto text-stone">{rejected.map((item) => <p key={item.number} className="border-b border-border py-1">{item.reason}</p>)}</div>
      </div>}
      {notice && <p className="text-xs text-sage" role="status">{notice}</p>}
      {error && <p className="text-xs text-coral" role="alert">{error}</p>}
    </div>}
  </section>;
}
