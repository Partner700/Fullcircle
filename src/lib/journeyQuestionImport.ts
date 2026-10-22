export type JourneyImportQuestion = {
  stage: number;
  type: 'true_false' | 'multiple_choice' | 'odd_one' | 'fill_blank' | 'order_sequence';
  question: string;
  options: string[];
  correct_answer: string;
  accepted_answers: string[];
  reference: string;
  explanation: string | null;
  difficulty_tag: 'easy' | 'moderate' | 'hard';
};

const types = new Set(['true_false', 'multiple_choice', 'odd_one', 'fill_blank', 'order_sequence']);
const difficulties = new Set(['easy', 'moderate', 'hard']);
export const JOURNEY_MINIMUM_QUESTIONS = 200;

// Match the database's five balanced bands, with easier questions first.
export function assignJourneyStages(questions: JourneyImportQuestion[]): JourneyImportQuestion[] {
  const rank = { easy: 0, moderate: 1, hard: 2 };
  const sorted = questions.map((question, index) => ({ question, index }))
    .sort((a, b) => rank[a.question.difficulty_tag] - rank[b.question.difficulty_tag] || a.index - b.index);
  const stages = new Map<number, number>();
  const base = Math.floor(sorted.length / 5);
  const extra = sorted.length % 5;
  let offset = 0;
  for (let stage = 1; stage <= 5; stage += 1) {
    for (let count = 0; count < base + (stage <= extra ? 1 : 0); count += 1) {
      stages.set(sorted[offset++].index, stage);
    }
  }
  return questions.map((question, index) => ({ ...question, stage: stages.get(index)! }));
}

export type JourneyRejectedQuestion = { number: number; reason: string };

function readQuestionArray(source: string): unknown[] {
  let document: unknown;
  try { document = JSON.parse(source); }
  catch { throw new Error('The question set must be valid JSON.'); }
  const items = Array.isArray(document) ? document
    : document && typeof document === 'object' && 'questions' in document
      ? (document as { questions: unknown }).questions : null;
  if (!Array.isArray(items) || items.length < 1 || items.length > 300) {
    throw new Error('Use an array of 1 to 300 questions, or an object containing that questions array.');
  }
  return items;
}

function parseQuestion(raw: unknown, index: number, seen: Set<string>): JourneyImportQuestion {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error(`Question ${index + 1} must be an object.`);
  const item = raw as Record<string, unknown>;
  if (typeof item.question !== 'string' || typeof item.correct_answer !== 'string'
    || typeof item.reference !== 'string' || typeof item.type !== 'string'
    || (item.options !== undefined && !Array.isArray(item.options))
    || (item.accepted_answers !== undefined && !Array.isArray(item.accepted_answers))
    || (item.explanation != null && typeof item.explanation !== 'string')) {
    throw new Error(`Question ${index + 1} needs a text prompt, answer, type, and Scripture reference.`);
  }
    const type = String(item.type || '');
    const question = String(item.question || '').trim();
    const answer = String(item.correct_answer || '').trim();
    const reference = String(item.reference || '').trim();
    const difficulty = String(item.difficulty_tag || 'moderate');
    const options = Array.isArray(item.options) ? item.options.map((option) =>
      typeof option === 'string' ? option.trim()
        : option && typeof option === 'object' && 'text' in option ? String(option.text).trim() : '') : [];
    const accepted = Array.isArray(item.accepted_answers) ? item.accepted_answers : [];
    if (!types.has(type)
      || question.length < 5 || question.length > 4000 || answer.length < 1 || answer.length > 2000
      || reference.length < 3 || options.length > 8 || options.some((option) => !option || option.length > 500)
      || accepted.some((value) => typeof value !== 'string') || !difficulties.has(difficulty)) {
      throw new Error(`Question ${index + 1} needs a valid type, prompt, answer, options, and Scripture reference.`);
    }
    if (['multiple_choice', 'odd_one'].includes(type) &&
      (options.length < 3 || options.length > 6 || !options.some((option) => option.toLowerCase() === answer.toLowerCase()))) {
      throw new Error(`Question ${index + 1}: the answer must match one of 3 to 6 options.`);
    }
    if (type === 'true_false' && (!['true', 'false'].includes(answer.toLowerCase()) || options.length)) {
      throw new Error(`Question ${index + 1}: true/false uses a true or false answer without options.`);
    }
    if (type === 'order_sequence') {
      const labels = answer.toUpperCase().split(/\s+/);
      if (options.length < 3 || labels.length !== options.length || new Set(labels).size !== labels.length
        || labels.some((label) => !/^[A-H]$/.test(label) || label.charCodeAt(0) - 65 >= options.length)) {
        throw new Error(`Question ${index + 1}: a sequence answer must use each letter once, such as A C B.`);
      }
    }
    const key = question.toLowerCase().replace(/\s+/g, ' ');
    if (seen.has(key)) throw new Error(`Question ${index + 1} repeats a prompt in this upload.`);
    seen.add(key);
    return {
      stage: 1, type: type as JourneyImportQuestion['type'], question, options,
      correct_answer: answer, accepted_answers: accepted as string[], reference,
      explanation: item.explanation ? String(item.explanation).trim() : null,
      difficulty_tag: difficulty as JourneyImportQuestion['difficulty_tag'],
    };
}

export function validateJourneyQuestionSet(source: string): {
  questions: JourneyImportQuestion[];
  rejected: JourneyRejectedQuestion[];
} {
  const items = readQuestionArray(source);
  const seen = new Set<string>();
  const questions: JourneyImportQuestion[] = [];
  const rejected: JourneyRejectedQuestion[] = [];
  items.forEach((raw, index) => {
    try { questions.push(parseQuestion(raw, index, seen)); }
    catch (error) {
      rejected.push({ number: index + 1, reason: error instanceof Error ? error.message : `Question ${index + 1} could not be checked.` });
    }
  });
  return { questions: assignJourneyStages(questions), rejected };
}

export function parseJourneyQuestionSet(source: string): JourneyImportQuestion[] {
  const { questions, rejected } = validateJourneyQuestionSet(source);
  if (rejected.length) throw new Error(rejected[0].reason);
  return questions;
}
