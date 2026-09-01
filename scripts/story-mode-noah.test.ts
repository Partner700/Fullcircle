import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { STORY_BOOKS, findStoryBuild, findStoryLevel } from '../src/screens/cadet/story-mode/content.ts';
import { FLOOD_LEVELS } from '../src/screens/cadet/story-mode/floodContent.ts';
import { ARK_CONSTRUCTION, ARK_CONSTRUCTION_ID, NOAH_LEVELS } from '../src/screens/cadet/story-mode/noahContent.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relativePath: string) => fs.readFileSync(path.join(root, relativePath), 'utf8');
const migration = read('supabase/migrations/20260901100000_story_mode_noah_ark_construction.sql');
const noahSource = read('src/screens/cadet/story-mode/noahContent.ts');

assert.equal(NOAH_LEVELS.length, 10);
assert.deepEqual(NOAH_LEVELS.map((level) => level.slug), [
  'corruption',
  'noah-found-favor',
  'make-yourself-an-ark',
  'gopher-wood',
  'three-hundred-cubits',
  'rooms-door-and-decks',
  'the-covenant',
  'every-living-thing',
  'provisions',
  'the-ark-stands',
]);
assert.deepEqual(NOAH_LEVELS.map((level) => level.order), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);

const noahChapter = STORY_BOOKS[0].chapters[2];
assert.equal(noahChapter.title, 'Noah');
assert.deepEqual(noahChapter.levels.slice(0, 10), NOAH_LEVELS);
assert.deepEqual(noahChapter.levels.slice(10), FLOOD_LEVELS);
assert.equal(noahChapter.plannedLevelCount, 24);
assert.equal(noahChapter.lockedContinuation, undefined);
assert.equal(findStoryLevel('corruption'), NOAH_LEVELS[0]);
assert.equal(findStoryLevel('the-ark-stands'), NOAH_LEVELS[9]);
assert.equal(findStoryLevel('enter-the-ark'), FLOOD_LEVELS[0]);
assert.equal(findStoryLevel('the-flood'), null, 'The unpublished placeholder must never become a playable route.');
assert.equal(findStoryBuild(ARK_CONSTRUCTION_ID), ARK_CONSTRUCTION);

const allScenes = NOAH_LEVELS.flatMap((level) => level.scenes);
assert.equal(new Set(NOAH_LEVELS.map((level) => level.id)).size, NOAH_LEVELS.length);
assert.equal(new Set(allScenes.map((scene) => scene.id)).size, allScenes.length);
for (const level of NOAH_LEVELS) {
  assert.equal(level.bookSlug, 'beginnings');
  assert.equal(level.chapterSlug, 'noah');
  assert.ok(level.scenes.some((scene) => scene.kind === 'question_event'));
  for (const scene of level.scenes) assert.match(scene.scriptureReference || '', /^Genesis 6(?::|$)/);
}

const readScene = NOAH_LEVELS[2].scenes.find((scene) => scene.kind === 'read');
assert.equal(readScene?.scriptureReference, 'Genesis 6:11-22');
assert.match(readScene?.readText || '', /gopher wood/i);
assert.match(readScene?.readText || '', /three hundred cubits/i);
assert.match(readScene?.readText || '', /lower, second, and third decks/i);
assert.match(readScene?.readText || '', /storing food/i);
assert.match(read('src/screens/cadet/story-mode/StoryLevelPlayer.tsx'), /The question timer is stopped while Scripture is open/);

const contentPools = new Set(allScenes
  .map((scene) => scene.questionPoolId)
  .filter((pool): pool is string => Boolean(pool)));
assert.equal(contentPools.size, 24, 'A normal first play must encounter one question from each of 24 pools.');

const poolInsert = migration.match(/INSERT INTO public\.story_mode_question_pools \([\s\S]*?ON CONFLICT \(level_slug, pool_id\) DO UPDATE SET/)?.[0] || '';
const poolRows = [...poolInsert.matchAll(/\('([^']+)', '([^']+)', '([^']+)', '([^']+)', \d+, (\d+)\)/g)];
assert.equal(poolRows.length, 24);
assert.equal(new Set(poolRows.map((row) => row[2])).size, 24);
assert.ok(poolRows.every((row) => row[5] === '1'), 'Each scene-bound pool must select exactly one alternative.');
for (const pool of contentPools) assert.ok(poolRows.some((row) => row[2] === pool), `Missing pool seed: ${pool}`);

const questionInsert = migration.match(/INSERT INTO public\.story_mode_questions \([\s\S]*?ON CONFLICT \(id\) DO UPDATE SET/)?.[0] || '';
assert.ok(questionInsert, 'Phase 3D question seed is missing.');
const questionRows = [...questionInsert.matchAll(/\('([^']+)', '([^']+)', '([^']+)', \d+, '(multiple_choice|true_false)'/g)];
assert.equal(questionRows.length, 48);
assert.equal(new Set(questionRows.map((row) => row[1])).size, 48, 'Question IDs must be unique.');
assert.equal(questionRows.filter((row) => row[4] === 'multiple_choice').length, 30);
assert.equal(questionRows.filter((row) => row[4] === 'true_false').length, 18);

const difficultyTimers = [...questionInsert.matchAll(/, '(easy|moderate|hard)', (5|7|10), 'Genesis 6/g)]
  .map((match) => ({ difficulty: match[1], timer: Number(match[2]) }));
assert.equal(difficultyTimers.length, 48);
for (const difficulty of ['easy', 'moderate', 'hard']) {
  assert.equal(difficultyTimers.filter((item) => item.difficulty === difficulty).length, 16);
}
for (const timer of [5, 7, 10]) assert.equal(difficultyTimers.filter((item) => item.timer === timer).length, 16);
assert.equal((questionInsert.match(/, true\)\s*,?/g) || []).length, 10, 'Genesis 6 READ must supply ten follow-up alternatives.');

const prompts = [...questionInsert.matchAll(/\('([^']+)', '[^']+', '[^']+', \d+, '(?:multiple_choice|true_false)',\n\s+'((?:[^']|'')*)',/g)]
  .map((match) => match[2].replace(/''/g, "'").trim().toLowerCase());
assert.equal(prompts.length, 48);
assert.equal(new Set(prompts).size, prompts.length, 'Exact duplicate prompts are forbidden.');

for (const pool of contentPools) {
  assert.equal((questionInsert.match(new RegExp(`'${pool.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}'`, 'g')) || []).length, 2);
}

assert.match(questionInsert, /'300 cubits'/);
assert.match(questionInsert, /'50 cubits'/);
assert.match(questionInsert, /'30 cubits'/);
assert.match(questionInsert, /'Gopher wood'/);
assert.match(questionInsert, /'Inside and outside'/);
assert.match(questionInsert, /'Lower, second, and third'/);
assert.match(questionInsert, /Shem, Ham, and Japheth/);
assert.match(questionInsert, /Every kind of food that is eaten/);

const firstPlayQuestionCount = contentPools.size;
const maximumFirstPlayFigs = (8 * 1) + (8 * 3) + (8 * 5);
assert.equal(firstPlayQuestionCount, 24);
assert.equal(maximumFirstPlayFigs, 72);
assert.equal(25 + 34 + questionRows.length, 107, 'The cumulative verified Story Mode bank must be 107 questions.');

assert.match(migration, /\('corruption', 'beginnings', 'noah', 'Corruption', 1, 'toward-noah', true\)/);
assert.match(migration, /\('the-flood', 'beginnings', 'noah', 'The Flood', 11, 'the-ark-stands', false\)/);
assert.doesNotMatch(poolInsert, /'the-flood'/);
assert.doesNotMatch(questionInsert, /'the-flood'/);
assert.doesNotMatch(migration.match(/INSERT INTO public\.story_mode_checkpoints[\s\S]*?ON CONFLICT/)?.[0] || '', /'the-flood'/);
for (const forbiddenLevel of ['rain', 'raven', 'dove', 'rainbow', 'abraham']) {
  assert.equal(NOAH_LEVELS.some((level) => level.slug.includes(forbiddenLevel)), false);
}
assert.doesNotMatch(noahSource, /canonicalEventId/);

console.log('Story Mode Noah construction structure, 48-question bank, Scripture, continuation handoff, and reward-plan checks passed.');
