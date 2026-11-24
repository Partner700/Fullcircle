const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const rollout = require('./elisha-reviewed-rollout.json');
const defaultPayload = path.resolve(__dirname, '../../../outputs/biblical-journey-question-import/elisha-import-pending.json');

function prepare(payloadPath = defaultPayload) {
  const bytes = fs.readFileSync(payloadPath);
  const hash = crypto.createHash('sha256').update(bytes).digest('hex');
  if (hash !== rollout.sourcePayloadSha256) throw new Error('The staged Elisha payload changed. Nothing can be approved.');
  const staged = JSON.parse(bytes.toString('utf8'));
  if (staged.p_character_slug !== rollout.character || staged.p_questions.length !== 235) {
    throw new Error('The staged Elisha character or question count changed.');
  }
  const selectedNumbers = new Set(rollout.approvedSourceRanges.flatMap(([first, last]) =>
    Array.from({ length: last - first + 1 }, (_, index) => first + index)));
  const selected = staged.p_questions.filter((question) => selectedNumbers.has(question.source_number));
  if (selected.length !== selectedNumbers.size || selected.length !== 84) {
    throw new Error('The reviewed source selection is incomplete.');
  }
  const supplements = rollout.supplements.map((question) => ({
    ...question,
    source_kind: 'authored-web-checked-supplement',
  }));
  const items = [...selected, ...supplements];
  const prompts = new Set();
  const stages = new Map();
  for (const item of items) {
    if (!item.question?.trim() || !item.correct_answer?.trim() || !item.reference?.trim()) {
      throw new Error(`Reviewed question ${item.source_number} is incomplete.`);
    }
    const prompt = item.question.trim().toLowerCase();
    if (prompts.has(prompt)) throw new Error(`Repeated reviewed question ${item.source_number}.`);
    prompts.add(prompt);
    stages.set(item.stage, (stages.get(item.stage) || 0) + 1);
  }
  if (items.length !== 88 || [1, 2, 3, 4, 5].some((stage) => (stages.get(stage) || 0) < 10)) {
    throw new Error('The reviewed Elisha package does not cover every stage.');
  }
  return { character: rollout.character, items };
}

if (require.main === module) {
  try {
    const packet = prepare(process.argv[3] || defaultPayload);
    if (process.argv[2] === '--base64') {
      process.stdout.write(Buffer.from(JSON.stringify(packet)).toString('base64'));
    } else {
      console.log(`Prepared ${packet.items.length} reviewed Elisha questions; nothing was changed online.`);
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = { prepare };
