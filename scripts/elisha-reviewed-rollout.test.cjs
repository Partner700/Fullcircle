const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const rollout = require('./elisha-reviewed-rollout.json');
assert.equal(rollout.character, 'elisha');
assert.deepEqual(rollout.approvedSourceRanges, [[8, 14], [52, 60], [109, 124], [177, 193], [201, 235]]);

const selectedNumbers = new Set(rollout.approvedSourceRanges.flatMap(([first, last]) =>
  Array.from({ length: last - first + 1 }, (_, index) => first + index)));
assert.equal(selectedNumbers.size, 84);
assert.equal(rollout.supplements.length, 4);
assert.deepEqual(rollout.supplements.map((question) => question.source_number), [236, 237, 238, 239]);

const stageCounts = new Map();
const prompts = new Set();
function checkQuestion(question) {
  assert.ok(question.question?.trim());
  assert.ok(question.reference?.trim());
  assert.ok(question.correct_answer?.trim());
  assert.ok(Number.isInteger(question.stage) && question.stage >= 1 && question.stage <= 5);
  if (['multiple_choice', 'odd_one'].includes(question.type)) {
    assert.ok(question.options.length >= 3);
    assert.ok(question.options.includes(question.correct_answer));
  }
  if (question.type === 'order_sequence') {
    const order = question.correct_answer.split(' ');
    assert.equal(order.length, question.options.length);
    assert.deepEqual([...order].sort(), question.options.map((_, index) => String.fromCharCode(65 + index)));
  }
  const prompt = question.question.trim().toLowerCase();
  assert.ok(!prompts.has(prompt), `Repeated approved prompt: ${question.question}`);
  prompts.add(prompt);
  stageCounts.set(question.stage, (stageCounts.get(question.stage) || 0) + 1);
}

for (const question of rollout.supplements) {
  assert.equal(question.type, 'multiple_choice');
  assert.match(question.source_url, /^https:\/\/ebible\.org\/eng-web\//);
  checkQuestion(question);
}

const suppliedPayload = process.env.ELISHA_STAGED_PAYLOAD ||
  path.resolve(__dirname, '../../../outputs/biblical-journey-question-import/elisha-import-pending.json');
if (fs.existsSync(suppliedPayload)) {
  const bytes = fs.readFileSync(suppliedPayload);
  assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), rollout.sourcePayloadSha256);
  const payload = JSON.parse(bytes.toString('utf8'));
  assert.equal(payload.p_character_slug, 'elisha');
  const selected = payload.p_questions.filter((question) => selectedNumbers.has(question.source_number));
  assert.equal(selected.length, selectedNumbers.size);
  for (const question of selected) checkQuestion(question);
  for (const stage of [1, 2, 3, 4, 5]) {
    assert.ok(stageCounts.get(stage) >= 10, `Stage ${stage} has fewer than ten verified questions`);
  }
  assert.equal(prompts.size, 88);
  console.log(`Elisha rollout checked: ${prompts.size} distinct questions across five stages.`);
} else {
  console.log('Elisha rollout manifest checked; the staged payload is checked separately before publication.');
}
