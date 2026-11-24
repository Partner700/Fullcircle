import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

type LegacyQuestion = {
  source_number: number;
  type: string;
  question: string;
  options?: string[];
  correct_answer: string;
  reference: string;
};

const source = JSON.parse(readFileSync(new URL('./elisha-legacy-questions.json', import.meta.url), 'utf8')) as {
  character: string;
  stage: number;
  questions: LegacyQuestion[];
};

assert.equal(source.character, 'Elisha');
assert.equal(source.stage, 5);
assert.equal(source.questions.length, 35);
assert.deepEqual(source.questions.map((item) => item.source_number), Array.from({ length: 35 }, (_, index) => index + 201));
assert.deepEqual(Object.fromEntries(['true_false', 'multiple_choice', 'odd_one', 'fill_blank', 'order_sequence']
  .map((type) => [type, source.questions.filter((item) => item.type === type).length])), {
  true_false: 7,
  multiple_choice: 10,
  odd_one: 5,
  fill_blank: 8,
  order_sequence: 5,
});
assert.equal(new Set(source.questions.map((item) => item.question.trim().toLowerCase())).size, 35);

for (const item of source.questions) {
  assert.match(item.reference, /^2 Kings (?:8|13):[\d,;:\-\s]+$/);
  assert.ok(item.question.trim().length >= 5);
  assert.ok(item.correct_answer.trim());
  if (item.type === 'true_false') assert.ok(['true', 'false'].includes(item.correct_answer));
  if (item.type === 'fill_blank') assert.match(item.question, /_____/);
  if (item.type === 'multiple_choice' || item.type === 'odd_one') {
    assert.ok((item.options?.length || 0) >= 3);
    assert.ok(item.options?.includes(item.correct_answer));
  }
  if (item.type === 'order_sequence') {
    const labels = item.options?.map((option) => option[0]) || [];
    assert.ok(labels.length >= 3);
    assert.equal(new Set(item.correct_answer.split(' ')).size, labels.length);
    assert.deepEqual(new Set(item.correct_answer.split(' ')), new Set(labels));
    assert.notEqual(item.correct_answer, labels.join(' '));
  }
}

console.log('Elisha Stage 5: 35 sourced, uniquely numbered questions across all five formats.');
