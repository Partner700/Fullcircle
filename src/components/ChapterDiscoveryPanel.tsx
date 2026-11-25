import { ChevronDown, Lightbulb } from 'lucide-react';
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

export function ChapterDiscoveryPanel({ facts, title = 'Did You Know?' }: {
  facts: ScriptureDidYouKnow[]; title?: string;
}) {
  if (!facts.length) return null;
  return <details key={facts.map(fact => fact.reference).join("|")} aria-label="Did You Know verse discoveries"
    className="group my-2 rounded-xl border border-sky-500/40 bg-surface/90">
    <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 font-display text-sm font-bold text-ink [&::-webkit-details-marker]:hidden">
      <Lightbulb className="text-brass" size={17}/> {title}
      <ChevronDown aria-hidden="true" size={16} className="ml-auto shrink-0 text-brass transition-transform group-open:rotate-180" />
    </summary>
    <div className="space-y-3 px-3 pb-3">
    {facts.map((fact, index) => <div key={`${fact.reference}-${index}`}
      className="rounded-xl border border-border bg-surface-2 px-3 py-3">
      <p className="mb-1 text-[10px] font-black uppercase tracking-widest text-brass">
        {CATEGORY_LABELS[fact.category || 'scripture_detail'] || 'Verse discovery'} · {fact.reference}
      </p>
      <p className="text-sm leading-relaxed text-ink">{fact.fact}</p>
    </div>)}
    </div>
  </details>;
}
