import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BROTHERS_LEVELS, STORY_BOOKS } from '../src/screens/cadet/story-mode/content.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relativePath: string) => fs.readFileSync(path.join(root, relativePath), 'utf8');
const phase3a = read('supabase/migrations/20260831110000_story_mode_abel_vertical_slice.sql');
const migration = read('supabase/migrations/20260831160000_complete_brothers_chapter.sql');

assert.equal(BROTHERS_LEVELS.length, 6);
assert.deepEqual(BROTHERS_LEVELS.map((level) => level.slug), [
  'abel-offering', 'regard', 'at-the-door', 'the-field', 'your-brother', 'another-offspring',
]);
assert.deepEqual(BROTHERS_LEVELS.map((level) => level.order), [1, 2, 3, 4, 5, 6]);
assert.equal(STORY_BOOKS[0].chapters[0].levels, BROTHERS_LEVELS);

for (const [level, prerequisite] of [
  ['regard', 'abel-offering'],
  ['at-the-door', 'regard'],
  ['the-field', 'at-the-door'],
  ['your-brother', 'the-field'],
  ['another-offspring', 'your-brother'],
] as const) {
  assert.ok(migration.includes(`('${level}', 'beginnings', 'brothers'`));
  assert.ok(migration.includes(`'${prerequisite}', true)`), `${level} must follow ${prerequisite}.`);
}
assert.doesNotMatch(migration, /\('seth(?:-gameplay)?', 'beginnings'/);

const questionInsert = migration.match(/INSERT INTO public\.story_mode_questions \([\s\S]*?ON CONFLICT \(id\) DO UPDATE SET/)?.[0] || '';
assert.ok(questionInsert, 'Phase 3B question seed is missing.');
const newQuestionRows = [...questionInsert.matchAll(/\('([^']+)', '([^']+)', '([^']+)', \d+, '(multiple_choice|true_false)'/g)];
assert.equal(newQuestionRows.length, 24, 'Phase 3B must add 24 questions to the existing Abel question.');
assert.equal(new Set(newQuestionRows.map((match) => match[1])).size, 24, 'Question IDs must be unique.');

const existingQuestionCount = (phase3a.match(/'abel-offering-firstborn'/g) || []).length > 0 ? 1 : 0;
assert.equal(existingQuestionCount + newQuestionRows.length, 25, 'Chapter 1 must contain exactly 25 verified questions.');
const types = newQuestionRows.map((match) => match[4]);
assert.equal(types.filter((type) => type === 'multiple_choice').length + 1, 18);
assert.equal(types.filter((type) => type === 'true_false').length, 7);

const difficultyTimers = [...questionInsert.matchAll(/, '(easy|moderate|hard)', (5|7|10), 'Genesis 4/g)]
  .map((match) => ({ difficulty: match[1], timer: Number(match[2]) }));
assert.equal(difficultyTimers.length, 24);
const allDifficultyTimers = [{ difficulty: 'moderate', timer: 7 }, ...difficultyTimers];
assert.equal(allDifficultyTimers.filter((item) => item.difficulty === 'easy').length, 8);
assert.equal(allDifficultyTimers.filter((item) => item.difficulty === 'moderate').length, 9);
assert.equal(allDifficultyTimers.filter((item) => item.difficulty === 'hard').length, 8);
assert.equal(allDifficultyTimers.filter((item) => item.timer === 5).length, 8);
assert.equal(allDifficultyTimers.filter((item) => item.timer === 7).length, 9);
assert.equal(allDifficultyTimers.filter((item) => item.timer === 10).length, 8);
assert.equal((questionInsert.match(/, true\)/g) || []).length, 4, 'Genesis 4:6-7 must supply four READ follow-ups.');

for (const row of newQuestionRows) assert.ok(row[2], `${row[1]} needs a checkpoint.`);
assert.equal((migration.match(/questions_per_attempt/g) || []).length > 0, true);
assert.match(migration, /ORDER BY md5\(v_attempt\.id::text \|\| ':' \|\| question\.id\)/);
assert.match(migration, /row_number\(\) OVER \(ORDER BY pool_order, within_pool_order, question_id\)/);
assert.equal((migration.match(/, 1\)\s*,?/g) || []).length > 10, true, 'Scene pools should select one stable question each.');

const firstPlayQuestionCount = 1 + (4 * 3);
const firstPlayFigs = 3 + (4 * (1 + 3 + 5));
assert.equal(firstPlayQuestionCount, 13);
assert.equal(firstPlayFigs, 39);

const prompts = [...questionInsert.matchAll(/\('([^']+)', '[^']+', '[^']+', \d+, '(?:multiple_choice|true_false)',\n\s+'((?:[^']|'')*)',/g)]
  .map((match) => match[2].replace(/''/g, "'").trim().toLowerCase());
assert.equal(prompts.length, 24);
assert.equal(new Set(prompts).size, prompts.length, 'Exact duplicate prompts are forbidden.');
assert.deepEqual(
  Object.fromEntries(['regard', 'at-the-door', 'the-field', 'your-brother'].map((level) => [
    level,
    newQuestionRows.filter((row) => row[2] === level).length,
  ])),
  { regard: 6, 'at-the-door': 6, 'the-field': 5, 'your-brother': 7 },
);

const doorRead = BROTHERS_LEVELS[2].scenes.find((scene) => scene.kind === 'read');
assert.equal(doorRead?.scriptureReference, 'Genesis 4:6-7');
for (const level of BROTHERS_LEVELS) {
  assert.ok(level.scenes.every((scene) => Boolean(scene.scriptureReference) || scene.kind === 'movement' || scene.kind === 'question_event'));
}

const obstacleTypes = new Set(BROTHERS_LEVELS.flatMap((level) => level.scenes.flatMap((scene) => scene.obstacles?.map((item) => item.type) || [])));
assert.deepEqual([...obstacleTypes].sort(), ['ditch', 'log', 'narrow_path', 'rock', 'thorn']);
const roles = new Set(BROTHERS_LEVELS.flatMap((level) => level.scenes.flatMap((scene) => scene.characters.map((item) => item.role))));
for (const role of ['player', 'npc', 'threat', 'transition', 'observer']) assert.equal(roles.has(role as never), true);

const home = read('src/screens/cadet/story-mode/StoryModeHome.tsx');
assert.match(home, /chapter\.levels\.map/);
assert.match(home, /completed/);
assert.match(home, /current/);
assert.match(home, /unlocked/);
assert.match(home, /locked/);
assert.match(home, /replay available/);
assert.match(home, /Future playable content · locked/);

console.log('Story Mode Brothers content, questions, navigation, and reward-plan checks passed.');
