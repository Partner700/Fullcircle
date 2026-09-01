import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { STORY_BOOKS } from '../src/screens/cadet/story-mode/content.ts';
import {
  ENOCH_TAKEN_EVENT_ID,
  GENERATIONS_LEVELS,
  NOAH_REVEAL_EVENT_ID,
} from '../src/screens/cadet/story-mode/generationsContent.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relativePath: string) => fs.readFileSync(path.join(root, relativePath), 'utf8');
const migration = read('supabase/migrations/20260831200000_story_mode_generations_enoch_arc.sql');

assert.equal(GENERATIONS_LEVELS.length, 8);
assert.deepEqual(GENERATIONS_LEVELS.map((level) => level.slug), [
  'seth',
  'the-line-continues',
  'enoch-walks',
  'walked-with-god',
  'taken',
  'methuselah',
  'long-years',
  'toward-noah',
]);
assert.deepEqual(GENERATIONS_LEVELS.map((level) => level.order), [1, 2, 3, 4, 5, 6, 7, 8]);
assert.equal(STORY_BOOKS[0].chapters[1].title, 'Generations');
assert.equal(STORY_BOOKS[0].chapters[1].levels, GENERATIONS_LEVELS);

const questionInsert = migration.match(/INSERT INTO public\.story_mode_questions \([\s\S]*?ON CONFLICT \(id\) DO UPDATE SET/)?.[0] || '';
assert.ok(questionInsert, 'Phase 3C question seed is missing.');
const questionRows = [...questionInsert.matchAll(/\('([^']+)', '([^']+)', '([^']+)', \d+, '(multiple_choice|true_false)'/g)];
assert.equal(questionRows.length, 34, 'Phase 3C must add exactly 34 questions.');
assert.equal(new Set(questionRows.map((row) => row[1])).size, 34, 'Question IDs must be unique.');
assert.equal(questionRows.filter((row) => row[4] === 'multiple_choice').length, 21);
assert.equal(questionRows.filter((row) => row[4] === 'true_false').length, 13);

const difficultyTimers = [...questionInsert.matchAll(/, '(easy|moderate|hard)', (5|7|10), 'Genesis [45]/g)]
  .map((match) => ({ difficulty: match[1], timer: Number(match[2]) }));
assert.equal(difficultyTimers.length, 34);
assert.equal(difficultyTimers.filter((item) => item.difficulty === 'easy').length, 12);
assert.equal(difficultyTimers.filter((item) => item.difficulty === 'moderate').length, 12);
assert.equal(difficultyTimers.filter((item) => item.difficulty === 'hard').length, 10);
assert.equal(difficultyTimers.filter((item) => item.timer === 5).length, 12);
assert.equal(difficultyTimers.filter((item) => item.timer === 7).length, 12);
assert.equal(difficultyTimers.filter((item) => item.timer === 10).length, 10);
assert.equal((questionInsert.match(/, true\)\s*,?/g) || []).length, 6, 'Enoch READ must have six follow-up alternatives.');

const prompts = [...questionInsert.matchAll(/\('([^']+)', '[^']+', '[^']+', \d+, '(?:multiple_choice|true_false)',\n\s+'((?:[^']|'')*)',/g)]
  .map((match) => match[2].replace(/''/g, "'").trim().toLowerCase());
assert.equal(prompts.length, 34);
assert.equal(new Set(prompts).size, prompts.length, 'Exact duplicate prompts are forbidden.');

const contentPools = new Set(GENERATIONS_LEVELS.flatMap((level) => level.scenes
  .map((scene) => scene.questionPoolId)
  .filter((pool): pool is string => Boolean(pool))));
assert.equal(contentPools.size, 17);
for (const pool of contentPools) {
  assert.match(migration, new RegExp(`'${pool.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}'`));
  assert.equal(questionInsert.split(`'${pool}'`).length - 1, 2, `${pool} needs two alternatives.`);
}
assert.equal((migration.match(/questions_per_attempt/g) || []).length > 0, true);
assert.match(migration, /questions_per_attempt\s*\)\s*VALUES[\s\S]*, 1\)/);

const firstPlayQuestionCount = contentPools.size;
const maximumFirstPlayFigs = (6 * 1) + (6 * 3) + (5 * 5);
assert.equal(firstPlayQuestionCount, 17);
assert.equal(maximumFirstPlayFigs, 49);

const readScene = GENERATIONS_LEVELS[3].scenes.find((scene) => scene.kind === 'read');
assert.equal(readScene?.scriptureReference, 'Genesis 5:21-24');
assert.match(readScene?.readText || '', /walked with God/i);
assert.match(readScene?.readText || '', /God took him/i);

const taking = GENERATIONS_LEVELS[4].scenes.find((scene) => scene.canonicalEventId === ENOCH_TAKEN_EVENT_ID);
assert.equal(taking?.kind, 'canonical_event');
assert.deepEqual(taking?.canonicalActions, ['slow_walk', 'ascend', 'disappear']);
assert.equal(taking?.scriptureReference, 'Genesis 5:24');

const noahReveal = GENERATIONS_LEVELS[7].scenes.find((scene) => scene.canonicalEventId === NOAH_REVEAL_EVENT_ID);
assert.equal(noahReveal?.kind, 'character_transition');
assert.equal(noahReveal?.characters.find((character) => character.id === 'noah')?.role, 'future');
assert.equal(GENERATIONS_LEVELS[7].chapterConclusion, true);
assert.equal(GENERATIONS_LEVELS[7].nextCharacterName, 'Noah');

const allScenes = GENERATIONS_LEVELS.flatMap((level) => level.scenes);
assert.ok(allScenes.some((scene) => scene.locomotion === 'slow_walk'));
assert.ok(allScenes.some((scene) => scene.environment.timePassage === 'generations'));
assert.ok(allScenes.some((scene) => scene.environment.timePassage === 'seasons'));
assert.deepEqual([...new Set(allScenes.map((scene) => scene.environment.elevation).filter(Boolean))].sort(), [1, 2, 3, 5]);
for (const scene of allScenes.filter((item) => item.kind === 'question_event')) {
  assert.match(scene.scriptureReference || '', /^Genesis [45]:/);
}

assert.doesNotMatch(migration, /\('noah', 'beginnings'/, 'Noah must not have a playable server level.');
for (const unsupported of ['ark construction', 'flood gameplay', 'enoch vision', 'enoch battle', 'methuselah quest']) {
  assert.doesNotMatch(`${migration}\n${read('src/screens/cadet/story-mode/generationsContent.ts')}`, new RegExp(unsupported, 'i'));
}

console.log('Story Mode Generations structure, 34-question bank, Scripture, and reward-plan checks passed.');
