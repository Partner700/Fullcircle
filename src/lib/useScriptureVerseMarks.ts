import { useEffect, useMemo, useState } from 'react';
import { supabase } from './supabase';
import { canonicalBibleVerseReference } from './bibleBooks';

export const SCRIPTURE_QUESTION_RESOLVED_EVENT = 'full-circle:scripture-question-resolved';

export type VerseHighlightState = 'question-pending' | 'question-answered' | 'insight' | null;
type VerseMark = {
  verse_reference: string;
  has_insight: boolean;
  has_pending_question: boolean;
  has_answered_question: boolean;
};

export function useScriptureVerseMarks(userId: string | undefined, references: string[]) {
  const referenceKey = useMemo(() => Array.from(new Set(references.map(
    (reference) => canonicalBibleVerseReference(reference),
  ).filter((reference): reference is string => Boolean(reference)))).sort().join('|'), [references]);
  const [snapshot, setSnapshot] = useState<{ userId: string; key: string; marks: Map<string, VerseMark> } | null>(null);

  useEffect(() => {
    if (!userId || !referenceKey) return;
    let active = true;
    let inFlight = false;
    const reload = async () => {
      if (!active || inFlight || document.visibilityState === 'hidden') return;
      inFlight = true;
      try {
        const { data, error } = await supabase.rpc('get_my_scripture_verse_marks', {
          p_verse_references: referenceKey.split('|'),
        });
        if (error) throw error;
        if (active) setSnapshot({
          userId,
          key: referenceKey,
          marks: new Map(((data || []) as VerseMark[]).map((row) => [row.verse_reference, row])),
        });
      } catch (error) {
        console.warn('Verse highlights could not refresh:', error);
      } finally {
        inFlight = false;
      }
    };
    void reload();
    const onVisible = () => { if (document.visibilityState === 'visible') void reload(); };
    window.addEventListener(SCRIPTURE_QUESTION_RESOLVED_EVENT, onVisible);
    document.addEventListener('visibilitychange', onVisible);
    const timer = window.setInterval(onVisible, 60_000);
    return () => {
      active = false;
      window.clearInterval(timer);
      window.removeEventListener(SCRIPTURE_QUESTION_RESOLVED_EVENT, onVisible);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [userId, referenceKey]);

  return (reference: string): VerseHighlightState => {
    if (snapshot?.userId !== userId || snapshot?.key !== referenceKey) return null;
    const canonical = canonicalBibleVerseReference(reference);
    const mark = canonical ? snapshot.marks.get(canonical) : null;
    if (mark?.has_pending_question) return 'question-pending';
    if (mark?.has_answered_question) return 'question-answered';
    if (mark?.has_insight) return 'insight';
    return null;
  };
}
