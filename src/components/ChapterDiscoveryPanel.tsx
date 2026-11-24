import { Lightbulb } from 'lucide-react';
import type { ScriptureDidYouKnow } from './InstructorVerseExtras';

const CATEGORY_LABELS: Record<string,string> = {
  plain_language: "In today's words",
  ancient_culture: "Life in Bible times",
  scholarly_agreement: "What scholars agree on",
  scholarly_debate: "What scholars debate",
  earliest_evidence: "Earliest discoveries",
  original_language: "Original-language clue",
  scripture_detail: "Notice something",
  textual_connection: "A connection worth seeing",
};

export function ChapterDiscoveryPanel({ facts, title = 'Did You Know? — Chapter discoveries' }: {
  facts: ScriptureDidYouKnow[]; title?: string;
}) {
  if (!facts.length) return null;
  return <section aria-label="Did You Know chapter discoveries"
    className="mb-5 space-y-3 rounded-2xl border border-sky-500/40 bg-surface/90 px-4 py-4">
    <h3 className="flex items-center gap-2 font-display text-base font-bold text-ink">
      <Lightbulb className="text-brass" size={19}/> {title}
    </h3>
    <p className="text-xs text-stone">These discoveries come straight from the wording of this chapter in your selected Bible edition. Researched historical and scholarly facts are shown separately beside their verses.</p>
    {facts.map((fact, index) => <div key={`${fact.reference}-${index}`}
      className="rounded-xl border border-border bg-surface-2 px-3 py-3">
      <p className="mb-1 text-[10px] font-black uppercase tracking-widest text-brass">
        {CATEGORY_LABELS[fact.category || 'scripture_detail'] || 'Chapter discovery'} · {fact.reference}
      </p>
      <p className="text-sm leading-relaxed text-ink">{fact.fact}</p>
    </div>)}
  </section>;
}
