import { useMemo, useRef, useState } from 'react';
import {
  AlertTriangle, CheckCircle2, ChevronDown, ChevronUp, Clipboard, FileJson2,
  FileUp, Loader2, ScanSearch, XCircle,
} from 'lucide-react';
import { cn } from '../lib/utils';
import {
  parseQuestionImport, questionImportKey, questionImportPrompt,
  type ImportedQuestion, type QuestionImportDefaults, type QuestionImportDestination,
  type QuestionImportReport,
} from '../lib/questionImport';

type ImportResult = { imported: number; skipped?: number; message?: string };

interface QuestionImportPanelProps {
  destination: QuestionImportDestination;
  defaults: QuestionImportDefaults;
  existingPrompts: string[];
  onImport: (questions: ImportedQuestion[]) => Promise<ImportResult>;
}

export function QuestionImportPanel({ destination, defaults, existingPrompts, onImport }: QuestionImportPanelProps) {
  const [open, setOpen] = useState(false);
  const [source, setSource] = useState('');
  const [report, setReport] = useState<QuestionImportReport | null>(null);
  const [importing, setImporting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const existingKeys = useMemo(() => new Set(existingPrompts.map(questionImportKey)), [existingPrompts]);
  const destinationQuestions = useMemo(
    () => (report?.questions || []).filter((question) => question.destination === destination),
    [destination, report],
  );
  const newQuestions = useMemo(
    () => destinationQuestions.filter((question) => !existingKeys.has(questionImportKey(question.question))),
    [destinationQuestions, existingKeys],
  );
  const existingDuplicates = destinationQuestions.length - newQuestions.length;
  const otherDestinationCount = (report?.questions.length || 0) - destinationQuestions.length;
  const errors = report?.issues.filter((issue) => issue.severity === 'error') || [];
  const warnings = report?.issues.filter((issue) => issue.severity === 'warning') || [];

  const gameSegments = useMemo(() => {
    const counts = new Map<string, number>();
    newQuestions.forEach((question) => {
      const key = `Level ${question.level} / Round ${question.round}`;
      counts.set(key, (counts.get(key) || 0) + 1);
    });
    return Array.from(counts.entries());
  }, [newQuestions]);

  const analyse = () => {
    setNotice(null);
    setReport(parseQuestionImport(source, defaults));
  };

  const copyFormat = async () => {
    try {
      await navigator.clipboard.writeText(questionImportPrompt(destination));
      setNotice('Generation format copied.');
    } catch {
      setNotice('The format could not be copied on this device.');
    }
  };

  const readFile = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > 2_000_000) {
      setNotice('Choose a text file smaller than 2 MB.');
      return;
    }
    try {
      const text = await file.text();
      setSource(text);
      setReport(null);
      setNotice(file.name);
    } catch {
      setNotice('The selected file could not be read.');
    }
  };

  const importQuestions = async () => {
    if (newQuestions.length === 0 || importing) return;
    setImporting(true);
    setNotice(null);
    try {
      const result = await onImport(newQuestions);
      setNotice(result.message || `${result.imported} questions imported.`);
      setSource('');
      setReport(null);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'The question set could not be imported.');
    } finally {
      setImporting(false);
    }
  };

  return (
    <section className="overflow-hidden rounded-lg border border-border-bright bg-surface">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className="flex min-h-14 w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-surface-2"
        aria-expanded={open}
      >
        <span className="flex min-w-0 items-center gap-3">
          <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg border border-peri/25 bg-peri/10 text-peri">
            <FileJson2 size={18} />
          </span>
          <span className="min-w-0">
            <span className="block font-display text-sm font-semibold text-ink">Import Question Set</span>
            <span className="block truncate text-xs text-stone">
              {destination === 'quiz' ? 'Weekly Quiz' : 'Daily Trivia levels and rounds'}
            </span>
          </span>
        </span>
        {open ? <ChevronUp size={17} className="text-stone" /> : <ChevronDown size={17} className="text-stone" />}
      </button>

      {open && (
        <div className="space-y-4 border-t border-border-bright px-4 py-4 animate-fade-in">
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn-secondary text-xs" onClick={copyFormat}>
              <Clipboard size={14} /> Copy Generation Format
            </button>
            <button type="button" className="btn-secondary text-xs" onClick={() => fileRef.current?.click()}>
              <FileUp size={14} /> Open File
            </button>
            <input
              ref={fileRef}
              type="file"
              accept=".json,.txt,.md,application/json,text/plain,text/markdown"
              className="hidden"
              onChange={(event) => {
                void readFile(event.target.files?.[0]);
                event.target.value = '';
              }}
            />
          </div>

          <textarea
            value={source}
            onChange={(event) => { setSource(event.target.value); setReport(null); setNotice(null); }}
            className="input-field min-h-44 resize-y font-mono text-xs leading-relaxed"
            placeholder="Paste JSON or labelled questions"
            spellCheck={false}
          />

          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className="btn-primary text-xs" disabled={!source.trim()} onClick={analyse}>
              <ScanSearch size={14} /> Validate and Segment
            </button>
            {notice && <p className="text-xs font-medium text-stone">{notice}</p>}
          </div>

          {report && (
            <div className="space-y-3 border-t border-border pt-4">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <ImportMetric label="Ready" value={newQuestions.length} tone="ready" />
                <ImportMetric label="Invalid" value={errors.length} tone={errors.length ? 'error' : 'neutral'} />
                <ImportMetric label="Duplicates" value={existingDuplicates} tone="neutral" />
                <ImportMetric label="Other section" value={otherDestinationCount} tone="neutral" />
              </div>

              {destination === 'game' && gameSegments.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {gameSegments.map(([segment, count]) => (
                    <span key={segment} className="badge badge-neutral text-[10px]">{segment}: {count}</span>
                  ))}
                </div>
              )}

              {(errors.length > 0 || warnings.length > 0) && (
                <div className="max-h-40 space-y-1.5 overflow-y-auto rounded-lg border border-border bg-surface-2 p-3">
                  {[...errors, ...warnings].map((issue, index) => (
                    <p key={`${issue.severity}-${issue.sourceIndex}-${index}`} className={cn(
                      'flex items-start gap-2 text-xs',
                      issue.severity === 'error' ? 'text-coral' : 'text-gold',
                    )}>
                      {issue.severity === 'error'
                        ? <XCircle size={13} className="mt-0.5 flex-shrink-0" />
                        : <AlertTriangle size={13} className="mt-0.5 flex-shrink-0" />}
                      <span>{issue.message}</span>
                    </p>
                  ))}
                </div>
              )}

              {newQuestions.length > 0 && (
                <div className="max-h-72 divide-y divide-border overflow-y-auto rounded-lg border border-border bg-surface-2 px-3">
                  {newQuestions.map((question, index) => (
                    <div key={`${questionImportKey(question.question)}-${index}`} className="flex items-start gap-3 py-3">
                      <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full border border-border bg-surface text-[10px] font-semibold text-ink">
                        {index + 1}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="mb-1 flex flex-wrap gap-1">
                          <span className="badge badge-peri text-[9px]">{question.type.replace(/_/g, ' ')}</span>
                          <span className="badge badge-neutral text-[9px]">{question.difficulty}</span>
                          {question.destination === 'game' && <span className="badge badge-neutral text-[9px]">L{question.level} R{question.round}</span>}
                        </div>
                        <p className="text-xs font-semibold leading-snug text-ink">{question.question}</p>
                        <p className="mt-1 text-[11px] text-moss">{question.correctAnswer}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <button
                type="button"
                className="btn-primary w-full text-sm"
                disabled={newQuestions.length === 0 || importing}
                onClick={importQuestions}
              >
                {importing ? <Loader2 size={15} className="animate-spin" /> : <CheckCircle2 size={15} />}
                Import {newQuestions.length} {newQuestions.length === 1 ? 'Question' : 'Questions'}
              </button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function ImportMetric({ label, value, tone }: { label: string; value: number; tone: 'ready' | 'error' | 'neutral' }) {
  return (
    <div className={cn(
      'rounded-lg border px-3 py-2',
      tone === 'ready' && 'border-moss/30 bg-moss/10',
      tone === 'error' && 'border-coral/30 bg-coral/10',
      tone === 'neutral' && 'border-border bg-surface-2',
    )}>
      <p className="text-[10px] uppercase text-stone">{label}</p>
      <p className="font-display text-lg font-semibold text-ink">{value}</p>
    </div>
  );
}
