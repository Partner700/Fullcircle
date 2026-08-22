import assert from 'node:assert/strict';
import {
  importedQuestionToPayload,
  parseQuestionImport,
} from '../src/lib/questionImport.ts';

const gameDefaults = {
  destination: 'game' as const,
  level: 1,
  round: 1,
  narrativeDate: '2026-08-22',
};

// Nested banks inherit their destination, level, round, and narrative date.
{
  const report = parseQuestionImport(JSON.stringify({
    daily_game: {
      '2026-08-23': {
        level_2: {
          round_1: [{
            type: 'multiple_choice',
            question: 'Who interpreted Pharaoh\'s dreams?',
            options: ['Joseph', 'Moses', 'Daniel', 'Samuel'],
            correct_answer: 'Joseph',
            reference: 'Genesis 41:15-16',
          }],
        },
      },
    },
  }), gameDefaults);
  assert.equal(report.questions.length, 1);
  assert.equal(report.questions[0].destination, 'game');
  assert.equal(report.questions[0].level, 2);
  assert.equal(report.questions[0].round, 1);
  assert.equal(report.questions[0].narrativeDate, '2026-08-23');
}

// Letter answers from externally generated quiz files resolve to option text.
{
  const report = parseQuestionImport(JSON.stringify({ questions: [{
    destination: 'quiz',
    type: 'mcq',
    question: 'Where was Jesus born?',
    options: ['Nazareth', 'Bethlehem', 'Jerusalem', 'Capernaum'],
    answer: 'B',
    reference: 'Matthew 2:1',
  }] }), { destination: 'quiz' });
  assert.equal(report.questions.length, 1);
  assert.equal(report.questions[0].correctAnswer, 'Bethlehem');
}

// Labelled text can be pasted without first converting it to JSON.
{
  const report = parseQuestionImport(`
Daily Game
Level 3
Round 2
Question 1: Ruth was a Moabite.
Type: true_false
Answer: True
Reference: Ruth 1:4
`, gameDefaults);
  assert.equal(report.sourceFormat, 'labelled-text');
  assert.equal(report.questions.length, 1);
  assert.equal(report.questions[0].level, 3);
  assert.equal(report.questions[0].round, 2);
  assert.deepEqual(report.questions[0].options, ['True', 'False']);
}

// A repeated prompt inside one bank is retained only once.
{
  const report = parseQuestionImport(JSON.stringify({ questions: [
    { type: 'true_false', question: 'David was king.', answer: 'True', reference: '2 Samuel 5:4' },
    { type: 'true_false', question: 'David was king.', answer: 'True', reference: '2 Samuel 5:4' },
  ] }), gameDefaults);
  assert.equal(report.discoveredCount, 2);
  assert.equal(report.questions.length, 1);
  assert.ok(report.issues.some((issue) => issue.message.startsWith('Duplicate skipped:')));
}

// Malformed multiple-choice questions never enter the ready set.
{
  const report = parseQuestionImport(JSON.stringify({ questions: [{
    type: 'multiple_choice',
    question: 'Which apostle was a tax collector?',
    options: ['Matthew', 'Peter', 'John'],
    answer: 'Matthew',
    reference: 'Matthew 9:9',
  }] }), { destination: 'quiz' });
  assert.equal(report.questions.length, 0);
  assert.ok(report.issues.some((issue) => issue.severity === 'error' && issue.message.includes('exactly four options')));
}

// Unknown mechanics and impossible dates are rejected instead of guessed.
{
  const report = parseQuestionImport(JSON.stringify({ questions: [{
    type: 'mystery_grid',
    narrative_date: '2026-13-40',
    question: 'A question with an unsupported mechanic',
    options: ['One', 'Two', 'Three', 'Four'],
    answer: 'One',
    reference: 'Genesis 1:1',
  }] }), gameDefaults);
  assert.equal(report.questions.length, 0);
  assert.ok(report.issues.some((issue) => issue.message.includes('unknown question type')));
  assert.ok(report.issues.some((issue) => issue.message.includes('invalid narrative date')));
}

// An explicit unknown destination cannot fall through into the open builder.
{
  const report = parseQuestionImport(JSON.stringify({ questions: [{
    destination: 'arena',
    type: 'multiple_choice',
    question: 'This item belongs to an unsupported destination.',
    options: ['One', 'Two', 'Three', 'Four'],
    answer: 'One',
    reference: 'Genesis 1:1',
  }] }), gameDefaults);
  assert.equal(report.questions.length, 0);
  assert.ok(report.issues.some((issue) => issue.message.includes('unknown destination')));
}

// Answer aliases and references survive conversion to a playable payload.
{
  const report = parseQuestionImport(JSON.stringify({ questions: [{
    type: 'standard_text',
    question: 'Name the place Jacob called Peniel.',
    answer: 'Peniel',
    accepted_answers: ['Penuel'],
    reference: 'Genesis 32:30',
  }] }), { destination: 'quiz' });
  const payload = importedQuestionToPayload(report.questions[0]);
  assert.deepEqual(payload.accepted_answers, ['Penuel']);
  assert.equal(payload.reference, 'Genesis 32:30');
}

console.log('External question-import checks passed.');
