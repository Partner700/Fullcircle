import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { BookOpenText, ChevronDown, Gift, Landmark, Lightbulb, Sparkles } from 'lucide-react';
import { supabase } from '../lib/supabase';

export type InstructorVerseContext = {
  reference: string;
  historical_context: string;
  lexical_note?: string | null;
  evidence_note?: string | null;
  source_titles?: string[] | null;
  spiritual_context: string;
  present_day_context: string;
  research_note: string;
  source_links: string[] | null;
};

export type QuarterlyVerseQuest = {
  id: string;
  reference: string;
  question: string;
  choices: string[];
  prize_label?: string;
  attempted: boolean;
};

export type ScriptureDidYouKnow = {
  reference: string; fact: string; source_note: string;
  category?: 'plain_language' | 'ancient_culture' | 'scholarly_agreement' | 'scholarly_debate' |
    'earliest_evidence' | 'original_language' | 'scripture_detail' | 'textual_connection';
};
const FACT_LABELS: Record<NonNullable<ScriptureDidYouKnow['category']>, string> = {
  plain_language: 'In today\'s words',
  ancient_culture: 'Life in Bible times',
  scholarly_agreement: 'What scholars agree on',
  scholarly_debate: 'What scholars debate',
  earliest_evidence: 'Earliest discoveries',
  original_language: 'Original-language clue',
  scripture_detail: 'A detail worth noticing',
  textual_connection: 'A surprising connection',
};

export function useInstructorVerseExtras(references: string[]) {
  // This stable scalar prevents querying again on every verse render.
  const key = references.filter(Boolean).join('|');
  const [version, setVersion] = useState(0);
  const [contexts, setContexts] = useState<Record<string, InstructorVerseContext>>({});
  const [facts, setFacts] = useState<Record<string, ScriptureDidYouKnow>>({});
  const [quests, setQuests] = useState<Record<string, QuarterlyVerseQuest>>({});
  const [error, setError] = useState('');
  const refresh = useCallback(() => setVersion(value => value + 1), []);
  const verseRefs = useMemo(() => key.split('|').filter(Boolean), [key]);

  useEffect(() => {
    let active = true;
    setContexts({});
    setFacts({});
    setQuests({});
    setError('');
    if (!verseRefs.length) return () => { active = false; };
    void (async () => {
      const [contextResult, questResult, factsResult] = await Promise.allSettled([
        supabase.from('instructor_verse_contexts')
          .select('reference,historical_context,lexical_note,evidence_note,source_titles,spiritual_context,present_day_context,research_note,source_links')
          .eq('edition', 2)
          .in('reference', verseRefs.slice(0, 180)),
        supabase.rpc('get_quarterly_verse_quests', { p_references: verseRefs.slice(0, 180) }),
        supabase.from('scripture_did_you_know').select('reference,fact,source_note,category').in('reference', verseRefs.slice(0, 180)),
      ]);
      if (!active) return;
      if (contextResult.status === 'fulfilled' && !contextResult.value.error) {
        // A passage should not repeat the same generic commentary at every
        // verse. Keep the first matching verse in reading order for each insight.
        const byReference = new Map(((contextResult.value.data || []) as InstructorVerseContext[]).map(item => [item.reference, item]));
        const seen = new Set<string>();
        const selected: InstructorVerseContext[] = [];
        for (const reference of verseRefs) {
          const item = byReference.get(reference);
          if (!item) continue;
          const signature = [item.historical_context, item.spiritual_context, item.present_day_context].join('|');
          if (seen.has(signature)) continue;
          seen.add(signature);
          selected.push(item);
        }
        setContexts(Object.fromEntries(selected.map(item => [item.reference, item])));
      } else {
        setError('Instructor insights are temporarily unavailable.');
      }
      if (factsResult.status === 'fulfilled' && !factsResult.value.error) {
        setFacts(Object.fromEntries(((factsResult.value.data || []) as ScriptureDidYouKnow[]).map(item => [item.reference, item])));
      }
      if (questResult.status === 'fulfilled' && !questResult.value.error) {
        setQuests(Object.fromEntries(((questResult.value.data || []) as QuarterlyVerseQuest[])
          .map(item => [item.reference, item])));
      }
    })();
    return () => { active = false; };
  }, [verseRefs, version]);
  return { contexts, facts, quests, refresh, error };
}

// Individually verified artifact photographs. Load only on explicit opening.
const VERIFIED_DISCOVERY_IMAGES: Record<string, {file?:string; imageUrl?:string; pageUrl?:string; alt:string; credit:string; license:string; licenseUrl:string}> = {
  'Genesis 38:18': {"imageUrl":"https://collectionapi.metmuseum.org/api/collection/v1/iiif/327283/1668695/main-image","pageUrl":"https://www.metmuseum.org/art/collection/search/327283","alt":"Old Babylonian cylinder seal and modern impression, 18th–17th century BCE (example of seal technology, not Judah's seal)","credit":"The Metropolitan Museum of Art, 1987.96.5","license":"Public Domain","licenseUrl":"https://www.metmuseum.org/about-the-met/policies-and-documents/open-access"},
  'John 5:2': {"file":"Jerusalem-Church-of-St-Anne-DZCA-1054.jpg","alt":"Excavated Pool of Bethesda, Jerusalem (present-day ruins)","credit":"Bukvoed","license":"CC BY 4.0","licenseUrl":"https://creativecommons.org/licenses/by/4.0/"},
  'John 18:29': {"file":"Dedicatory inscription found reused in the staircase of the theatre of Caesarea, the first and only mention of Pontius Pilates' name ever unearthed, 26-36 AD, Israel Museum, Jerusalem (15655925251).jpg","alt":"Photograph of the original Pilate inscription in the Israel Museum","credit":"Carole Raddato","license":"CC BY-SA 2.0","licenseUrl":"https://creativecommons.org/licenses/by-sa/2.0/"},
  '2 Chronicles 36:23': {file:'Cyrus_Cylinder_BM_ME90920.jpg', alt:'Cuneiform inscription on the Cyrus Cylinder, British Museum', credit:'Marie-Lan Nguyen (Jastrow)', license:'CC BY 2.5', licenseUrl:'https://creativecommons.org/licenses/by/2.5/'},
  'Acts 21:28': {file:'Temple_Warning_Inscription_from_Jerusalem_Istanbul_Archaeology_Museums.jpg', alt:'Greek warning inscription from the Jerusalem Temple, Istanbul Archaeology Museums', credit:'Yong Woo Park (Ywpark2003)', license:'CC0 1.0', licenseUrl:'https://creativecommons.org/publicdomain/zero/1.0/'},
};
function VerifiedDiscoveryImage({reference}:{reference:string}) {
  const entry = VERIFIED_DISCOVERY_IMAGES[reference];
  const [failed, setFailed] = useState(false);
  if (!entry) return null;
  const filePage = entry.pageUrl ?? ('https://commons.wikimedia.org/wiki/File:' + encodeURIComponent(entry.file ?? ''));
  const imageUrl = entry.imageUrl ?? ('https://commons.wikimedia.org/wiki/Special:FilePath/' + encodeURIComponent(entry.file ?? '') + '?width=640');
  return <figure className="my-3 overflow-hidden rounded-lg border border-border">
    {!failed && <a href={filePage} target="_blank" rel="noopener noreferrer">
      <img src={imageUrl} alt={entry.alt} loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setFailed(true)} className="max-h-64 w-full object-contain" />
    </a>}
    <figcaption className="p-2 text-xs leading-relaxed text-stone"><a href={filePage} target="_blank" rel="noopener noreferrer" className="underline">{entry.alt}</a> · {entry.credit} · <a href={entry.licenseUrl} target="_blank" rel="noopener noreferrer" className="underline">{entry.license}</a> · Unmodified image, scaled for display</figcaption>
  </figure>;
}

export function InstructorVerseExtras({ context, fact, quest, onClaimed }: {
  context?: InstructorVerseContext;
  fact?: ScriptureDidYouKnow;
  quest?: QuarterlyVerseQuest;
  onClaimed?: () => void;
}) {
  const [discoveryOpen, setDiscoveryOpen] = useState(false);
  const [showQuestion, setShowQuestion] = useState(false);
  const [selected, setSelected] = useState('');
  const [sending, setSending] = useState(false);
  const [answerMessage, setAnswerMessage] = useState('');
  const [won, setWon] = useState<{ prize: string; message: string; explanation?: string; fcx_registered?: boolean } | null>(null);

  const submit = async () => {
    if (!quest || !selected || sending || quest.attempted) return;
    setSending(true);
    setAnswerMessage('');
    try {
      const { data, error } = await supabase.rpc('answer_quarterly_verse_quest', {
        p_quest_id: quest.id, p_answer: selected,
      });
      if (error) throw error;
      if (data?.status === 'won') {
        setWon({ prize: String(data.prize || 'Your Scripture reward'), message: String(data.message || 'You found it!'),
          explanation: String(data.explanation || ''), fcx_registered: Boolean(data.fcx_registered) });
        return;
      }
      setAnswerMessage(String(data?.message || 'This discovery is no longer available.'));
      if (data?.status !== 'incorrect') onClaimed?.();
    } catch (cause) {
      setAnswerMessage(cause instanceof Error ? cause.message : 'The answer could not be recorded. Try again.');
    } finally {
      setSending(false);
    }
  };

  const historicalIsSupported = Boolean(context?.evidence_note || context?.lexical_note);
  const allThreeAreUseful = historicalIsSupported && (context?.source_titles?.length || 0) >= 2
    && Boolean(context?.present_day_context?.trim());
  const insightSections = context ? ([
    ...(historicalIsSupported ? [['Historical context', context.historical_context, Landmark] as const] : []),
    ...(context.spiritual_context?.trim() ? [['Spiritual context', context.spiritual_context, Lightbulb] as const] : []),
    ...((!historicalIsSupported || allThreeAreUseful) && context.present_day_context?.trim()
      ? [['Psychosocial / Present-day context', context.present_day_context, Sparkles] as const] : []),
  ]) : [];

  if (!context && !fact && !quest) return null;
  return <>
    <div className="my-3 space-y-2 rounded-xl border border-amber-400/40 bg-surface/95 p-3">
      {context && <details className="group/insights rounded-lg border border-amber-400/40 bg-surface-2">
        <summary className="flex cursor-pointer items-center gap-2 rounded-lg px-3 py-3 text-xs font-bold uppercase tracking-widest text-brass">
          <BookOpenText size={15} className="shrink-0" />
          <span className="flex-1">Instructor Insights</span>
          <ChevronDown size={16} className="shrink-0 transition-transform group-open/insights:rotate-180" />
        </summary>
        <div className="space-y-2 border-t border-border px-3 pb-3 pt-2">
          <p className="text-xs leading-relaxed text-stone">Only the most useful context for this verse is shown. Other sections appear when they add something distinct.</p>
        {insightSections.map(([title, content, Icon]) => (
          <details key={title} className="group/context overflow-hidden rounded-lg border border-border bg-surface-2">
            <summary className="flex cursor-pointer items-center gap-2 px-3 py-2.5 text-sm font-semibold text-ink">
              <Icon size={16} className="shrink-0 text-brass" />
              <span className="flex-1">{title}</span>
              <ChevronDown size={15} className="transition-transform group-open/context:rotate-180" />
            </summary>
            <div className="border-t border-border px-3 py-3">
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-ink">{content}</p>
              {title === 'Historical context' && <>
                {context.lexical_note && <section className="mt-3 rounded-lg border border-brass/30 bg-surface p-3">
                  <p className="text-[11px] font-bold uppercase tracking-wider text-brass">Original language • Hebrew / Greek / Latin</p>
                  <p className="mt-1 text-sm leading-relaxed text-ink">{context.lexical_note}</p>
                </section>}
                {context.evidence_note && <section className="mt-3 rounded-lg border border-border bg-surface/70 p-3">
                  <p className="text-[11px] font-bold uppercase tracking-wider text-brass">What the evidence establishes</p>
                  <p className="mt-1 text-xs leading-relaxed text-stone">{context.evidence_note}</p>
                </section>}
                {/* Evidence notes and the original-language gloss replace the generic, repetitive source disclaimer. */}
                {Array.isArray(context.source_links) && context.source_links.length > 0 && (
                  <p className="mt-2 text-xs text-stone">Further background: {context.source_links.slice(0, 3).map((link, index) => (
                    <a key={link} href={link} target="_blank" rel="noopener noreferrer"
                      className="mr-2 underline underline-offset-2">{(() => {
                        try { return new URL(link).hostname.replace(/^www\./, ''); }
                        catch { return `Source ${index + 1}`; }
                      })()}</a>
                  ))}</p>
                )}
              </>}
              {title === 'Spiritual context' && Array.isArray(context.source_titles) && context.source_titles.length > 0 && (
                <div className="mt-3 border-t border-border pt-2">
                  <p className="text-[11px] font-bold uppercase tracking-wider text-brass">Related reading</p>
                  <ul className="mt-1 space-y-1 text-xs leading-relaxed text-stone">
                    {context.source_titles.map(source => <li key={source}>{source}</li>)}
                  </ul>
                  <p className="mt-2 text-xs italic text-stone">Original Instructor synthesis; not a quotation from these authors.</p>
                </div>
              )}
            </div>
          </details>
        ))}
        </div>
      </details>}
      {fact && <details onToggle={event => setDiscoveryOpen(event.currentTarget.open)} className="rounded-lg border border-sky-500/40 bg-surface-2">
        <summary className="flex cursor-pointer items-center gap-2 px-3 py-3 text-sm font-bold text-ink">
          <Lightbulb size={16} className="text-brass" /> Did You Know? <ChevronDown size={15} className="ml-auto" />
        </summary>
        <div className="border-t border-border px-3 py-3">
          <p className="mb-2 text-[10px] font-black uppercase tracking-widest text-brass">{FACT_LABELS[fact.category || 'scripture_detail']}</p>
          <p className="text-sm leading-relaxed text-ink">{fact.fact}</p>
          {discoveryOpen && <VerifiedDiscoveryImage key={fact.reference} reference={fact.reference} />}
          <p className="mt-2 text-xs text-stone">{fact.source_note}</p>
        </div>
      </details>}
      {quest && <section className="rounded-lg border-2 border-yellow-500 bg-amber-100 p-3 text-slate-950">
        <div className="flex items-center gap-2 text-sm font-black"><Gift size={18} /> Hidden Scripture Discovery</div>
        <p className="mt-1 text-xs font-semibold">One attempt. The reward remains a mystery until the first correct answer.</p>
        {!showQuestion && !quest.attempted && <button type="button" className="mt-3 rounded-lg bg-slate-950 px-4 py-2 text-sm font-bold text-yellow-200"
          onClick={() => setShowQuestion(true)}>Open the discovery</button>}
        {quest.attempted && <p className="mt-2 text-xs">You already used your attempt for this discovery.</p>}
        {showQuestion && !quest.attempted && !won && <div className="mt-3 space-y-3">
          <p className="text-sm font-semibold">{quest.question}</p>
          <div className="grid gap-2">
            {(Array.isArray(quest.choices) ? quest.choices : []).map(choice => (
              <label key={choice} className="flex cursor-pointer items-center gap-2 rounded-lg border border-amber-500 bg-white p-2 text-sm">
                <input type="radio" name={'verse-discovery-' + quest.id} value={choice}
                  checked={selected === choice} disabled={sending} onChange={() => setSelected(choice)} /> {choice}
              </label>
            ))}
          </div>
          <button type="button" className="rounded-lg bg-slate-950 px-4 py-2 text-sm font-black text-yellow-200"
            disabled={!selected || sending || Boolean(answerMessage)} onClick={() => void submit()}>
            {sending ? 'Verifying your answer…' : 'Submit my answer'}
          </button>
        </div>}
        {answerMessage && <p className="mt-2 text-sm font-semibold" role="status">{answerMessage}</p>}
      </section>}
    </div>
    {won && createPortal(
      <div className="fixed inset-0 z-[10050] flex items-center justify-center overflow-y-auto bg-[#FFD447] p-5 text-[#171717]"
        role="dialog" aria-modal="true" aria-label="Scripture discovery reward">
        <div className="w-full max-w-md rounded-3xl border-4 border-[#161616] bg-[#FFF5A8] p-6 text-center shadow-2xl">
          <div className="mx-auto mb-3 flex h-20 w-20 items-center justify-center rounded-full bg-[#141414] text-[#FFDD35]">
            <Gift size={42} />
          </div>
          <p className="text-xs font-black uppercase tracking-[0.25em]">Full Circle • First finder</p>
          <h2 className="mt-3 text-3xl font-black">You found it!</h2>
          <p className="mt-3 text-base font-semibold">{won.message}</p>
          <p className="mt-4 rounded-xl bg-[#161616] px-4 py-4 text-xl font-black text-[#FFE95B]">{won.prize}</p>
          {won.explanation && <p className="mt-3 text-sm leading-relaxed">{won.explanation}</p>}
          <button className="mt-6 w-full rounded-xl bg-[#141414] px-5 py-3 text-base font-black text-[#FFE95B]"
            onClick={() => { setWon(null); onClaimed?.(); }} type="button">Continue reading</button>
        </div>
      </div>, document.body
    )}
  </>;
}
