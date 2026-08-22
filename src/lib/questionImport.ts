import type { QuestionPayload } from './types';

export type QuestionImportDestination = 'quiz' | 'game';
export type QuestionImportDifficulty = 'easy' | 'moderate' | 'hard';

export interface QuestionImportDefaults {
  destination: QuestionImportDestination;
  level?: number;
  round?: number;
  narrativeDate?: string;
}

export interface ImportedQuestion {
  destination: QuestionImportDestination;
  question: string;
  type: QuestionPayload['type'];
  correctAnswer: string;
  options: string[];
  acceptedAnswers: string[];
  explanation: string;
  reference: string;
  passage: string;
  difficulty: QuestionImportDifficulty;
  level: number | null;
  round: number | null;
  narrativeDate: string | null;
  roundTimerSeconds: number | null;
  passageDisplaySeconds: number | null;
  isBonus: boolean;
  useForQuiz: boolean;
  sourceIndex: number;
}

export interface QuestionImportIssue {
  severity: 'error' | 'warning';
  sourceIndex: number | null;
  message: string;
}

export interface QuestionImportReport {
  questions: ImportedQuestion[];
  issues: QuestionImportIssue[];
  sourceFormat: 'json' | 'labelled-text';
  discoveredCount: number;
}

type ImportContext = Partial<Pick<ImportedQuestion, 'destination' | 'level' | 'round' | 'narrativeDate' | 'difficulty'>>;
type UnknownRecord = Record<string, unknown>;

const QUESTION_TYPE_ALIASES: Record<string, QuestionPayload['type']> = {
  mcq: 'multiple_choice',
  multiplechoice: 'multiple_choice',
  multiple_choice: 'multiple_choice',
  truefalse: 'true_false',
  true_false: 'true_false',
  boolean: 'true_false',
  fillblank: 'fill_blank',
  fill_blank: 'fill_blank',
  fillintheblank: 'fill_blank',
  cloze: 'cloze',
  order: 'order_sequence',
  sequence: 'order_sequence',
  ordersequence: 'order_sequence',
  order_sequence: 'order_sequence',
  buildverse: 'order_sequence',
  matching: 'matching',
  match: 'matching',
  wordtomeaning: 'matching',
  categorysort: 'category_sort',
  category_sort: 'category_sort',
  sort: 'category_sort',
  scriptorium: 'scriptorium',
  firstletter: 'scriptorium',
  verseidentification: 'scriptorium',
  written: 'standard_text',
  text: 'standard_text',
  shortanswer: 'standard_text',
  standardtext: 'standard_text',
  standard_text: 'standard_text',
  comprehension: 'comprehension',
  spoterror: 'spot_error',
  spot_error: 'spot_error',
  elimination: 'elimination',
  spotit: 'spot_it',
  spot_it: 'spot_it',
};

const GAME_TYPES = new Set<QuestionPayload['type']>([
  'multiple_choice', 'true_false', 'standard_text', 'comprehension', 'cloze',
  'matching', 'scriptorium', 'order_sequence', 'category_sort',
]);

const QUIZ_TYPES = new Set<QuestionPayload['type']>([
  'multiple_choice', 'true_false', 'standard_text', 'fill_blank', 'scriptorium', 'order_sequence', 'spot_error',
]);

function recordValue(record: UnknownRecord, ...keys: string[]) {
  for (const key of keys) {
    if (record[key] !== undefined && record[key] !== null) return record[key];
  }
  return undefined;
}

function asText(value: unknown): string {
  if (value == null) return '';
  if (Array.isArray(value)) return value.map((item) => asText(item)).filter(Boolean).join('|');
  if (typeof value === 'object') return '';
  return String(value).trim();
}

function asInteger(value: unknown) {
  const number = Number(value);
  return Number.isInteger(number) ? number : null;
}

function asBoolean(value: unknown) {
  if (typeof value === 'boolean') return value;
  return /^(true|yes|1|on)$/i.test(asText(value));
}

function normalizeToken(value: unknown) {
  return asText(value).toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function normalizeDestination(value: unknown): QuestionImportDestination | null {
  const token = normalizeToken(value);
  if (!token) return null;
  if (token.includes('quiz')) return 'quiz';
  if (token.includes('game')) return 'game';
  return null;
}

function normalizeDifficulty(value: unknown, round?: number | null): QuestionImportDifficulty {
  const token = normalizeToken(value);
  if (token === 'easy' || token === 'beginner' || token === 'simple') return 'easy';
  if (token === 'hard' || token === 'difficult' || token === 'advanced') return 'hard';
  if (token === 'moderate' || token === 'medium' || token === 'intermediate') return 'moderate';
  if (round === 1) return 'easy';
  if (round === 3) return 'hard';
  return 'moderate';
}

function normalizeQuestionType(value: unknown): QuestionPayload['type'] {
  const raw = asText(value).toLowerCase().replace(/[\s/-]+/g, '_');
  return QUESTION_TYPE_ALIASES[raw] || QUESTION_TYPE_ALIASES[normalizeToken(value)] || 'multiple_choice';
}

function isKnownQuestionType(value: unknown) {
  const text = asText(value);
  if (!text) return true;
  const raw = text.toLowerCase().replace(/[\s/-]+/g, '_');
  return Boolean(QUESTION_TYPE_ALIASES[raw] || QUESTION_TYPE_ALIASES[normalizeToken(value)]);
}

function isISODate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function cleanList(values: unknown[]) {
  return Array.from(new Set(values.map((value) => asText(value)).filter(Boolean)));
}

function parseList(value: unknown, preservePipes = false): string[] {
  if (Array.isArray(value)) {
    return cleanList(value.map((item) => {
      if (item && typeof item === 'object') {
        const record = item as UnknownRecord;
        const left = asText(recordValue(record, 'left', 'text', 'item', 'term'));
        const right = asText(recordValue(record, 'right', 'bucket', 'meaning', 'category'));
        return left && right ? `${left} | ${right}` : left || right;
      }
      return item;
    }));
  }
  if (value && typeof value === 'object') return cleanList(Object.values(value as UnknownRecord));
  const text = asText(value);
  if (!text) return [];
  if (text.includes('\n')) return cleanList(text.split(/\r?\n/).map((item) => item.replace(/^\s*[A-H][).:-]\s*/i, '')));
  return cleanList(text.split(preservePipes ? /\s*;\s*/ : /\s*(?:\||;)\s*/));
}

function normalizePrompt(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function contextFromKey(key: string, inherited: ImportContext): ImportContext {
  const context = { ...inherited };
  const token = key.toLowerCase();
  const level = /level[\s_-]*(\d+)/i.exec(token);
  const round = /round[\s_-]*(\d+)/i.exec(token);
  const narrativeDate = /(?:^|\D)(\d{4}-\d{2}-\d{2})(?:\D|$)/.exec(token);
  if (token.includes('quiz')) context.destination = 'quiz';
  if (token.includes('game')) context.destination = 'game';
  if (level) {
    context.destination = 'game';
    context.level = Number(level[1]);
  }
  if (round) context.round = Number(round[1]);
  if (narrativeDate) context.narrativeDate = narrativeDate[1];
  return context;
}

function looksLikeQuestion(record: UnknownRecord) {
  return record.question !== undefined || record.question_text !== undefined || record.prompt !== undefined;
}

function collectJsonQuestions(node: unknown, context: ImportContext, output: Array<{ raw: UnknownRecord; context: ImportContext }>) {
  if (Array.isArray(node)) {
    node.forEach((item) => collectJsonQuestions(item, context, output));
    return;
  }
  if (!node || typeof node !== 'object') return;
  const record = node as UnknownRecord;
  const localContext: ImportContext = {
    ...context,
    destination: normalizeDestination(recordValue(record, 'destination', 'target', 'mode')) || context.destination,
    level: asInteger(recordValue(record, 'game_level', 'level')) ?? context.level,
    round: asInteger(recordValue(record, 'game_round', 'round')) ?? context.round,
    narrativeDate: asText(recordValue(record, 'narrative_date', 'narrativeDate', 'source_date')) || context.narrativeDate,
    difficulty: normalizeDifficulty(recordValue(record, 'difficulty', 'difficulty_tag'), asInteger(recordValue(record, 'game_round', 'round')) ?? context.round),
  };
  if (looksLikeQuestion(record)) {
    output.push({ raw: record, context: localContext });
    return;
  }
  Object.entries(record).forEach(([key, value]) => {
    if (value && typeof value === 'object') collectJsonQuestions(value, contextFromKey(key, localContext), output);
  });
}

function stripCodeFence(input: string) {
  return input.trim().replace(/^```(?:json|text|markdown)?\s*/i, '').replace(/\s*```$/i, '').trim();
}

function parseLabelledQuestions(input: string) {
  const records: Array<{ raw: UnknownRecord; context: ImportContext }> = [];
  let context: ImportContext = {};
  let current: UnknownRecord | null = null;
  let options: string[] = [];

  const flush = () => {
    if (!current || !looksLikeQuestion(current)) return;
    if (options.length > 0) current.options = options;
    records.push({ raw: current, context: { ...context } });
    current = null;
    options = [];
  };

  stripCodeFence(input).split(/\r?\n/).forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    const heading = trimmed.replace(/^#{1,6}\s*/, '').replace(/^\[|\]$/g, '').trim();
    if (/^(quiz|weekly quiz|fortune quiz)$/i.test(heading)) {
      flush(); context = { ...context, destination: 'quiz' }; return;
    }
    if (/^(daily game|game)$/i.test(heading)) {
      flush(); context = { ...context, destination: 'game' }; return;
    }
    const levelHeading = /^level\s*(\d+)(?:\s*[-:]\s*(.*))?$/i.exec(heading);
    if (levelHeading) {
      flush(); context = { ...context, destination: 'game', level: Number(levelHeading[1]) }; return;
    }
    const roundHeading = /^round\s*(\d+)$/i.exec(heading);
    if (roundHeading) {
      flush(); context = { ...context, round: Number(roundHeading[1]) }; return;
    }

    const questionLine = /^(?:question|q)\s*\d*\s*[:.)-]\s*(.+)$/i.exec(trimmed)
      || (!current ? /^\d+\s*[.)-]\s*(.+)$/.exec(trimmed) : null);
    if (questionLine) {
      flush(); current = { question: questionLine[1].trim() }; return;
    }
    const field = /^([a-z][a-z _/-]*?)\s*:\s*(.*)$/i.exec(trimmed);
    if (field) {
      const key = field[1].toLowerCase().replace(/[\s/-]+/g, '_');
      const value = field[2].trim();
      if (key === 'destination' || key === 'target') {
        const destination = normalizeDestination(value);
        if (current) current.destination = destination || value;
        else context.destination = destination || context.destination;
        return;
      }
      if (key === 'level' || key === 'game_level') {
        if (current) current.level = value; else context.level = asInteger(value) ?? context.level;
        return;
      }
      if (key === 'round' || key === 'game_round') {
        if (current) current.round = value; else context.round = asInteger(value) ?? context.round;
        return;
      }
      if (key === 'narrative_date' || key === 'date' || key === 'source_date') {
        if (current) current.narrative_date = value; else context.narrativeDate = value;
        return;
      }
      if (!current && key !== 'question') return;
      if (!current) current = { question: value };
      else if (key === 'options' || key === 'choices' || key === 'items') options.push(...parseList(value));
      else current[key] = value;
      return;
    }
    const optionLine = /^[A-H]\s*[).:-]\s*(.+)$/i.exec(trimmed);
    if (current && optionLine) options.push(optionLine[1].trim());
  });
  flush();
  return records;
}

function normalizeAnswer(rawAnswer: unknown, options: string[]) {
  const answer = asText(rawAnswer);
  const letter = /^([A-H])(?:[).:-])?$/i.exec(answer);
  if (letter) return options[letter[1].toUpperCase().charCodeAt(0) - 65] || answer;
  return answer;
}

function normalizeOne(
  raw: UnknownRecord,
  context: ImportContext,
  defaults: QuestionImportDefaults,
  sourceIndex: number,
  issues: QuestionImportIssue[],
): ImportedQuestion | null {
  const issue = (severity: QuestionImportIssue['severity'], message: string) => issues.push({ severity, sourceIndex, message });
  const question = asText(recordValue(raw, 'question', 'question_text', 'prompt'));
  const rawDestination = recordValue(raw, 'destination', 'target', 'mode');
  const rawType = recordValue(raw, 'type', 'question_type', 'mechanic_type');
  let type = normalizeQuestionType(rawType);
  const explicitLevel = asInteger(recordValue(raw, 'game_level', 'level'));
  const destination = normalizeDestination(rawDestination)
    || context.destination
    || (explicitLevel != null ? 'game' : defaults.destination);
  const round = asInteger(recordValue(raw, 'game_round', 'round')) ?? context.round ?? defaults.round ?? null;
  const level = explicitLevel ?? context.level ?? defaults.level ?? null;
  const narrativeDate = asText(recordValue(raw, 'narrative_date', 'narrativeDate', 'source_date'))
    || context.narrativeDate
    || defaults.narrativeDate
    || null;
  const structuredOptions = recordValue(raw, 'pairs', 'sort_items');
  const preservePipes = type === 'matching' || type === 'category_sort';
  let options = parseList(recordValue(raw, 'options', 'choices', 'items') ?? structuredOptions, preservePipes);
  let correctAnswer = normalizeAnswer(recordValue(raw, 'correct_answer', 'answer', 'correct', 'correct_order'), options);

  if (destination === 'quiz' && type === 'comprehension') type = options.length > 0 ? 'multiple_choice' : 'standard_text';
  if (destination === 'quiz' && type === 'cloze') type = 'fill_blank';
  if (destination === 'game' && type === 'fill_blank') type = 'cloze';
  if (destination === 'game' && ['spot_error', 'elimination', 'spot_it'].includes(type)) type = 'multiple_choice';
  if (type === 'true_false') {
    options = ['True', 'False'];
    if (/^(true|false)$/i.test(correctAnswer)) correctAnswer = `${correctAnswer[0].toUpperCase()}${correctAnswer.slice(1).toLowerCase()}`;
  }
  if ((type === 'matching' || type === 'category_sort') && !correctAnswer && options.length > 0) {
    correctAnswer = options.map((option) => option.split('|').slice(1).join('|').trim()).filter(Boolean).join('|');
  }
  if (type === 'order_sequence' && !correctAnswer && options.length > 0) correctAnswer = options.join('|');

  if (!question) issue('error', 'Question text is missing.');
  if (!correctAnswer) issue('error', `"${question || `Item ${sourceIndex + 1}`}" has no correct answer.`);
  if (asText(rawDestination) && !normalizeDestination(rawDestination)) issue('error', `"${question || `Item ${sourceIndex + 1}`}" has an unknown destination: ${asText(rawDestination)}.`);
  if (!isKnownQuestionType(rawType)) issue('error', `"${question || `Item ${sourceIndex + 1}`}" uses an unknown question type: ${asText(rawType)}.`);
  if (destination === 'game' && (level == null || level < 1 || level > 7)) issue('error', `"${question || `Item ${sourceIndex + 1}`}" needs a game level from 1 to 7.`);
  if (destination === 'game' && (round == null || round < 1 || round > 3)) issue('error', `"${question || `Item ${sourceIndex + 1}`}" needs a round from 1 to 3.`);
  if (destination === 'game' && !narrativeDate) issue('error', `"${question || `Item ${sourceIndex + 1}`}" needs a narrative date.`);
  if (narrativeDate && !isISODate(narrativeDate)) issue('error', `"${question || `Item ${sourceIndex + 1}`}" has an invalid narrative date. Use YYYY-MM-DD.`);
  if (destination === 'quiz' && !QUIZ_TYPES.has(type)) issue('error', `Question type "${type}" is not playable in the Weekly Quiz.`);
  if (destination === 'game' && !GAME_TYPES.has(type)) issue('error', `Question type "${type}" is not playable in the Daily Game.`);

  if (['multiple_choice', 'comprehension'].includes(type)) {
    if (options.length !== 4) issue('error', `"${question || `Item ${sourceIndex + 1}`}" needs exactly four options.`);
    if (correctAnswer && !options.some((option) => option.toLowerCase() === correctAnswer.toLowerCase())) {
      issue('error', `The correct answer for "${question || `Item ${sourceIndex + 1}`}" must exactly match one option.`);
    }
  }
  if (['fill_blank', 'spot_error'].includes(type) && options.length < 2) issue('error', `"${question || `Item ${sourceIndex + 1}`}" needs answer options.`);
  if (['order_sequence', 'matching', 'category_sort'].includes(type) && options.length < 2) issue('error', `"${question || `Item ${sourceIndex + 1}`}" needs at least two items.`);
  if ((type === 'matching' || type === 'category_sort') && options.some((option) => !option.includes('|'))) {
    issue('error', `Every ${type === 'matching' ? 'matching pair' : 'sort item'} must use "left | right" formatting.`);
  }

  const explanation = asText(recordValue(raw, 'explanation', 'rationale', 'teaching_note'));
  const reference = asText(recordValue(raw, 'reference', 'scripture_reference', 'verse_reference'));
  if (!reference) issue('warning', `"${question || `Item ${sourceIndex + 1}`}" has no Scripture reference.`);
  if (issues.some((candidate) => candidate.sourceIndex === sourceIndex && candidate.severity === 'error')) return null;

  return {
    destination,
    question,
    type,
    correctAnswer,
    options,
    acceptedAnswers: parseList(recordValue(raw, 'accepted_answers', 'acceptedAnswers')),
    explanation,
    reference,
    passage: asText(recordValue(raw, 'passage', 'context', 'scripture_text', 'blanked_text')),
    difficulty: normalizeDifficulty(recordValue(raw, 'difficulty', 'difficulty_tag') ?? context.difficulty, round),
    level: destination === 'game' ? level : null,
    round: destination === 'game' ? round : null,
    narrativeDate,
    roundTimerSeconds: asInteger(recordValue(raw, 'round_timer_seconds', 'timer_seconds', 'timer')),
    passageDisplaySeconds: asInteger(recordValue(raw, 'passage_display_seconds', 'passage_seconds')),
    isBonus: asBoolean(recordValue(raw, 'is_bonus', 'bonus')),
    useForQuiz: asBoolean(recordValue(raw, 'use_for_quiz', 'quiz_tag')),
    sourceIndex,
  };
}

export function parseQuestionImport(input: string, defaults: QuestionImportDefaults): QuestionImportReport {
  const cleaned = stripCodeFence(input);
  const issues: QuestionImportIssue[] = [];
  let sourceFormat: QuestionImportReport['sourceFormat'] = 'labelled-text';
  let collected: Array<{ raw: UnknownRecord; context: ImportContext }> = [];

  try {
    const parsed = JSON.parse(cleaned);
    sourceFormat = 'json';
    collectJsonQuestions(parsed, defaults, collected);
  } catch {
    collected = parseLabelledQuestions(cleaned);
  }

  if (collected.length === 0) {
    issues.push({ severity: 'error', sourceIndex: null, message: 'No readable questions were found. Use the format shown in the importer.' });
  }

  const questions: ImportedQuestion[] = [];
  const prompts = new Set<string>();
  collected.forEach(({ raw, context }, index) => {
    const normalized = normalizeOne(raw, context, defaults, index, issues);
    if (!normalized) return;
    const prompt = normalizePrompt(normalized.question);
    if (prompts.has(prompt)) {
      issues.push({ severity: 'warning', sourceIndex: index, message: `Duplicate skipped: "${normalized.question}".` });
      return;
    }
    prompts.add(prompt);
    questions.push(normalized);
  });

  return { questions, issues, sourceFormat, discoveredCount: collected.length };
}

export function questionImportPrompt(destination: QuestionImportDestination) {
  if (destination === 'quiz') {
    return `Generate biblically accurate Weekly Quiz questions as strict JSON. Return JSON only, with no markdown or commentary. Use the root key "questions". Every item must contain destination="quiz", type, difficulty, question, correct_answer, explanation, and reference. Allowed types: multiple_choice, true_false, standard_text, fill_blank, scriptorium, order_sequence, spot_error. Multiple-choice questions must have exactly four plausible options and correct_answer must exactly match one option. Use accepted_answers for valid spelling variants. Use passage when a question depends on a passage. For order_sequence, put the ordered pieces in options and join the correct order with | in correct_answer. Increase difficulty through the set and verify every answer against Scripture.\n\n{"questions":[{"destination":"quiz","type":"multiple_choice","difficulty":"easy","question":"Who interpreted Pharaoh's dreams?","options":["Joseph","Moses","Daniel","Samuel"],"correct_answer":"Joseph","explanation":"Joseph interpreted the dreams in Egypt.","reference":"Genesis 41:15-16"},{"destination":"quiz","type":"standard_text","difficulty":"hard","question":"What name did Jacob give the place where he wrestled with God?","correct_answer":"Peniel","accepted_answers":["Penuel"],"explanation":"Jacob named the place Peniel.","reference":"Genesis 32:30"}]}`;
  }
  return `Generate biblically accurate Daily Game questions as strict JSON. Return JSON only, with no markdown or commentary. Use the root key "questions". Every item must contain destination="game", narrative_date in YYYY-MM-DD, level from 1 to 7, round from 1 to 3, type, difficulty, question, correct_answer, explanation, and reference. Create five questions per round. Round 1 is easy, round 2 moderate, and round 3 hard. Allowed types: multiple_choice, true_false, standard_text, comprehension, cloze, matching, scriptorium, order_sequence, category_sort. Multiple-choice and comprehension questions must have exactly four plausible options and correct_answer must exactly match one option. Use passage for comprehension or verse-dependent questions. For matching and category_sort, format every options entry as "item | match or category". For order_sequence, put the ordered pieces in options and join the correct order with | in correct_answer. Use accepted_answers for valid spelling variants. Verify every answer against Scripture.\n\n{"questions":[{"destination":"game","narrative_date":"2026-08-22","level":1,"round":1,"type":"true_false","difficulty":"easy","question":"Joseph was sold into Egypt by his brothers.","correct_answer":"True","explanation":"His brothers sold him to traders.","reference":"Genesis 37:28"},{"destination":"game","narrative_date":"2026-08-22","level":2,"round":2,"type":"multiple_choice","difficulty":"moderate","question":"What did Pharaoh place on Joseph's hand?","options":["A ring","A bracelet","A staff","A seal scroll"],"correct_answer":"A ring","explanation":"Pharaoh gave Joseph his signet ring.","reference":"Genesis 41:42"}]}`;
}

export function importedQuestionToPayload(question: ImportedQuestion): QuestionPayload {
  const payload: QuestionPayload = {
    type: question.type,
    question: question.question,
    correct_answer: question.correctAnswer,
    difficulty_tag: question.difficulty,
  };
  if (question.options.length > 0) payload.options = question.options;
  if (question.acceptedAnswers.length > 0) payload.accepted_answers = question.acceptedAnswers;
  if (question.explanation) payload.explanation = question.explanation;
  if (question.reference) payload.reference = question.reference;
  if (question.passage) payload.passage = question.passage;
  if (question.round != null) payload.game_round = question.round;
  if (question.roundTimerSeconds != null) payload.round_timer_seconds = question.roundTimerSeconds;
  if (question.passageDisplaySeconds != null) payload.passage_display_seconds = question.passageDisplaySeconds;
  if (question.isBonus) payload.is_bonus = true;
  if (question.type === 'scriptorium' && question.passage) payload.blanked_text = question.passage;
  if (question.type === 'order_sequence') payload.items = question.options;
  return payload;
}

export function questionImportKey(value: string) {
  return normalizePrompt(value);
}
