import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ARK_CONSTRUCTION, NOAH_LEVELS } from '../src/screens/cadet/story-mode/noahContent.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relativePath: string) => fs.readFileSync(path.join(root, relativePath), 'utf8');
const migration = read('supabase/migrations/20260901100000_story_mode_noah_ark_construction.sql');
const construction = read('src/screens/cadet/story-mode/StoryConstruction.tsx');
const world = read('src/screens/cadet/story-mode/StoryWorld.tsx');
const styles = read('src/index.css');

assert.equal(ARK_CONSTRUCTION.id, 'noah-ark');
assert.equal(ARK_CONSTRUCTION.stages.length, 9);
assert.deepEqual(ARK_CONSTRUCTION.stages.map((stage) => stage.order), [1, 2, 3, 4, 5, 6, 7, 8, 9]);
assert.deepEqual(ARK_CONSTRUCTION.stages.map((stage) => stage.componentKey), [
  'foundation', 'frame', 'hull', 'opening', 'decks', 'household', 'animals', 'provisions', 'complete',
]);

const stageSeed = migration.match(/INSERT INTO public\.story_mode_world_build_stages \([\s\S]*?ON CONFLICT \(build_id, stage_order\) DO UPDATE SET/)?.[0] || '';
const stageRows = [...stageSeed.matchAll(/\('noah-ark', (\d+), '([^']+)', '([^']+)', '([^']+)',\n\s+'([^']+)', '([^']+)', '([^']+)'\)/g)];
assert.equal(stageRows.length, 9);
assert.deepEqual(stageRows.map((row) => Number(row[1])), [1, 2, 3, 4, 5, 6, 7, 8, 9]);
assert.deepEqual(stageRows.map((row) => row[3]), ARK_CONSTRUCTION.stages.map((stage) => stage.componentKey));
assert.equal(new Set(stageRows.map((row) => `${row[5]}:${row[6]}`)).size, 9);

const contexts = migration.match(/INSERT INTO public\.story_mode_level_build_context \([\s\S]*?ON CONFLICT \(level_slug\) DO UPDATE SET/)?.[0] || '';
assert.match(contexts, /\('make-yourself-an-ark', 'noah-ark', 0, 1\)/);
assert.match(contexts, /\('rooms-door-and-decks', 'noah-ark', 3, 5\)/);
assert.match(contexts, /\('the-ark-stands', 'noah-ark', 8, 9\)/);

const constructionScenes = NOAH_LEVELS.flatMap((level) => level.scenes).filter((scene) => scene.constructionId);
assert.ok(constructionScenes.length > 30);
assert.ok(constructionScenes.every((scene) => scene.constructionId === ARK_CONSTRUCTION.id));
assert.ok(constructionScenes.some((scene) => scene.camera?.framing === 'wide'));
assert.ok(constructionScenes.some((scene) => scene.camera?.framing === 'reveal'));
assert.ok(NOAH_LEVELS.flatMap((level) => level.scenes).some((scene) => scene.buildFailureEffect === 'lean'));
assert.ok(NOAH_LEVELS.flatMap((level) => level.scenes).some((scene) => scene.buildFailureEffect === 'collapse'));
assert.ok(NOAH_LEVELS.flatMap((level) => level.scenes).some((scene) => scene.buildFailureEffect === 'reject'));
assert.ok(NOAH_LEVELS.flatMap((level) => level.scenes).some((scene) => scene.buildFailureEffect === 'misplace'));
assert.ok(NOAH_LEVELS.flatMap((level) => level.scenes).some((scene) => scene.buildFailureEffect === 'block'));
assert.ok(NOAH_LEVELS.flatMap((level) => level.scenes).some((scene) => scene.buildFailureEffect === 'spill'));

assert.match(construction, /stage\.order <= state\.stageOrder/);
assert.match(construction, /data-build-component/);
assert.match(construction, /role="status" aria-live="polite"/);
assert.doesNotMatch(construction, /hasArk(?:Wall|Door|Deck|Hull)/);
assert.match(world, /findStoryBuild\(scene\.constructionId\)/);
assert.match(world, /failureEffect=\{wrong \? scene\.buildFailureEffect/);
assert.match(styles, /\.story-build-piece-foundation/);
assert.match(styles, /\.story-build-piece-frame/);
assert.match(styles, /\.story-build-piece-hull/);
assert.match(styles, /\.story-build-piece-opening/);
assert.match(styles, /\.story-build-piece-decks/);
assert.match(styles, /\.story-build-piece-provisions/);
assert.match(styles, /@media \(prefers-reduced-motion: reduce\)/);
assert.match(styles, /\.story-build-piece \{ opacity: 1; transform: none; \}/);

const submit = migration.match(/CREATE OR REPLACE FUNCTION public\.submit_story_mode_answer\([\s\S]*?\n\$\$;/)?.[0] || '';
assert.ok(submit);
assert.match(submit, /v_correct := NOT v_timed_out[\s\S]*v_question\.correct_answer/);
assert.match(submit, /IF v_correct THEN[\s\S]*v_build_stage\.stage_order <> v_attempt_build\.stage_order \+ 1/);
assert.match(submit, /Story Mode construction stages cannot be skipped or duplicated/);
assert.match(submit, /WHERE attempt_id = v_attempt\.id[\s\S]*AND stage_order = v_attempt_build\.stage_order/);
assert.match(submit, /IF NOT v_attempt\.is_replay THEN[\s\S]*UPDATE public\.story_mode_user_build_progress/);
assert.match(submit, /Every mandatory construction milestone must be settled before level completion/);
assert.match(submit, /progress\.stage_order = v_attempt_build\.stage_order/);
assert.doesNotMatch(submit.slice(0, submit.indexOf('DECLARE')), /p_(?:build|ark|stage|complete|correct|figs)/i);

const answerEventInsert = submit.indexOf('INSERT INTO public.story_mode_answer_events');
const stageUpdate = submit.indexOf('UPDATE public.story_mode_attempt_build_progress');
assert.ok(stageUpdate > 0 && answerEventInsert > stageUpdate, 'Build and reward settlement must share the answer transaction.');
assert.ok((submit.match(/event\.submission_id = p_submission_id/g) || []).length >= 2);
assert.match(submit, /IF FOUND THEN RETURN v_existing_response; END IF/);

console.log('Story Mode Ark construction stages, visual state, failure handling, ordering, and idempotency checks passed.');
