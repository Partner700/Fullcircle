import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { BookOpenText, ChevronDown, Gift, Landmark, Lightbulb, Sparkles, X } from 'lucide-react';
import { supabase } from '../lib/supabase';

export type InstructorVerseContext = {
  reference: string;
  historical_context: string;
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
  prize_label: string;
  attempted: boolean;
};

export function useInstructorVerseExtras(references: string[]) {
  // This stable scalar prevents querying again on every verse render.
  const key = references.filter(Boolean).join('|');
  const [version, setVersion] = useState(0);
  const [contexts, setContexts] = useState<Record<string, InstructorVerseContext>>({});
  const [quests, setQuests] = useState<Record<string, QuarterlyVerseQuest>>({});
  const [error, setError] = useState('');
  const refresh = useCallback(() => setVersion(value => value + 1), []);
  const verseRefs = useMemo(() => key.split('|').filter(Boolean), [key]);

  useEffect(() => {
    let active = true;
    setContexts({});
    setQuests({});
    setError('');
    if (!verseRefs.length) return () => { active = false; };
    void (async () => {
      const [contextResult, questResult] = await Promise.allSettled([
        supabase.from('instructor_verse_contexts')
          .select('reference,historical_context,spiritual_context,present_day_context,research_note,source_links')
          .in('reference', verseRefs.slice(0, 180)),
        supabase.rpc('get_quarterly_verse_quests', { p_references: verseRefs.slice(0, 180) }),
      ]);
      if (!active) return;
      if (contextResult.status === 'fulfilled' && !contextResult.value.error) {
        setContexts(Object.fromEntries(((contextResult.value.data || []) as InstructorVerseContext[])
          .map(item => [item.reference, item])));
      } else {
        setError('Instructor insights are temporarily unavailable.');
      }
      if (questResult.status === 'fulfilled' && !questResult.value.error) {
        setQuests(Object.fromEntries(((questResult.value.data || []) as QuarterlyVerseQuest[])
          .map(item => [item.reference, item])));
      }
    })();
    return () => { active = false; };
  }, [verseRefs, version]);
  return { contexts, quests, refresh, error };
}

export function InstructorVerseExtras({ context, quest, onClaimed }: {
  context?: InstructorVerseContext;
  quest?: QuarterlyVerseQuest;
  onClaimed?: () => void;
}) {
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

  if (!context && !quest) return null;
  return <>
    <div className="my-3 space-y-2 rounded-xl border border-amber-400/40 bg-surface/95 p-3">
      {context && <>
        <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-brass">
          <BookOpenText size={15} /> Instructor Insights
        </div>
        <p className="text-xs leading-relaxed text-stone">Explore the setting, spiritual message and practical meaning of this passage.</p>
        {([
          ['Historical context', context.historical_context, Landmark],
          ['Spiritual context', context.spiritual_context, Lightbulb],
          ['Psychosocial / Present-day context', context.present_day_context, Sparkles],
        ] as const).map(([title, content, Icon]) => (
          <details key={title} className="group overflow-hidden rounded-lg border border-border bg-surface-2">
            <summary className="flex cursor-pointer items-center gap-2 px-3 py-2.5 text-sm font-semibold text-ink">
              <Icon size={16} className="shrink-0 text-brass" />
              <span className="flex-1">{title}</span>
              <ChevronDown size={15} className="transition-transform group-open:rotate-180" />
            </summary>
            <div className="border-t border-border px-3 py-3">
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-ink">{content}</p>
              {title === 'Historical context' && <>
                <p className="mt-3 text-xs leading-relaxed text-stone">{context.research_note}</p>
                {Array.isArray(context.source_links) && context.source_links.length > 0 && (
                  <p className="mt-2 text-xs text-stone">Further background: {context.source_links.slice(0, 3).map((link, index) => (
                    <a key={link} href={link} target="_blank" rel="noopener noreferrer"
                      className="mr-2 underline underline-offset-2">Source {index + 1}</a>
                  ))}</p>
                )}
              </>}
            </div>
          </details>
        ))}
      </>}
      {quest && <section className="rounded-lg border-2 border-yellow-500 bg-amber-100 p-3 text-slate-950">
        <div className="flex items-center gap-2 text-sm font-black"><Gift size={18} /> Hidden Scripture Discovery</div>
        <p className="mt-1 text-xs font-semibold">First correct answer wins: {quest.prize_label}.</p>
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
