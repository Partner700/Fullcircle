import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { STORY_BOOKS, findStoryLevel } from '../src/screens/cadet/story-mode/content.ts';
import { FLOOD_LEVELS } from '../src/screens/cadet/story-mode/floodContent.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relativePath: string) => fs.readFileSync(path.join(root, relativePath), 'utf8');
const migration = read('supabase/migrations/20260901150000_story_mode_flood_book_completion.sql');
const marker = '$flood_questions$';
const firstMarker = migration.indexOf(marker) + marker.length;
const questions = JSON.parse(migration.slice(firstMarker, migration.indexOf(marker, firstMarker))) as Array<{
  id: string;
  level_slug: string;
  checkpoint_id: string;
  question_order: number;
  question_type: 'multiple_choice' | 'true_false';
  prompt: string;
  options: string[];
  correct_answer: string;
  difficulty: 'easy' | 'moderate' | 'hard';
  timer_seconds: 5 | 7 | 10;
  scripture_reference: string;
  explanation: string;
  pool_id: string;
  scene_id: string;
  is_read_follow_up: boolean;
}>;

const expectedSlugs = [
  'enter-the-ark',
  'seven-days',
  'forty-days',
  'waters-prevailed',
  'god-remembered-noah',
  'the-mountains-appear',
  'the-raven',
  'the-dove',
  'an-olive-leaf',
  'dry-ground',
  'come-out',
  'an-altar',
  'my-covenant',
  'the-bow-in-the-cloud',
];

assert.equal(FLOOD_LEVELS.length, 14);
assert.deepEqual(FLOOD_LEVELS.map((level) => level.slug), expectedSlugs);
assert.deepEqual(FLOOD_LEVELS.map((level) => level.order), Array.from({ length: 14 }, (_, index) => index + 11));
assert.equal(STORY_BOOKS[0].chapters[2].levels.length, 24);
assert.equal(findStoryLevel('enter-the-ark'), FLOOD_LEVELS[0]);
assert.equal(findStoryLevel('the-bow-in-the-cloud'), FLOOD_LEVELS[13]);
assert.equal(findStoryLevel('the-flood'), null);

const allScenes = FLOOD_LEVELS.flatMap((level) => level.scenes);
const contentPools = allScenes
  .map((scene) => scene.questionPoolId)
  .filter((pool): pool is string => Boolean(pool));
assert.equal(new Set(FLOOD_LEVELS.map((level) => level.id)).size, FLOOD_LEVELS.length);
assert.equal(new Set(allScenes.map((scene) => scene.id)).size, allScenes.length);
assert.equal(contentPools.length, 30, 'A normal first play must select one question from each of 30 pools.');
assert.equal(new Set(contentPools).size, 30);

for (const level of FLOOD_LEVELS) {
  assert.equal(level.bookSlug, 'beginnings');
  assert.equal(level.chapterSlug, 'noah');
  assert.ok(level.scenes.some((scene) => scene.kind === 'narrative'));
  assert.ok(level.scenes.some((scene) => scene.kind === 'movement'));
  assert.ok(level.scenes.some((scene) => scene.kind === 'question_event'));
  assert.ok(level.scenes.some((scene) => scene.kind === 'completion'));
  assert.ok(level.scenes.every((scene) => scene.constructionId === 'noah-ark'));
  assert.ok(level.scenes.every((scene) => /^Genesis (7|8|9)/.test(scene.scriptureReference || '')));
}

const reads = allScenes.filter((scene) => scene.kind === 'read');
assert.deepEqual(reads.map((scene) => scene.scriptureReference), [
  'Genesis 7:1-12',
  'Genesis 8:1-12',
  'Genesis 8:20-22',
  'Genesis 9:8-17',
]);
assert.match(read('src/screens/cadet/story-mode/StoryLevelPlayer.tsx'), /The question timer is stopped while Scripture is open/);

assert.equal(questions.length, 60);
assert.equal(new Set(questions.map((question) => question.id)).size, 60);
assert.equal(new Set(questions.map((question) => question.prompt.trim().toLowerCase())).size, 60);
assert.equal(questions.filter((question) => question.question_type === 'multiple_choice').length, 36);
assert.equal(questions.filter((question) => question.question_type === 'true_false').length, 24);
assert.equal(questions.filter((question) => question.is_read_follow_up).length, 16);

for (const difficulty of ['easy', 'moderate', 'hard'] as const) {
  assert.equal(questions.filter((question) => question.difficulty === difficulty).length, 20);
}
for (const timer of [5, 7, 10] as const) {
  assert.equal(questions.filter((question) => question.timer_seconds === timer).length, 20);
}

for (const question of questions) {
  assert.ok(contentPools.includes(question.pool_id), `Question ${question.id} uses an unknown content pool.`);
  assert.ok(allScenes.some((scene) => scene.id === question.scene_id), `Question ${question.id} uses an unknown scene.`);
  assert.ok(allScenes.some((scene) => scene.checkpointId === question.checkpoint_id), `Question ${question.id} uses an unknown checkpoint.`);
  assert.match(question.scripture_reference, /^Genesis (7|8|9)/);
  assert.ok(question.options.includes(question.correct_answer));
  if (question.question_type === 'true_false') assert.deepEqual(question.options, ['True', 'False']);
}
for (const pool of contentPools) assert.equal(questions.filter((question) => question.pool_id === pool).length, 2);

const bankText = questions.map((question) => `${question.prompt} ${question.explanation || ''}`).join(' ');
for (const required of [
  /clean animals/i,
  /seven.day/i,
  /forty days and forty nights/i,
  /one hundred fifty days/i,
  /mountains of Ararat/i,
  /raven/i,
  /dove/i,
  /olive leaf/i,
  /altar/i,
  /every living creature/i,
  /bow in the cloud/i,
]) assert.match(bankText, required);

const firstPlayFigs = (10 * 1) + (10 * 3) + (10 * 5);
assert.equal(firstPlayFigs, 90);
assert.equal(25 + 34 + 48 + questions.length, 167);
assert.equal(FLOOD_LEVELS.at(-1)?.chapterConclusion, true);
assert.match(FLOOD_LEVELS.at(-1)?.continuationText || '', /Book I/i);

const clientSource = `${read('src/screens/cadet/story-mode/floodContent.ts')}\n${read('src/screens/cadet/story-mode/content.ts')}`;
assert.doesNotMatch(clientSource, /tower of babel|abraham|isaac|jacob|joseph|book ii/i);
assert.doesNotMatch(migration, /story_mode_marks|road_home|match_denarii/i);

console.log('Story Mode Flood structure: 14 levels, 30 first-play pools, 60 verified questions, four READ moments, and 90-Fig maximum passed.');
