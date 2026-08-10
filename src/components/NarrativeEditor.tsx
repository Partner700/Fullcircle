import { useState, useCallback } from 'react';
import { upsertNarrative } from '../lib/queries';
import { getTodayISODate, getDayType, getAppClock, shiftISODate, cn } from '../lib/utils';
import { CHALLENGE_PROOF_FORMATS } from '../lib/constants';
import type { DailyNarrative, GameSeedData, ChallengeProofFormat } from '../lib/types';
import { Loader2, Save, X, BookOpen, Sparkles, CalendarDays, KeyRound, Wand2 } from 'lucide-react';

interface HighlightedVerse {
  reference: string;
  text: string;
  meditation: string;
}

interface NarrativeEditorProps {
  narrative: DailyNarrative | null;
  republishMode?: boolean;
  onDone: () => void;
}

interface BibleVerse {
  book_id: string;
  book_name: string;
  chapter: number;
  verse: number;
  text: string;
}

interface BibleApiResponse {
  reference: string;
  translation_id: string;
  verses: BibleVerse[];
  text: string;
  error?: string;
}

const TRANSLATIONS = [
  { label: 'WEB — World English Bible', value: 'web' },
  { label: 'KJV — King James Version', value: 'kjv' },
] as const;
type TranslationValue = (typeof TRANSLATIONS)[number]['value'];

const verseRef = (v: BibleVerse): string => `${v.book_name} ${v.chapter}:${v.verse}`;

interface PacketSource {
  title: string;
  theme: string;
  scriptureReference: string;
  mainText: string;
  verseOfDay: string;
}

const STOP_WORDS = new Set([
  'about', 'after', 'again', 'against', 'also', 'among', 'because', 'before', 'being', 'between',
  'could', 'every', 'from', 'have', 'into', 'made', 'many', 'more', 'said', 'same', 'shall',
  'that', 'their', 'them', 'then', 'there', 'these', 'they', 'this', 'those', 'through', 'unto',
  'were', 'what', 'when', 'where', 'which', 'while', 'with', 'would', 'your',
]);

function splitSentences(text: string): string[] {
  return text
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 20)
    .slice(0, 12);
}

function unique(items: string[]) {
  return Array.from(new Set(items.map((item) => item.trim()).filter(Boolean)));
}

function extractKeyTerms(text: string): string[] {
  const words = text
    .replace(/[^A-Za-z\s'-]/g, ' ')
    .split(/\s+/)
    .map((word) => word.replace(/^'+|'+$/g, '').toLowerCase())
    .filter((word) => word.length > 4 && !STOP_WORDS.has(word));
  const counts = new Map<string, number>();
  words.forEach((word) => counts.set(word, (counts.get(word) || 0) + 1));
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([word]) => word)
    .slice(0, 14);
}

function extractNames(text: string): string[] {
  const matches = text.match(/\b[A-Z][a-z]{2,}\b/g) || [];
  return unique(matches.filter((name) => !['The', 'Then', 'When', 'After', 'Before', 'They', 'There'].includes(name))).slice(0, 10);
}

function pickSentenceForTerm(sentences: string[], term: string) {
  return sentences.find((sentence) => sentence.toLowerCase().includes(term.toLowerCase())) || sentences[0] || term;
}

function buildAutoInsight(source: PacketSource) {
  const sentences = splitSentences(source.mainText);
  const terms = extractKeyTerms(`${source.theme} ${source.mainText}`).slice(0, 3);
  const focus = terms.length > 0 ? terms.join(', ') : source.theme || 'today\'s passage';
  const keyVerse = source.verseOfDay.trim() || sentences[0] || '';
  const meditation = keyVerse
    ? `The key verse draws attention to ${focus}. Read it slowly, then let one phrase shape a concrete act of obedience, courage, or mercy today.`
    : `Today's reading draws attention to ${focus}. Let the passage move from reading into one concrete act of obedience, courage, or mercy today.`;
  const quote = keyVerse
    ? 'Carry the key verse into one faithful action today.'
    : 'Let today\'s reading become one faithful action.';
  return { meditation, quote };
}

function syncKeyVerse(seed: GameSeedData, source: PacketSource): GameSeedData {
  const verseText = source.verseOfDay.trim();
  if (!verseText) return { ...seed, passage: source.mainText.trim() || seed.passage };
  const keyVerse = {
    reference: source.scriptureReference.trim() || seed.key_verse?.reference || 'Key Verse',
    text: verseText,
  };
  return {
    ...seed,
    key_verse: keyVerse,
    milestone_verse: seed.milestone_verse || keyVerse,
    passage: source.mainText.trim() || seed.passage,
  };
}

function generatePacketFromSource(source: PacketSource, existing: GameSeedData = {}): GameSeedData {
  const sentences = splitSentences(source.mainText);
  const keyTerms = extractKeyTerms(`${source.title} ${source.theme} ${source.mainText}`);
  const names = extractNames(source.mainText);
  const actions = unique((source.mainText.match(/\b[A-Za-z]{4,}(?:ed|ing)\b/g) || []).map((word) => word.toLowerCase())).slice(0, 10);
  const ordered = sentences.slice(0, 8);
  const distractors = unique([
    'Jericho', 'Babylon', 'Caesar', 'Pharaoh', 'Goliath', 'Nineveh', 'Egypt', 'Rome',
    'the palace', 'the marketplace', 'a crown', 'a sword', ...(existing.distractor_pool || []),
  ]).filter((item) => !source.mainText.toLowerCase().includes(item.toLowerCase())).slice(0, 14);
  const termFacts = keyTerms.slice(0, 10).map((term) => ({
    term,
    fact: pickSentenceForTerm(sentences, term),
  }));
  const comprehension = sentences.slice(0, 8).map((sentence, index) => {
    const otherSentences = sentences.filter((item) => item !== sentence);
    const fallbackOptions = [...otherSentences.slice(0, 3), ...distractors.slice(0, 3)];
    return {
      question: index % 2 === 0
        ? 'Which detail is supported by today\'s passage?'
        : `What does the passage show about ${keyTerms[index % Math.max(keyTerms.length, 1)] || 'the reading'}?`,
      answer: sentence,
      options: unique([sentence, ...fallbackOptions]).slice(0, 4),
      explanation: `This comes from ${source.scriptureReference || 'the main scripture text'}.`,
      reference: source.scriptureReference,
    };
  });
  const trueFalse = [
    ...keyTerms.slice(0, 7).map((term) => ({ statement: `The passage mentions ${term}.`, is_true: true })),
    ...distractors.slice(0, 7).map((term) => ({ statement: `The passage mainly focuses on ${term}.`, is_true: false })),
  ];
  const categories = {
    buckets: ['People or places', 'Actions', 'Ideas or objects'],
    items: [
      ...names.slice(0, 4).map((text) => ({ text, bucket: 'People or places' })),
      ...actions.slice(0, 4).map((text) => ({ text, bucket: 'Actions' })),
      ...keyTerms.slice(0, 5).map((text) => ({ text, bucket: 'Ideas or objects' })),
    ],
  };
  const causeEffectPairs = sentences.slice(0, 5).map((sentence, index) => ({
    cause: sentence,
    effect: sentences[index + 1] || buildAutoInsight(source).quote,
  }));

  return syncKeyVerse({
    ...existing,
    characters: names,
    objects: keyTerms.slice(0, 10),
    actions,
    plot_points: ordered,
    ordered_units: ordered,
    key_terms: keyTerms,
    term_facts: termFacts,
    true_false_bank: trueFalse,
    comprehension_questions: comprehension,
    cause_effect_pairs: causeEffectPairs,
    memory_clues: keyTerms.slice(0, 6).map((term) => ({ prompt: `Remember the role of ${term}`, answer: pickSentenceForTerm(sentences, term) })),
    application_prompts: [
      `What would obedience look like after reading ${source.scriptureReference || 'this passage'}?`,
      `Which phrase from the key verse should guide your choices today?`,
    ],
    distractor_pool: distractors,
    category_schema: categories,
    passage: source.mainText.trim(),
  }, source);
}

export function NarrativeEditor({ narrative, republishMode = false, onDone }: NarrativeEditorProps) {
  const today = getTodayISODate();
  const sourceDate = narrative?.narrative_date;
  const [form, setForm] = useState<{
    narrative_date: string;
    title: string;
    theme: string;
    scripture_reference: string;
    translation: TranslationValue;
    main_text: string;
    challenge_title: string;
    challenge_instructions: string;
    challenge_active: boolean;
    challenge_proof_format: ChallengeProofFormat;
    verse_of_day: string;
    meditation_of_day: string;
    quote_of_day: string;
    game_seed_data: string;
  }>({
    narrative_date: republishMode ? today : narrative?.narrative_date || today,
    title: narrative?.title || '',
    theme: narrative?.theme || '',
    scripture_reference: narrative?.scripture_reference || '',
    translation: (['web','kjv'].includes((narrative?.translation || '').toLowerCase()) ? (narrative?.translation || '').toLowerCase() : 'web') as TranslationValue,
    main_text: narrative?.main_text || '',
    challenge_title: narrative?.challenge_title || '',
    challenge_instructions: narrative?.challenge_instructions || '',
    challenge_active: narrative?.challenge_active ?? true,
    challenge_proof_format: narrative?.challenge_proof_format || 'text',
    verse_of_day: narrative?.verse_of_day || '',
    meditation_of_day: narrative?.meditation_of_day || '',
    quote_of_day: narrative?.quote_of_day || '',
    game_seed_data: JSON.stringify(narrative?.game_seed_data || {}, null, 2),
  });

  const [fetchedVerses, setFetchedVerses] = useState<BibleVerse[] | null>(null);
  const [fetchedReference, setFetchedReference] = useState<string | null>(null);
  const [highlightedVerses, setHighlightedVerses] = useState<HighlightedVerse[]>(
    narrative?.highlighted_verses || [],
  );

  const [fetching, setFetching] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const isScheduledDate = form.narrative_date > today;
  const saveLabel = republishMode
    ? isScheduledDate
      ? 'Republish to Scheduled Date'
      : 'Republish Narrative'
    : narrative
      ? 'Save Narrative'
    : isScheduledDate
      ? 'Schedule Narrative'
      : 'Publish Narrative';
  const selectedDayType = getDayType(form.narrative_date);
  const isSundayRest = selectedDayType === 'sunday';

  const update = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const isHighlighted = (ref: string) =>
    highlightedVerses.some((hv) => hv.reference === ref);

  const getMeditation = (ref: string) =>
    highlightedVerses.find((hv) => hv.reference === ref)?.meditation || '';

  const toggleHighlight = (v: BibleVerse) => {
    const ref = verseRef(v);
    setHighlightedVerses((prev) => {
      if (prev.some((hv) => hv.reference === ref)) {
        return prev.filter((hv) => hv.reference !== ref);
      }
      return [...prev, { reference: ref, text: v.text.trim(), meditation: '' }];
    });
  };

  const updateMeditation = (ref: string, meditation: string) => {
    setHighlightedVerses((prev) =>
      prev.map((hv) => (hv.reference === ref ? { ...hv, meditation } : hv)),
    );
  };

  const fetchScripture = async () => {
    const ref = form.scripture_reference.trim();
    if (!ref) {
      setFetchError('Enter a scripture reference first (e.g. “Luke 5:1-11”).');
      return;
    }
    setFetching(true);
    setFetchError(null);
    try {
      const url = `https://bible-api.com/${encodeURIComponent(ref)}?translation=${form.translation}`;
      const res = await fetch(url);
      if (!res.ok) {
        throw new Error(`The Bible API returned ${res.status}. Check the reference and try again.`);
      }
      const data: BibleApiResponse = await res.json();
      if (data.error) {
        throw new Error(data.error);
      }
      if (!data.verses || data.verses.length === 0) {
        throw new Error('No verses were found for that reference.');
      }
      setFetchedVerses(data.verses);
      setFetchedReference(data.reference || ref);
      // Auto-populate the main passage text (editable).
      update('main_text', (data.text || data.verses.map((v) => v.text.trim()).join(' ')).trim());
      if (!form.verse_of_day.trim()) {
        update('verse_of_day', data.verses[0]?.text.trim() || '');
      }
      // Store every fetched verse so readers can open the instructor's note below it.
      setHighlightedVerses((prev) => data.verses.map((verse) => {
        const reference = verseRef(verse);
        const existing = prev.find((item) => item.reference === reference);
        return { reference, text: verse.text.trim(), meditation: existing?.meditation || '' };
      }));
    } catch (e: any) {
      setFetchError(
        e?.message || 'Failed to fetch scripture. Check the reference and try again.',
      );
      setFetchedVerses(null);
      setFetchedReference(null);
    } finally {
      setFetching(false);
    }
  };

  const save = async () => {
    setSaving(true);
    setSaveError(null);
    const selectedDayType = getDayType(form.narrative_date);
    const isSundayRest = selectedDayType === 'sunday';

    if (isSundayRest) {
      if (!form.narrative_date.trim() || !form.verse_of_day.trim()) {
        setSaveError('For Sunday, only the publish date and Verse of the Day are required.');
        setSaving(false);
        return;
      }
    } else if (
      !form.narrative_date.trim() ||
      !form.title.trim() ||
      !form.theme.trim() ||
      !form.scripture_reference.trim() ||
      !form.verse_of_day.trim() ||
      !form.main_text.trim()
    ) {
      setSaveError('Publish date, title, theme, scripture reference, key verse, and main text are all required.');
      setSaving(false);
      return;
    }

    let parsedSeed: GameSeedData;
    try {
      parsedSeed = JSON.parse(form.game_seed_data);
    } catch {
      setSaveError('Game Seed Data is not valid JSON. Fix the formatting and try again.');
      setSaving(false);
      return;
    }

    try {
      const packetSource: PacketSource = {
        title: form.title || 'Day of Rest',
        theme: form.theme || 'Rest',
        scriptureReference: form.scripture_reference || 'Verse of the Day',
        mainText: form.main_text || form.verse_of_day,
        verseOfDay: form.verse_of_day,
      };
      const syncedSeed = syncKeyVerse(parsedSeed, packetSource);
      await upsertNarrative({
        // Republish mode intentionally omits the old id so the target date is created or replaced.
        ...(narrative?.id && !republishMode ? { id: narrative.id } : {}),
        narrative_date: form.narrative_date,
        title: form.title.trim() || (isSundayRest ? 'Day of Rest' : ''),
        theme: form.theme.trim() || (isSundayRest ? 'Rest' : ''),
        scripture_reference: form.scripture_reference.trim() || (isSundayRest ? 'Verse of the Day' : ''),
        translation: form.translation,
        main_text: form.main_text.trim() || (isSundayRest ? form.verse_of_day.trim() : ''),
        highlighted_verses: highlightedVerses,
        // Preserve fields not exposed in this form.
        reflection_prompts: narrative?.reflection_prompts || [],
        challenge_proof_type: narrative?.challenge_proof_type || 'text',
        challenge_proof_format: form.challenge_proof_format,
        challenge_title: form.challenge_title.trim() || null,
        challenge_instructions: form.challenge_instructions.trim() || null,
        challenge_active: form.challenge_active,
        verse_of_day: form.verse_of_day.trim() || null,
        meditation_of_day: null,
        quote_of_day: null,
        game_seed_data: isSundayRest ? syncKeyVerse({}, packetSource) : syncedSeed,
      });
      onDone();
    } catch (e: any) {
      setSaveError(e?.message || 'Failed to save the narrative.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4 animate-fade-in max-w-3xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="font-display text-lg font-semibold text-peri">
          {republishMode ? 'Republish Previous Narrative' : narrative ? 'Edit Narrative' : 'New Narrative'}
        </h2>
        <button onClick={onDone} className="btn-ghost text-sm">
          <X size={16} /> Cancel
        </button>
      </div>

      {republishMode && sourceDate && (
        <div className="rounded-lg border border-gold/25 bg-gold-soft px-4 py-3 text-sm text-gold">
          Republishing from {sourceDate}. Choose the target date below; saving will create or replace that date without changing the original narrative.
        </div>
      )}

      {/* Scripture fetch */}
      <div className="card p-5 space-y-4">
        <div className="flex items-center gap-2">
          <BookOpen size={18} className="text-gold" />
          <h3 className="font-display font-semibold text-peri">Scripture Passage</h3>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium text-peri-dim mb-1 flex items-center gap-1.5">
              <CalendarDays size={14} className="text-gold" /> Publish Date
            </label>
            <input
              type="date"
              value={form.narrative_date}
              onChange={(e) => update('narrative_date', e.target.value)}
              className="input-field"
            />
            <div className="flex flex-wrap gap-1.5 mt-2">
              {[
                { label: 'Today', offset: 0 },
                { label: 'Tomorrow', offset: 1 },
                { label: '+3 days', offset: 3 },
                { label: '+7 days', offset: 7 },
              ].map((item) => {
                const iso = shiftISODate(getTodayISODate(), item.offset);
                return (
                  <button
                    key={item.label}
                    type="button"
                    onClick={() => update('narrative_date', iso)}
                    className={cn('rounded-full border px-2 py-1 text-[10px] font-bold transition-colors',
                      form.narrative_date === iso ? 'border-gold bg-gold-soft text-gold' : 'border-border-bright text-stone hover:text-ink')}
                  >
                    {item.label}
                  </button>
                );
              })}
              {(() => {
                const weekdayIndex: Record<string, number> = {
                  Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
                };
                const currentDay = weekdayIndex[getAppClock().weekday] ?? 0;
                const daysUntilSunday = (7 - currentDay) % 7 || 7;
                const iso = shiftISODate(getTodayISODate(), daysUntilSunday);
                return (
                  <button
                    type="button"
                    onClick={() => update('narrative_date', iso)}
                    className={cn('rounded-full border px-2 py-1 text-[10px] font-bold transition-colors',
                      form.narrative_date === iso ? 'border-gold bg-gold-soft text-gold' : 'border-border-bright text-stone hover:text-ink')}
                  >
                    Next Sunday
                  </button>
                );
              })()}
            </div>
            <p className="text-[10px] text-peri-dim mt-1">
              Future dates stay scheduled and become visible to cadets on that day.
            </p>
          </div>
          <div>
            <label className="block text-sm font-medium text-peri-dim mb-1">Scripture Reference</label>
            <input
              type="text"
              value={form.scripture_reference}
              onChange={(e) => update('scripture_reference', e.target.value)}
              className="input-field"
              placeholder="Luke 5:1-11"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium text-peri-dim mb-1">Translation</label>
            <select
              value={form.translation}
              onChange={(e) => update('translation', e.target.value as TranslationValue)}
              className="input-field"
            >
              {TRANSLATIONS.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-end">
            <button
              onClick={fetchScripture}
              disabled={fetching}
              className="btn-primary w-full"
            >
              {fetching ? (
                <Loader2 size={16} className="animate-spin" />
              ) : (
                <Sparkles size={16} />
              )}
              Fetch Scripture
            </button>
          </div>
        </div>

        <p className="text-xs text-peri-dim">
          Fetching pulls the passage from a free Bible API (bible-api.com) and lists each verse as a
          selectable card. Highlighted verses appear in the cadets’ Passage of the Day.
        </p>

        {fetchError && (
          <div className="text-sm text-coral bg-coral-soft rounded-lg p-3 border border-coral/20">
            {fetchError}
          </div>
        )}
      </div>

      {isSundayRest && (
        <div className="rounded-lg border border-sage/25 bg-sage-soft px-4 py-3 text-sm text-sage">
          Sunday is a day of rest. Set only the Verse of the Day; no daily challenge, meditation marking, or game packet is required.
        </div>
      )}

      {/* Narrative details */}
      {!isSundayRest && <div className="card p-5 space-y-4">
        <h3 className="font-display font-semibold text-peri">Narrative Details</h3>

        <div>
          <label className="block text-sm font-medium text-peri-dim mb-1">Title</label>
          <input
            type="text"
            value={form.title}
            onChange={(e) => update('title', e.target.value)}
            className="input-field"
            placeholder="The Call by the Lake"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-peri-dim mb-1">Theme</label>
          <input
            type="text"
            value={form.theme}
            onChange={(e) => update('theme', e.target.value)}
            className="input-field"
            placeholder="Obedience & Calling"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-peri-dim mb-1">
            Main Scripture Text
          </label>
          <textarea
            value={form.main_text}
            onChange={(e) => update('main_text', e.target.value)}
            className="input-field min-h-[160px] font-serif text-sm leading-relaxed"
            placeholder="Auto-populated when you fetch scripture — editable."
          />
          <p className="text-xs text-peri-dim mt-1">
            Auto-populated from the API. Edit freely to trim or reformat the passage.
          </p>
        </div>
      </div>}

      {/* Verses — selectable cards */}
      {fetchedVerses && (
        <div className="card p-5 space-y-3 animate-slide-up">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <BookOpen size={16} className="text-gold" />
              <h3 className="font-display font-semibold text-peri">
                {fetchedReference || 'Verses'} — click to highlight
              </h3>
            </div>
            <span className="text-xs text-peri-dim">
              {highlightedVerses.length} highlighted
            </span>
          </div>

          <div className="space-y-2">
            {fetchedVerses.map((v) => {
              const ref = verseRef(v);
              const highlighted = isHighlighted(ref);
              return (
                <div
                  key={ref}
                  className={cn(
                    'card p-3 transition-all',
                    highlighted && 'border-gold bg-gold-soft',
                  )}
                >
                  <div className="flex items-start gap-3">
                    <input
                      type="checkbox"
                      checked={highlighted}
                      onChange={() => toggleHighlight(v)}
                      className="mt-1 h-4 w-4 rounded border-peri-dim accent-gold cursor-pointer flex-shrink-0"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-display text-sm font-semibold text-gold">
                          {ref}
                        </span>
                        {highlighted && (
                          <Sparkles size={12} className="text-gold flex-shrink-0" />
                        )}
                      </div>
                      <p className="text-sm text-peri leading-relaxed">{v.text.trim()}</p>
                      <button
                        type="button"
                        onClick={() => update('verse_of_day', v.text.trim())}
                        className="mt-2 inline-flex items-center gap-1 rounded-full border border-gold/25 bg-gold-soft px-2.5 py-1 text-[10px] font-bold text-gold hover:border-gold/40 transition-colors"
                      >
                        <KeyRound size={11} /> Use as Key Verse
                      </button>

                      {highlighted && (
                        <div className="mt-3">
                          <label className="block text-xs font-medium text-peri-dim mb-1">
                            Meditation / Reflection
                          </label>
                          <textarea
                            value={getMeditation(ref)}
                            onChange={(e) => updateMeditation(ref, e.target.value)}
                            className="input-field min-h-[80px] resize-y text-sm"
                            placeholder="Write a meditation for this verse — it will appear in the Passage of the Day…"
                          />
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Key verse and generated insight */}
      <div className="card p-5 space-y-4">
        <div className="flex items-center gap-2">
          <KeyRound size={18} className="text-gold" />
          <h3 className="font-display font-semibold text-peri">Verse of the Day / Key Verse</h3>
        </div>
        <p className="text-xs text-peri-dim">
          Choose the verse cadets should carry. This same verse powers the game packet as the key verse.
        </p>

        <div>
          <label className="block text-sm font-medium text-peri-dim mb-1 flex items-center gap-1.5">
            <BookOpen size={14} className="text-gold" /> Key Verse Text
          </label>
          <textarea
            value={form.verse_of_day}
            onChange={(e) => update('verse_of_day', e.target.value)}
            className="input-field min-h-[70px] font-serif text-sm"
            placeholder="The single verse that captures today's reading..."
          />
        </div>

        <p className="text-xs text-peri-dim">
          Cadets and sentries write their own Meditation of the Day and Quote of the Day when they submit daily meditation.
        </p>
      </div>

      {/* Daily challenge */}
      {!isSundayRest && <div className="card p-5 space-y-4">
        <h3 className="font-display font-semibold text-peri">Daily Challenge</h3>

        <div>
          <label className="block text-sm font-medium text-peri-dim mb-1">Challenge Title</label>
          <input
            type="text"
            value={form.challenge_title}
            onChange={(e) => update('challenge_title', e.target.value)}
            className="input-field"
            placeholder="Memorise the Key Verse"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-peri-dim mb-1">
            Challenge Instructions
          </label>
          <textarea
            value={form.challenge_instructions}
            onChange={(e) => update('challenge_instructions', e.target.value)}
            className="input-field min-h-[70px] text-sm"
            placeholder="Write the verse from memory and submit your text proof…"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-peri-dim mb-1">Report Format</label>
          <p className="text-xs text-peri-dim mb-2">
            Choose how cadets should submit their challenge proof. They can resubmit if you reject it.
          </p>
          <div className="flex flex-wrap gap-2">
            {CHALLENGE_PROOF_FORMATS.map((fmt) => (
              <button
                key={fmt.value}
                type="button"
                onClick={() => update('challenge_proof_format', fmt.value)}
                className={cn(
                  'px-3 py-2 rounded-lg border text-sm font-medium transition-all',
                  form.challenge_proof_format === fmt.value
                    ? 'border-gold bg-gold-soft text-gold'
                    : 'border-border text-peri-dim hover:border-border-bright',
                )}
              >
                {fmt.label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-peri">Challenge Active</p>
            <p className="text-xs text-peri-dim">When on, cadets can submit proof for talents.</p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={form.challenge_active}
            onClick={() => update('challenge_active', !form.challenge_active)}
            className={cn(
              'relative inline-flex h-6 w-11 items-center rounded-full transition-colors cursor-pointer',
              form.challenge_active ? 'bg-sage' : 'bg-navy-4',
            )}
          >
            <span
              className={cn(
                'inline-block h-4 w-4 transform rounded-full bg-white transition-transform',
                form.challenge_active ? 'translate-x-6' : 'translate-x-1',
              )}
            />
          </button>
        </div>
      </div>}

      {/* Game seed data — structured content packet editor */}
      {!isSundayRest && <div className="card p-5 space-y-4">
        <h3 className="font-display font-semibold text-peri">Game Content Packet</h3>
        <p className="text-xs text-peri-dim">
          These fields power the 8 game engines. Each field is genre-neutral — fill what
          applies to today's reading. Games auto-generate from this data; no per-game setup needed.
        </p>
        <ContentPacketEditor
          value={form.game_seed_data}
          onChange={(v) => update('game_seed_data', v)}
          source={{
            title: form.title,
            theme: form.theme,
            scriptureReference: form.scripture_reference,
            mainText: form.main_text,
            verseOfDay: form.verse_of_day,
          }}
        />
      </div>}

      {/* Save */}
      {saveError && (
        <div className="text-sm text-coral bg-coral-soft rounded-lg p-3 border border-coral/20">
          {saveError}
        </div>
      )}

      <button onClick={save} disabled={saving} className="btn-primary w-full">
        {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
        {saveLabel}
      </button>
    </div>
  );
}

function ContentPacketEditor({ value, onChange, source }: { value: string; onChange: (v: string) => void; source: PacketSource }) {
  const [data, setData] = useState<GameSeedData>(() => {
    try { return JSON.parse(value) as GameSeedData; } catch { return {}; }
  });

  const replaceData = useCallback((next: GameSeedData) => {
    setData(next);
    onChange(JSON.stringify(next, null, 2));
  }, [onChange]);

  const update = useCallback((patch: Partial<GameSeedData>) => {
    const next = { ...data, ...patch };
    replaceData(next);
  }, [data, replaceData]);

  const updateArray = (key: keyof GameSeedData, text: string) => {
    const arr = text.split('\n').map((s) => s.trim()).filter(Boolean);
    update({ [key]: arr } as any);
  };

  const arrToText = (arr?: string[]) => (arr || []).join('\n');
  const generatedSection = () => generatePacketFromSource(source, data);
  const applyGeneratedSection = (...keys: (keyof GameSeedData)[]) => {
    const generated = generatedSection();
    const patch: Partial<GameSeedData> = {};
    keys.forEach((key) => {
      (patch as any)[key] = generated[key];
    });
    update(patch);
  };

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-gold/25 bg-gold-soft p-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <p className="text-sm font-display font-semibold text-gold">Generate from Main Scripture Text</p>
            <p className="text-xs text-gold/80 mt-1">
              Builds question banks, terms, events, categories, and distractors from the passage and key verse.
            </p>
          </div>
          <button
            type="button"
            onClick={() => replaceData(generatePacketFromSource(source, data))}
            disabled={!source.mainText.trim() || !source.verseOfDay.trim()}
            className="btn-primary text-xs disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Wand2 size={14} /> Generate Packet
          </button>
        </div>
      </div>

      {/* Key verse */}
      <div className="grid sm:grid-cols-2 gap-3">
        <div>
          <label className="text-xs font-bold text-peri block mb-1">Key Verse Reference</label>
          <input className="input-field text-sm" placeholder="e.g. Genesis 22:8"
            value={data.key_verse?.reference || ''}
            onChange={(e) => update({ key_verse: { reference: e.target.value, text: data.key_verse?.text || '' } })}
          />
        </div>
        <div>
          <label className="text-xs font-bold text-peri block mb-1">Key Verse Text</label>
          <input className="input-field text-sm" placeholder="The verse text…"
            value={data.key_verse?.text || ''}
            onChange={(e) => update({ key_verse: { reference: data.key_verse?.reference || '', text: e.target.value } })}
          />
        </div>
      </div>

      {/* Story actors and movement */}
      <div className="grid sm:grid-cols-2 gap-3">
        <div>
          <div className="flex items-center justify-between gap-2 mb-1">
            <label className="text-xs font-bold text-peri">People / Places (one per line)</label>
            <button type="button" onClick={() => applyGeneratedSection('characters')} className="text-[10px] font-bold text-gold">Generate</button>
          </div>
          <textarea className="input-field text-sm min-h-[70px]" placeholder="Jesus&#10;Peter&#10;Galilee"
            value={arrToText(data.characters)}
            onChange={(e) => updateArray('characters', e.target.value)}
          />
        </div>
        <div>
          <div className="flex items-center justify-between gap-2 mb-1">
            <label className="text-xs font-bold text-peri">Actions (one per line)</label>
            <button type="button" onClick={() => applyGeneratedSection('actions')} className="text-[10px] font-bold text-gold">Generate</button>
          </div>
          <textarea className="input-field text-sm min-h-[70px]" placeholder="calling&#10;following&#10;teaching"
            value={arrToText(data.actions)}
            onChange={(e) => updateArray('actions', e.target.value)}
          />
        </div>
      </div>

      {/* Ordered units */}
      <div>
        <div className="flex items-center justify-between gap-2 mb-1">
          <label className="text-xs font-bold text-peri">Ordered Units (5-8, one per line)</label>
          <button type="button" onClick={() => applyGeneratedSection('ordered_units')} className="text-[10px] font-bold text-gold">Generate</button>
        </div>
        <p className="text-[10px] text-peri-dim mb-1">Events in a story, stanzas in a psalm, steps in an argument…</p>
        <textarea className="input-field text-sm min-h-[80px]" placeholder="Called by God&#10;Took Isaac and wood&#10;Three days' journey…"
          value={arrToText(data.ordered_units)}
          onChange={(e) => updateArray('ordered_units', e.target.value)}
        />
      </div>

      <div>
        <div className="flex items-center justify-between gap-2 mb-1">
          <label className="text-xs font-bold text-peri">Plot Points (one per line)</label>
          <button type="button" onClick={() => applyGeneratedSection('plot_points')} className="text-[10px] font-bold text-gold">Generate</button>
        </div>
        <p className="text-[10px] text-peri-dim mb-1">Short event beats used for order, comprehension, and final mixed questions</p>
        <textarea className="input-field text-sm min-h-[80px]" placeholder="Jesus sees the crowd&#10;The disciples obey&#10;The catch overwhelms the nets"
          value={arrToText(data.plot_points)}
          onChange={(e) => updateArray('plot_points', e.target.value)}
        />
      </div>

      {/* Key terms */}
      <div>
        <div className="flex items-center justify-between gap-2 mb-1">
          <label className="text-xs font-bold text-peri">Key Terms (one per line)</label>
          <button type="button" onClick={() => applyGeneratedSection('key_terms', 'objects')} className="text-[10px] font-bold text-gold">Generate</button>
        </div>
        <p className="text-[10px] text-peri-dim mb-1">Names, images, or concepts the passage is about</p>
        <textarea className="input-field text-sm min-h-[60px]" placeholder="Abraham&#10;Isaac&#10;The altar…"
          value={arrToText(data.key_terms)}
          onChange={(e) => updateArray('key_terms', e.target.value)}
        />
      </div>

      {/* Term facts */}
      <div>
        <div className="flex items-center justify-between gap-2 mb-1">
          <label className="text-xs font-bold text-peri">Term Facts (term - fact, one per line)</label>
          <button type="button" onClick={() => applyGeneratedSection('term_facts')} className="text-[10px] font-bold text-gold">Generate</button>
        </div>
        <p className="text-[10px] text-peri-dim mb-1">What each term did or means in the passage</p>
        <textarea className="input-field text-sm min-h-[80px]" placeholder="Abraham — said 'God will provide'&#10;Isaac — carried the wood"
          value={(data.term_facts || []).map((f) => `${f.term} — ${f.fact}`).join('\n')}
          onChange={(e) => {
            const lines = e.target.value.split('\n').filter(Boolean).map((line) => {
              const [term, ...rest] = line.split(' — ');
              return { term: term?.trim() || '', fact: rest.join(' — ').trim() };
            });
            update({ term_facts: lines });
          }}
        />
      </div>

      {/* Comprehension bank */}
      <div>
        <div className="flex items-center justify-between gap-2 mb-1">
          <label className="text-xs font-bold text-peri">Comprehension Bank (question | answer | wrong option | wrong option | wrong option)</label>
          <button type="button" onClick={() => applyGeneratedSection('comprehension_questions')} className="text-[10px] font-bold text-gold">Generate</button>
        </div>
        <p className="text-[10px] text-peri-dim mb-1">Generated from the passage; edit these to make the games sharper</p>
        <textarea className="input-field text-sm min-h-[110px]" placeholder="Which detail is supported by the passage?|Jesus called Peter|Peter ignored Jesus|The crowd left|The boat sank"
          value={(data.comprehension_questions || []).map((q) => `${q.question} | ${q.answer} | ${(q.options || []).filter((opt) => opt !== q.answer).join(' | ')}`).join('\n')}
          onChange={(e) => {
            const questions = e.target.value.split('\n').filter(Boolean).map((line) => {
              const [question, answer, ...rest] = line.split('|').map((part) => part.trim());
              return {
                question: question || '',
                answer: answer || '',
                options: unique([answer || '', ...rest]).slice(0, 4),
                reference: source.scriptureReference,
              };
            }).filter((item) => item.question && item.answer);
            update({ comprehension_questions: questions });
          }}
        />
      </div>

      {/* True/False bank */}
      <div>
        <div className="flex items-center justify-between gap-2 mb-1">
          <label className="text-xs font-bold text-peri">True/False Bank (statement|true or statement|false, one per line)</label>
          <button type="button" onClick={() => applyGeneratedSection('true_false_bank')} className="text-[10px] font-bold text-gold">Generate</button>
        </div>
        <p className="text-[10px] text-peri-dim mb-1">8-12 short statements about the passage</p>
        <textarea className="input-field text-sm min-h-[100px]" placeholder="Isaac carried the fire and the knife.|false&#10;Abraham built an altar.|true"
          value={(data.true_false_bank || []).map((s) => `${s.statement}|${s.is_true}`).join('\n')}
          onChange={(e) => {
            const lines = e.target.value.split('\n').filter(Boolean).map((line) => {
              const [statement, val] = line.split('|');
              return { statement: statement?.trim() || '', is_true: val?.trim() === 'true' };
            });
            update({ true_false_bank: lines });
          }}
        />
      </div>

      {/* Cause/effect bank */}
      <div>
        <div className="flex items-center justify-between gap-2 mb-1">
          <label className="text-xs font-bold text-peri">Cause / Effect Pairs (cause | effect, one per line)</label>
          <button type="button" onClick={() => applyGeneratedSection('cause_effect_pairs')} className="text-[10px] font-bold text-gold">Generate</button>
        </div>
        <p className="text-[10px] text-peri-dim mb-1">Used in meaning, sequence, and harder comprehension questions</p>
        <textarea className="input-field text-sm min-h-[80px]" placeholder="They obeyed Jesus | The nets filled with fish"
          value={(data.cause_effect_pairs || []).map((pair) => `${pair.cause} | ${pair.effect}`).join('\n')}
          onChange={(e) => {
            const pairs = e.target.value.split('\n').filter(Boolean).map((line) => {
              const [cause, ...rest] = line.split('|');
              return { cause: cause?.trim() || '', effect: rest.join('|').trim() };
            }).filter((pair) => pair.cause && pair.effect);
            update({ cause_effect_pairs: pairs });
          }}
        />
      </div>

      {/* Distractor pool */}
      <div>
        <div className="flex items-center justify-between gap-2 mb-1">
          <label className="text-xs font-bold text-peri">Distractor Pool (one per line)</label>
          <button type="button" onClick={() => applyGeneratedSection('distractor_pool')} className="text-[10px] font-bold text-gold">Generate</button>
        </div>
        <p className="text-[10px] text-peri-dim mb-1">Terms from other similar passages — used as wrong answers</p>
        <textarea className="input-field text-sm min-h-[60px]" placeholder="Moses&#10;David&#10;The Ark…"
          value={arrToText(data.distractor_pool)}
          onChange={(e) => updateArray('distractor_pool', e.target.value)}
        />
      </div>

      {/* Cross references */}
      <div>
        <label className="text-xs font-bold text-peri block mb-1">Cross References (one per line)</label>
        <p className="text-[10px] text-peri-dim mb-1">Optional anchors for quiz and high-level game questions</p>
        <textarea className="input-field text-sm min-h-[60px]" placeholder="John 21:1-14&#10;Matthew 4:18-22"
          value={arrToText(data.cross_reference_anchors)}
          onChange={(e) => updateArray('cross_reference_anchors', e.target.value)}
        />
      </div>

      {/* Category schema */}
      <div>
        <div className="flex items-center justify-between gap-2 mb-1">
          <label className="text-xs font-bold text-peri">Category Schema</label>
          <button type="button" onClick={() => applyGeneratedSection('category_schema')} className="text-[10px] font-bold text-gold">Generate</button>
        </div>
        <p className="text-[10px] text-peri-dim mb-1">A 2-3 bucket sort. Put buckets on the first line (comma-separated), then items below (text|bucket)</p>
        <input className="input-field text-sm mb-2" placeholder="Things Abraham did, Things Isaac did, Things the angel did"
          value={(data.category_schema?.buckets || []).join(', ')}
          onChange={(e) => {
            const buckets = e.target.value.split(',').map((s) => s.trim()).filter(Boolean);
            update({ category_schema: { buckets, items: data.category_schema?.items || [] } });
          }}
        />
        <textarea className="input-field text-sm min-h-[80px]" placeholder="Built the altar|Things Abraham did&#10;Carried the wood|Things Isaac did"
          value={(data.category_schema?.items || []).map((i) => `${i.text}|${i.bucket}`).join('\n')}
          onChange={(e) => {
            const items = e.target.value.split('\n').filter(Boolean).map((line) => {
              const [text, bucket] = line.split('|');
              return { text: text?.trim() || '', bucket: bucket?.trim() || '' };
            });
            update({ category_schema: { buckets: data.category_schema?.buckets || [], items } });
          }}
        />
      </div>

      {/* Milestone verse (optional, for Verbatim Recall Blitz) */}
      <div className="grid sm:grid-cols-2 gap-3">
        <div>
          <label className="text-xs font-bold text-peri block mb-1">Milestone Verse Reference (optional)</label>
          <input className="input-field text-sm" placeholder="e.g. Romans 1:16"
            value={data.milestone_verse?.reference || ''}
            onChange={(e) => update({ milestone_verse: { reference: e.target.value, text: data.milestone_verse?.text || '' } })}
          />
        </div>
        <div>
          <label className="text-xs font-bold text-peri block mb-1">Milestone Verse Text (optional)</label>
          <input className="input-field text-sm" placeholder="The verse text…"
            value={data.milestone_verse?.text || ''}
            onChange={(e) => update({ milestone_verse: { reference: data.milestone_verse?.reference || '', text: e.target.value } })}
          />
        </div>
      </div>
    </div>
  );
}
