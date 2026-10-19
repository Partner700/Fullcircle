import assert from 'node:assert/strict';
import { parseJourneyQuestionSet } from '../src/lib/journeyQuestionImport.ts';

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
console.log('Journey set import validation passed.');
