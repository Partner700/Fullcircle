import { useRef, useState } from 'react';
import { CheckCircle2, ChevronDown, ChevronUp, Clipboard, FileUp, Loader2, ScanSearch } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { parseJourneyQuestionSet, type JourneyImportQuestion } from '../lib/journeyQuestionImport';

type Props = { slug: string; onImported: () => Promise<void> };

const example = JSON.stringify({ questions: [{
  stage: 1, type: 'multiple_choice', question: 'Who called Samuel by name at night?',
  options: ['Eli', 'The Lord', 'Saul', 'David'], correct_answer: 'The Lord',
  reference: '1 Samuel 3:4', explanation: 'The Lord called Samuel.', difficulty_tag: 'easy',
}] }, null, 2);

export function InstructorJourneyImport({ slug, onImported }: Props) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [source, setSource] = useState('');
  const [preview, setPreview] = useState<JourneyImportQuestion[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const validate = () => {
    setError(null); setNotice(null); setPreview(null);
    try { setPreview(parseJourneyQuestionSet(source)); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not validate this set.'); }
  };
  const importSet = async () => {
    if (!preview || busy) return;
    if (name.trim().length < 2 || name.trim().length > 80) { setError('Give this set a name of 2 to 80 characters.'); return; }
    setBusy(true); setError(null); setNotice(null);
    try {
      const { data, error: updateError } = await supabase.rpc('append_arena_journey_question_set', {
        p_slug: slug, p_set_name: name.trim(), p_questions: preview,
      });
      if (updateError) throw updateError;
      const result = data as { imported: number; skipped: number };
      setNotice(`${result.imported} questions added as pending; ${result.skipped} already in this volume.`);
      setSource(''); setPreview(null);
      await onImported();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The question set could not be imported.');
    } finally { setBusy(false); }
  };
  const readFile = async (file?: File) => {
    if (!file) return;
    if (file.size > 2_000_000) { setError('Choose a JSON file smaller than 2 MB.'); return; }
    try { setSource(await file.text()); setPreview(null); setError(null); setNotice(file.name); }
    catch { setError('The file could not be read.'); }
  };

  return <section className="border-y border-border py-3">
    <button type="button" className="flex w-full items-center justify-between gap-2 text-left text-sm font-semibold text-ink" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
      <span>Import question set</span>{open ? <ChevronUp size={17} /> : <ChevronDown size={17} />}
    </button>
    {open && <div className="mt-3 space-y-3">
      <label className="block text-xs text-stone">Set name<input className="input-field mt-1" maxLength={80} value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. Elijah: The Carmel challenge" /></label>
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn-secondary text-xs" onClick={() => void navigator.clipboard.writeText(example).then(() => setNotice('Format copied.')).catch(() => setError('Could not copy the format.'))}><Clipboard size={14} /> Copy format</button>
        <button type="button" className="btn-secondary text-xs" onClick={() => fileRef.current?.click()}><FileUp size={14} /> Open JSON</button>
        <input ref={fileRef} type="file" accept=".json,.txt,application/json,text/plain" className="hidden" onChange={(event) => { void readFile(event.target.files?.[0]); event.target.value = ''; }} />
      </div>
      <textarea className="input-field min-h-40 resize-y font-mono text-xs" value={source} onChange={(event) => { setSource(event.target.value); setPreview(null); setError(null); }} spellCheck={false} placeholder="Paste a JSON question set" />
      <button type="button" className="btn-secondary text-xs" disabled={!source.trim()} onClick={validate}><ScanSearch size={14} /> Validate set</button>
      {preview && <div className="space-y-2 border-t border-border pt-3">
        <div className="flex flex-wrap gap-2 text-xs text-stone"><strong className="text-ink">{preview.length} valid questions</strong>{[1, 2, 3, 4, 5].map((stage) => <span key={stage}>Stage {stage}: {preview.filter((item) => item.stage === stage).length}</span>)}</div>
        <div className="max-h-48 overflow-y-auto border-y border-border text-xs text-ink">{preview.map((item, index) => <p key={`${index}-${item.question}`} className="border-b border-border py-2"><span className="text-brass">{index + 1}. Stage {item.stage}</span> · {item.question}</p>)}</div>
        <button type="button" className="btn-primary text-xs" disabled={busy || name.trim().length < 2} onClick={() => void importSet()}>{busy ? <Loader2 size={15} className="animate-spin" /> : <CheckCircle2 size={15} />} Add {preview.length} pending questions</button>
      </div>}
      {notice && <p className="text-xs text-sage" role="status">{notice}</p>}
      {error && <p className="text-xs text-coral" role="alert">{error}</p>}
    </div>}
  </section>;
}
