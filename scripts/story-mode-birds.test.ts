import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DOVE_LEVEL, OLIVE_LEAF_LEVEL, RAVEN_LEVEL } from '../src/screens/cadet/story-mode/floodContent.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relativePath: string) => fs.readFileSync(path.join(root, relativePath), 'utf8');
const migration = read('supabase/migrations/20260901150000_story_mode_flood_book_completion.sql');
const effects = read('src/screens/cadet/story-mode/StoryEnvironmentEffects.tsx');
const css = read('src/index.css');
const marker = '$flood_questions$';
const start = migration.indexOf(marker) + marker.length;
const questions = JSON.parse(migration.slice(start, migration.indexOf(marker, start))) as Array<{
  id: string;
  level_slug: string;
  prompt: string;
  correct_answer: string;
  scripture_reference: string;
}>;

assert.equal(RAVEN_LEVEL.order, 17);
assert.equal(DOVE_LEVEL.order, 18);
assert.equal(OLIVE_LEAF_LEVEL.order, 19);
assert.match(RAVEN_LEVEL.scenes.map((scene) => scene.narrativeText).join(' '), /to and fro/i);
assert.match(DOVE_LEVEL.scenes.map((scene) => scene.narrativeText).join(' '), /no resting place/i);
assert.match(OLIVE_LEAF_LEVEL.scenes.map((scene) => scene.narrativeText).join(' '), /olive leaf/i);
assert.match(OLIVE_LEAF_LEVEL.scenes.map((scene) => scene.narrativeText).join(' '), /does not return/i);

const birdStages = [...migration.matchAll(/\('noah-flood-environment', (\d+), '([^']+)'[^\n]*'(raven|dove)', '(flying|returned|carrying|no_return)'/g)]
  .map((match) => ({ order: Number(match[1]), slug: match[2], bird: match[3], state: match[4] }));
assert.deepEqual(birdStages, [
  { order: 9, slug: 'raven-released', bird: 'raven', state: 'flying' },
  { order: 10, slug: 'first-dove-returned', bird: 'dove', state: 'returned' },
  { order: 11, slug: 'olive-leaf-returned', bird: 'dove', state: 'carrying' },
  { order: 12, slug: 'third-dove-no-return', bird: 'dove', state: 'no_return' },
]);

assert.match(migration, /'the-raven', 'raven-movement-moderate'/);
assert.match(migration, /'the-dove', 'dove-return-moderate'/);
assert.match(migration, /'an-olive-leaf', 'olive-leaf-easy'/);
assert.match(migration, /'an-olive-leaf', 'olive-third-hard'/);

const birdQuestions = questions.filter((question) => ['the-raven', 'the-dove', 'an-olive-leaf'].includes(question.level_slug));
assert.equal(birdQuestions.length, 14);
assert.ok(birdQuestions.every((question) => /^Genesis 8:(6|7|8|9|10|11|12)/.test(question.scripture_reference)));
assert.ok(birdQuestions.some((question) => /seven more days/i.test(question.prompt) || /Seven more days/i.test(question.correct_answer)));
assert.ok(birdQuestions.some((question) => /freshly plucked olive leaf/i.test(question.correct_answer)));
assert.ok(birdQuestions.some((question) => /did not return/i.test(question.correct_answer)));

assert.match(effects, /story-bird-\$\{state\.birdKind\}/);
assert.match(effects, /story-bird-\$\{state\.birdState\}/);
assert.match(effects, /state\.oliveLeafVisible/);
assert.match(effects, /state\.birdState !== 'no_return'/);
assert.match(css, /story-bird-raven/);
assert.match(css, /story-bird-returned/);
assert.match(css, /story-olive-leaf/);
assert.doesNotMatch(effects, /physics|velocity|collision|pathfinding/i);

console.log('Story Mode bird sequence: raven, first dove return, second-release leaf, third-release non-return, waits, visuals, and Scripture order passed.');
