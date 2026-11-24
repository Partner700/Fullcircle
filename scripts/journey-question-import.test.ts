import assert from 'node:assert/strict';
import { parseJourneyQuestionSet, validateJourneyQuestionSet } from '../src/lib/journeyQuestionImport.ts';

const question = { stage: 1, type: 'multiple_choice', question: 'Who called Samuel by name at night?',
  options: ['Eli', 'The Lord', 'Saul'], correct_answer: 'The Lord', reference: '1 Samuel 3:4' };
assert.deepEqual(parseJourneyQuestionSet(JSON.stringify({ questions: [question] }))[0].options, question.options);
assert.deepEqual(parseJourneyQuestionSet(JSON.stringify([{
  ...question, options: [{ label: 'A', text: 'Eli' }, { label: 'B', text: 'The Lord' }, { label: 'C', text: 'Saul' }],
}]))[0].options, question.options);
assert.throws(() => parseJourneyQuestionSet('{'), /valid JSON/);
assert.throws(() => parseJourneyQuestionSet(JSON.stringify([question, question])), /repeats a prompt/);
assert.throws(() => parseJourneyQuestionSet(JSON.stringify([{ ...question, correct_answer: 'David' }])), /match one of/);
assert.throws(() => parseJourneyQuestionSet(JSON.stringify([{ ...question, reference: '' }])), /Scripture reference/);
assert.equal(parseJourneyQuestionSet(JSON.stringify([{ ...question, stage: 6 }]))[0].stage, 1);
const mixed = validateJourneyQuestionSet(JSON.stringify({ questions: [
  { ...question, type: 'invalid' },
  question,
  question,
  { ...question, question: 'What did Samuel hear in the night?', correct_answer: 'David' },
  { ...question, question: 'Who answered the call after Eli spoke?' },
  { ...question, question: { text: 'Malformed prompt' } },
] }));
assert.equal(mixed.questions.length, 2);
assert.deepEqual(mixed.questions.map((item) => item.question), [
  question.question, 'Who answered the call after Eli spoke?',
]);
assert.deepEqual(mixed.rejected.map((item) => item.number), [1, 3, 4, 6]);
assert.match(mixed.rejected[1].reason, /repeats a prompt/);
assert.throws(() => validateJourneyQuestionSet('{'), /valid JSON/);

for (const length of [1, 4, 5, 6, 199, 200, 201, 300]) {
  const batch = Array.from({ length }, (_, i) => ({ ...question, stage: undefined,
    question: `Which answer belongs to test question ${i}?`, difficulty_tag: i < length / 2 ? 'hard' : 'easy' }));
  const result = validateJourneyQuestionSet(JSON.stringify(batch));
  assert.equal(result.questions.length, length);
  assert.equal(result.rejected.length, 0);
  const counts = [1, 2, 3, 4, 5].map(stage => result.questions.filter(q => q.stage === stage).length);
  assert.ok(Math.max(...counts) - Math.min(...counts) <= 1);
  if (length === 200) assert.deepEqual(counts, [40, 40, 40, 40, 40]);
  assert.ok(result.questions[0].stage >= result.questions[length - 1].stage, 'harder questions belong later');
}
const whitespaceDuplicate = validateJourneyQuestionSet(JSON.stringify([question, {
  ...question, question: '  WHO   called Samuel by name at night?  ',
}]));
assert.equal(whitespaceDuplicate.questions.length, 1);
assert.equal(whitespaceDuplicate.rejected.length, 1);
const formats = [
  { type: 'true_false', options: [], correct_answer: 'true' },
  { type: 'multiple_choice', options: ['One', 'Two', 'Three'], correct_answer: 'One' },
  { type: 'odd_one', options: ['One', 'Two', 'Three'], correct_answer: 'Three' },
  { type: 'fill_blank', options: [], correct_answer: 'Samuel' },
  { type: 'order_sequence', options: ['First', 'Second', 'Third'], correct_answer: 'A C B' },
];
const everyFormat = validateJourneyQuestionSet(JSON.stringify(Array.from({ length: 200 }, (_, i) => ({
  ...formats[i % formats.length], question: `Import format test ${i}`, reference: '1 Samuel 3:4',
}))));
assert.equal(everyFormat.questions.length, 200);
assert.equal(everyFormat.rejected.length, 0);
console.log('Journey set import validation passed.');
