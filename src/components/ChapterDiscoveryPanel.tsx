import { useState } from 'react';
import { ChevronDown, Lightbulb } from 'lucide-react';
import type { ScriptureDidYouKnow } from './InstructorVerseExtras';

const DISCOVERY_IMAGES: Record<string, {src:string;page:string;alt:string;credit:string}> = {"2 Kings 20:20":{"src":"https://commons.wikimedia.org/wiki/Special:FilePath/Siloam_inscription.jpg?width=640","page":"https://commons.wikimedia.org/wiki/File:Siloam_inscription.jpg","alt":"Siloam inscription displayed at Istanbul Archaeological Museums","credit":"Artifact photograph: oncenawhile, CC0 1.0"},"2 Samuel 7:16":{"src":"https://commons.wikimedia.org/wiki/Special:FilePath/Tel_dan_inscription.JPG?width=640","page":"https://commons.wikimedia.org/wiki/File:Tel_dan_inscription.JPG","alt":"Fragments of the Tel Dan Aramaic inscription","credit":"Artifact photograph: בית השלום, attribution licence"}};

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
  const [open, setOpen] = useState(false);
  if (!facts.length) return null;
  return <details onToggle={event => setOpen(event.currentTarget.open)} key={facts.map(fact => fact.reference).join("|")} aria-label="Did You Know verse discoveries"
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
      {open && DISCOVERY_IMAGES[fact.reference] && <figure className="mt-3"><a href={DISCOVERY_IMAGES[fact.reference].page} target="_blank" rel="noopener noreferrer"><img loading="lazy" decoding="async" referrerPolicy="no-referrer" className="mx-auto max-h-64 w-full rounded-lg object-contain" src={DISCOVERY_IMAGES[fact.reference].src} alt={DISCOVERY_IMAGES[fact.reference].alt} /></a><figcaption className="mt-1 text-xs text-stone">{DISCOVERY_IMAGES[fact.reference].credit} · <a className="underline" href={DISCOVERY_IMAGES[fact.reference].page} target="_blank" rel="noopener noreferrer">Image and licence</a></figcaption></figure>}
      <p className="mt-2 text-xs text-stone">{fact.source_note}</p>
    </div>)}
    </div>
  </details>;
}
