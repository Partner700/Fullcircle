import type { GameSeedData, QuestionPayload, CustomQuestion } from './types';
import { LEVEL_GAME_TYPES, LEVEL_TIMERS, GAME_QUESTIONS_PER_LEVEL, GAME_QUESTIONS_PER_ROUND } from './constants';

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function pick<T>(arr: T[], n: number): T[] {
  return shuffle(arr).slice(0, n);
}

function splitAnswerParts(value: string): string[] {
  return value
    .split(/\||,/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function firstLetterHint(text: string): string {
  return text
    .split(/\s+/)
    .map((w) => {
      const first = w.match(/[A-Za-z]/)?.[0];
      const letters = w.replace(/[^A-Za-z]/g, '');
      if (!first || letters.length <= 1) return w;
      return `${first}${'_'.repeat(letters.length - 1)}${w.match(/[^A-Za-z]*$/)?.[0] || ''}`;
    })
    .join(' ');
}

function normalizeCustomQuestionType(raw: string): QuestionPayload['type'] {
  switch (raw) {
    case 'fill_blank':
    case 'cloze':
      return 'cloze';
    case 'word_to_meaning':
    case 'matching':
      return 'matching';
    case 'first_letter':
    case 'scriptorium':
      return 'scriptorium';
    case 'build_verse':
    case 'order_sequence':
      return 'order_sequence';
    case 'standard_text':
    case 'written':
    case 'short_answer':
      return 'standard_text';
    case 'true_false':
      return 'true_false';
    case 'comprehension':
      return 'comprehension';
    case 'category_sort':
      return 'category_sort';
    default:
      return 'multiple_choice';
  }
}

function parsePairs(lines: string[]): { left: string; right: string }[] {
  return lines
    .map((line) => {
      const parts = line.includes('|') ? line.split('|') : line.split('—');
      const [left, ...rest] = parts;
      return { left: left?.trim() || '', right: rest.join('—').trim() };
    })
    .filter((pair) => pair.left && pair.right);
}

function parseSortItems(lines: string[]): { text: string; bucket: string }[] {
  return lines
    .map((line) => {
      const [text, ...rest] = line.includes('|') ? line.split('|') : line.split('—');
      return { text: text?.trim() || '', bucket: rest.join('—').trim() };
    })
    .filter((item) => item.text && item.bucket);
}

export function customQuestionToPayload(cq: CustomQuestion): QuestionPayload {
  const options = Array.isArray(cq.options) ? cq.options as string[] : [];
  const type = normalizeCustomQuestionType(cq.question_type || 'multiple_choice');
  const base: QuestionPayload = {
    id: `custom-${cq.id}`,
    type,
    question: cq.question_text,
    correct_answer: cq.correct_answer,
    accepted_answers: Array.isArray(cq.accepted_answers) ? cq.accepted_answers : undefined,
    explanation: cq.explanation || undefined,
    reference: cq.scripture_reference || undefined,
    passage: cq.passage || undefined,
    game_round: cq.game_round ?? undefined,
    round_timer_seconds: cq.round_timer_seconds ?? undefined,
    passage_display_seconds: cq.passage_display_seconds ?? undefined,
    is_bonus: cq.is_bonus ?? undefined,
  };

  if (type === 'true_false') {
    return { ...base, options: ['True', 'False'] };
  }

  if (type === 'cloze') {
    const blanks = splitAnswerParts(cq.correct_answer);
    const items = options.length > 0 ? options : blanks;
    return {
      ...base,
      correct_answer: blanks.join('|') || cq.correct_answer,
      blanked_text: cq.passage || cq.question_text,
      blanks,
      items,
    };
  }

  if (type === 'matching') {
    const pairs = parsePairs(options);
    if (pairs.length > 0) {
      return {
        ...base,
        pairs,
        options: pairs.map((p) => p.right),
        correct_answer: pairs.map((p) => p.right).join('|'),
      };
    }
    return { ...base, type: 'multiple_choice', options };
  }

  if (type === 'scriptorium') {
    return {
      ...base,
      blanked_text: cq.passage || firstLetterHint(cq.correct_answer),
    };
  }

  if (type === 'standard_text') {
    return {
      ...base,
      type: 'standard_text',
      passage: cq.passage || undefined,
    };
  }

  if (type === 'order_sequence') {
    const items = options.length > 0 ? options : splitAnswerParts(cq.correct_answer);
    return {
      ...base,
      items: shuffle(items),
      correct_answer: splitAnswerParts(cq.correct_answer).join('|') || items.join('|'),
    };
  }

  if (type === 'category_sort') {
    const sortItems = parseSortItems(options);
    return {
      ...base,
      buckets: Array.from(new Set(sortItems.map((item) => item.bucket))),
      sort_items: sortItems,
      items: sortItems.map((item) => item.text),
      correct_answer: sortItems.map((item) => `${item.text}:${item.bucket}`).join('|'),
    };
  }

  return { ...base, options };
}

function makeDistractors(correct: string, pool: string[], count: number): string[] {
  return shuffle(pool.filter((x) => x !== correct)).slice(0, count);
}

// Track used question texts to prevent repeats across levels
const usedQuestions = new Set<string>();

function track(q: QuestionPayload): QuestionPayload {
  usedQuestions.add(q.question);
  return q;
}

// ── Level 1: True or False — ONE statement, True/False buttons ──
function engineTrueFalse(seed: GameSeedData, _difficulty: number): QuestionPayload {
  void _difficulty;
  const bank = seed.true_false_bank || [];
  const available = bank.filter((b) => !usedQuestions.has(b.statement));

  if (available.length > 0) {
    const item = available[Math.floor(Math.random() * available.length)];
    return track({
      type: 'true_false',
      engine: 'True or False',
      question: item.statement,
      options: ['True', 'False'],
      correct_answer: item.is_true ? 'True' : 'False',
      reference: seed.key_verse?.reference,
    });
  }

  // Fallback: generate a statement from the key verse
  const verse = seed.key_verse;
  if (verse) {
    const statements = [
      { statement: `The key verse says: "${verse.text}"`, is_true: true },
      { statement: `The key verse is found in ${verse.reference}.`, is_true: true },
      { statement: `The key verse is about wealth and power.`, is_true: false },
      { statement: `The key verse was spoken by Moses.`, is_true: false },
    ];
    const avail = statements.filter((s) => !usedQuestions.has(s.statement));
    const item = (avail.length > 0 ? avail : statements)[Math.floor(Math.random() * (avail.length > 0 ? avail.length : statements.length))];
    return track({
      type: 'true_false',
      engine: 'True or False',
      question: item.statement,
      options: ['True', 'False'],
      correct_answer: item.is_true ? 'True' : 'False',
      reference: verse.reference,
    });
  }

  return track({
    type: 'true_false',
    engine: 'True or False',
    question: 'Today\'s reading focuses on faithfulness.',
    options: ['True', 'False'],
    correct_answer: 'True',
  });
}

// ── Level 2: Reading Comprehension — multiple choice, harder distractors ──
function engineComprehension(seed: GameSeedData, difficulty: number): QuestionPayload {
  const generated = seed.comprehension_questions || [];
  const availableGenerated = generated.filter((q) => q.question && q.answer && !usedQuestions.has(q.question));
  if (availableGenerated.length > 0) {
    const item = availableGenerated[Math.floor(Math.random() * availableGenerated.length)];
    const options = item.options && item.options.length > 0
      ? item.options
      : [item.answer, ...(seed.distractor_pool || []).slice(0, 3)];
    return track({
      type: 'comprehension',
      engine: 'Reading Comprehension',
      question: item.question,
      options: shuffle(Array.from(new Set([item.answer, ...options])).slice(0, 4)),
      correct_answer: item.answer,
      explanation: item.explanation,
      reference: item.reference || seed.key_verse?.reference,
      passage: seed.passage || seed.key_verse?.text || '',
    });
  }

  const facts = seed.term_facts || [];
  const available = facts.filter((f) => !usedQuestions.has(`What does "${f.term}" mean?`));
  const passage = seed.key_verse?.text || seed.passage || '';

  if (available.length > 0) {
    const f = available[Math.floor(Math.random() * available.length)];
    const distractorPool = facts.filter((x) => x.fact !== f.fact).map((x) => x.fact);
    const numDistractors = Math.min(3 + Math.floor(difficulty / 3), distractorPool.length);
    const options = shuffle([f.fact, ...makeDistractors(f.fact, distractorPool, numDistractors)]);
    return track({
      type: 'comprehension',
      engine: 'Reading Comprehension',
      question: `What does "${f.term}" mean in today's reading?`,
      options,
      correct_answer: f.fact,
      reference: seed.key_verse?.reference,
      passage,
    });
  }

  // Fallback from key verse
  const verse = seed.key_verse;
  if (verse) {
    const words = verse.text.split(' ').filter((w) => w.replace(/[^a-zA-Z]/g, '').length > 4);
    const target = words[Math.floor(Math.random() * Math.max(words.length, 1))] || verse.text.split(' ')[0];
    const questionText = `Complete the key verse (${verse.reference}): "...${verse.text.replace(target, '_____')}..."`;
    if (!usedQuestions.has(questionText)) {
      return track({
        type: 'comprehension',
        engine: 'Reading Comprehension',
        question: questionText,
        options: shuffle([target, ...makeDistractors(target, words.filter((w) => w !== target), 3)]),
        correct_answer: target,
        reference: verse.reference,
        passage,
      });
    }
  }

  return track({
    type: 'comprehension',
    engine: 'Reading Comprehension',
    question: 'What is the main theme of today\'s reading?',
    options: ['Faithfulness', 'Power', 'Wealth', 'Pride'],
    correct_answer: 'Faithfulness',
    passage,
  });
}

// ── Level 3: Fill in the Blanks — drag-and-drop word bank, multiple blanks ──
function engineFillBlank(seed: GameSeedData, difficulty: number): QuestionPayload {
  const verse = seed.milestone_verse || seed.key_verse;
  if (!verse) return engineComprehension(seed, difficulty);

  const words = verse.text.split(' ');
  // Pick 3-5 words to blank out (more at higher difficulty)
  const numBlanks = Math.min(2 + difficulty, 5);
  const longWords = words.filter((w) => w.replace(/[^a-zA-Z]/g, '').length > 3);
  const toBlank = pick(longWords, Math.min(numBlanks, longWords.length));

  if (toBlank.length === 0) return engineComprehension(seed, difficulty);

  // Build the blanked text with numbered blanks
  const blankedWords = words.map((w) => (toBlank.includes(w) ? `___${toBlank.indexOf(w) + 1}___` : w));
  const blankedText = blankedWords.join(' ');

  // Build word bank: correct words + distractors from the verse
  const distractorWords = words.filter((w) => !toBlank.includes(w) && w.replace(/[^a-zA-Z]/g, '').length > 2);
  const numDistractors = Math.min(3, distractorWords.length);
  const distractors = pick(distractorWords, numDistractors);
  const wordBank = shuffle([...toBlank, ...distractors]);

  return track({
    type: 'cloze',
    engine: 'Fill in the Blanks',
    question: `Drag the correct words from the bank to fill the blanks (${verse.reference}):`,
    correct_answer: toBlank.join('|'),
    blanked_text: blankedText,
    blanks: toBlank,
    items: wordBank,
    reference: verse.reference,
  });
}

// ── Category Sort — sort people/actions/ideas into buckets ──
function engineCategorySort(seed: GameSeedData, difficulty: number): QuestionPayload {
  const schema = seed.category_schema;
  if (schema && schema.buckets.length >= 2 && schema.items.length >= 4) {
    const selected = pick(schema.items, Math.min(6, schema.items.length));
    return track({
      type: 'category_sort',
      engine: 'Category Sort',
      question: 'Sort each item into the correct group from today\'s reading.',
      buckets: schema.buckets,
      sort_items: selected,
      items: selected.map((item) => item.text),
      correct_answer: selected.map((item) => `${item.text}:${item.bucket}`).join('|'),
      reference: seed.key_verse?.reference,
    });
  }
  return engineComprehension(seed, difficulty);
}

// ── Level 4: Word to Meaning — matching, more pairs at higher difficulty ──
function engineWordToMeaning(seed: GameSeedData, difficulty: number): QuestionPayload {
  const causeEffects = (seed.cause_effect_pairs || []).map((pair) => ({
    term: pair.cause,
    fact: pair.effect,
  }));
  const facts = [...(seed.term_facts || []), ...causeEffects];
  if (facts.length < 2) return engineComprehension(seed, difficulty);

  const numPairs = Math.min(3 + Math.floor(difficulty / 2), facts.length, 5);
  const selected = pick(facts, numPairs);
  const shuffledFacts = shuffle(selected.map((f) => f.fact));
  return track({
    type: 'matching',
    engine: 'Word to Meaning',
    question: 'Match each term with its meaning from today\'s reading.',
    pairs: selected.map((f) => ({ left: f.term, right: f.fact })),
    options: shuffledFacts,
    correct_answer: selected.map((f) => f.fact).join('|'),
    reference: seed.key_verse?.reference,
  });
}

// ── Level 5: First Letter — type the full verse from first-letter hints ──
function engineFirstLetter(seed: GameSeedData, difficulty: number): QuestionPayload {
  const verse = seed.milestone_verse || seed.key_verse;
  if (!verse) return engineFillBlank(seed, difficulty);

  const words = verse.text.split(' ');
  const hinted = words.map((w) => {
    const letters = w.replace(/[^a-zA-Z]/g, '');
    if (letters.length <= 2) return w;
    return w[0] + '_'.repeat(Math.max(1, letters.length - 1)) + (w.match(/[^a-zA-Z]*$/)?.[0] || '');
  }).join(' ');

  return track({
    type: 'scriptorium',
    engine: 'First Letter',
    question: `The first letter of each word is shown. Type the full verse (${verse.reference}):`,
    correct_answer: verse.text,
    blanked_text: hinted,
    reference: verse.reference,
  });
}

// ── Level 6: Build the Verse — arrange words in order ──
function engineBuildVerse(seed: GameSeedData, difficulty: number): QuestionPayload {
  const verse = seed.milestone_verse || seed.key_verse;
  if (!verse) return engineFirstLetter(seed, difficulty);

  const words = verse.text.split(' ');
  return track({
    type: 'order_sequence',
    engine: 'Build the Verse',
    question: `Arrange these words to reconstruct the verse (${verse.reference}):`,
    items: shuffle(words),
    correct_answer: words.join('|'),
    reference: verse.reference,
  });
}

const ENGINE_MAP: Record<string, (seed: GameSeedData, difficulty: number) => QuestionPayload> = {
  true_false: engineTrueFalse,
  comprehension: engineComprehension,
  fill_blank: engineFillBlank,
  word_to_meaning: engineWordToMeaning,
  first_letter: engineFirstLetter,
  build_verse: engineBuildVerse,
  category_sort: engineCategorySort,
};

export function generateLevelQuestions(seed: GameSeedData, level: number, customQuestions?: CustomQuestion[]): QuestionPayload[] {
  const gameType = LEVEL_GAME_TYPES[level - 1] || 'true_false';
  const questions: QuestionPayload[] = [];
  const numQuestions = GAME_QUESTIONS_PER_LEVEL; // 15 questions per level
  const difficulty = level;

  // Narrative-specific synced questions become the source of truth for that level/day.
  if (customQuestions && customQuestions.length > 0) {
    const generatedBank = customQuestions.some((cq) => cq.generated_from_packet || cq.narrative_date);
    const customPool = generatedBank
      ? [
        ...customQuestions.filter((cq) => !cq.is_bonus).slice(0, numQuestions),
        ...(level >= 5 ? customQuestions.filter((cq) => cq.is_bonus) : []),
      ]
      : customQuestions.slice(0, Math.min(5, numQuestions));

    for (const cq of customPool) {
      const qText = cq.question_text;
      if (usedQuestions.has(qText)) continue;
      usedQuestions.add(qText);
      questions.push(customQuestionToPayload(cq));
    }
    // Never fill a reviewed set with unapproved fallback questions. If an
    // instructor publishes fewer questions, the level deliberately uses that
    // smaller set until more are approved.
    return questions;
  }

  if (gameType === 'final_mixed') {
    const engines = [engineTrueFalse, engineComprehension, engineFillBlank, engineWordToMeaning, engineCategorySort, engineFirstLetter, engineBuildVerse];
    // 3 rounds of 5, cycling through engines
    for (let round = 0; round < 3; round++) {
      for (const fn of engines) {
        const q = fn(seed, 7);
        if (q) questions.push(q);
        if (questions.length >= (round + 1) * GAME_QUESTIONS_PER_ROUND) break;
      }
    }
    while (questions.length < numQuestions) {
      questions.push(engineComprehension(seed, 7));
    }
    return questions.slice(0, numQuestions);
  }

  // Reading comprehension: passage-based, 3 rounds of 5 questions each
  if (gameType === 'comprehension') {
    const passage = seed.key_verse?.text || seed.passage || '';
    // Each round of 5 questions shares a passage
    for (let round = 0; round < 3; round++) {
      for (let i = 0; i < GAME_QUESTIONS_PER_ROUND; i++) {
        const q = engineComprehension(seed, difficulty);
        if (q) {
          // Show passage on every 5th question (start of each round)
          q.game_round = round + 1;
          if (i === 0) {
            q.passage = passage;
            q.passage_display_seconds = 30;
          }
          questions.push(q);
        }
      }
    }
    return questions.slice(0, numQuestions);
  }

  const fn = ENGINE_MAP[gameType] || engineTrueFalse;
  while (questions.length < numQuestions) {
    const q = fn(seed, difficulty);
    if (q) questions.push(q);
  }
  return questions;
}

export function getLevelTimer(level: number): number {
  return LEVEL_TIMERS[level - 1] || 60;
}

export function getLevelGameType(level: number): string {
  return LEVEL_GAME_TYPES[level - 1] || 'true_false';
}

export const GAME_TYPE_LABELS: Record<string, string> = {
  true_false: 'True or False',
  comprehension: 'Reading Comprehension',
  fill_blank: 'Fill in the Blanks',
  word_to_meaning: 'Word to Meaning',
  first_letter: 'First Letter',
  build_verse: 'Build the Verse',
  final_mixed: 'Final Boss — Mixed',
};

// Reset used questions (call when starting a fresh game session)
export function resetUsedQuestions() {
  usedQuestions.clear();
}
