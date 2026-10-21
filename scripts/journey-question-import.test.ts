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
assert.throws(() => parseJourneyQuestionSet(JSON.stringify([{ ...question, stage: 6 }])), /valid stage/);
const mixed = validateJourneyQuestionSet(JSON.stringify({ questions: [
  { ...question, stage: 6 },
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
console.log('Journey set import validation passed.');
