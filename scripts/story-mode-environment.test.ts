import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relativePath: string) => fs.readFileSync(path.join(root, relativePath), 'utf8');
const migration = read('supabase/migrations/20260901150000_story_mode_flood_book_completion.sql');
const effects = read('src/screens/cadet/story-mode/StoryEnvironmentEffects.tsx');
const world = read('src/screens/cadet/story-mode/StoryWorld.tsx');
const api = read('src/screens/cadet/story-mode/api.ts');
const css = read('src/index.css');

const stageBlock = migration.match(/INSERT INTO public\.story_mode_environment_stages \([\s\S]*?ON CONFLICT \(sequence_id, stage_order\) DO UPDATE SET/)?.[0] || '';
const stageRows = [...stageBlock.matchAll(/\('noah-flood-environment', (\d+), '([^']+)', '([^']+)', (\d+), (\d+), '([^']+)', '([^']+)', '([^']+)', '([^']+)', '([^']+)', '([^']+)', (true|false), (true|false), (true|false),/g)].map((match) => ({
  order: Number(match[1]),
  slug: match[2],
  weather: match[3],
  intensity: Number(match[4]),
  water: Number(match[5]),
  trend: match[6],
  terrain: match[7],
  traversal: match[8],
  ark: match[9],
  bird: match[10],
  birdState: match[11],
  olive: match[12] === 'true',
  altar: match[13] === 'true',
  rainbow: match[14] === 'true',
}));

assert.equal(stageRows.length, 17);
assert.deepEqual(stageRows.map((stage) => stage.order), Array.from({ length: 17 }, (_, index) => index + 1));
assert.deepEqual(stageRows.map((stage) => stage.slug), [
  'ark-sealed',
  'rain-begins',
  'forty-days',
  'ark-afloat',
  'high-water',
  'waters-receding',
  'ark-resting',
  'mountains-visible',
  'raven-released',
  'first-dove-returned',
  'olive-leaf-returned',
  'third-dove-no-return',
  'dry-ground',
  'ark-exited',
  'altar-offered',
  'covenant-established',
  'rainbow-revealed',
]);

assert.ok(stageRows.some((stage) => stage.trend === 'rising'));
assert.ok(stageRows.some((stage) => stage.trend === 'stable'));
assert.ok(stageRows.some((stage) => stage.trend === 'falling'));
assert.equal(Math.max(...stageRows.map((stage) => stage.water)), 7);
assert.equal(stageRows.find((stage) => stage.slug === 'high-water')?.water, 7);
assert.equal(stageRows.find((stage) => stage.slug === 'waters-receding')?.trend, 'falling');
assert.equal(stageRows.find((stage) => stage.slug === 'ark-afloat')?.traversal, 'ark_floating');
assert.equal(stageRows.find((stage) => stage.slug === 'ark-resting')?.ark, 'resting');
assert.equal(stageRows.find((stage) => stage.slug === 'dry-ground')?.terrain, 'muddy');
assert.equal(stageRows.find((stage) => stage.slug === 'ark-exited')?.traversal, 'dry_land');
assert.equal(stageRows.at(-1)?.rainbow, true);

for (const table of [
  'story_mode_environment_sequences',
  'story_mode_environment_stages',
  'story_mode_level_environment_context',
  'story_mode_user_environment_progress',
  'story_mode_attempt_environment_progress',
]) {
  assert.match(migration, new RegExp(`CREATE TABLE IF NOT EXISTS public\\.${table}`));
  assert.match(migration, new RegExp(`ALTER TABLE public\\.${table} ENABLE ROW LEVEL SECURITY`));
}

assert.match(migration, /AFTER INSERT ON public\.story_mode_attempts/);
assert.match(migration, /AFTER UPDATE OF answered_correct ON public\.story_mode_attempt_questions/);
assert.match(migration, /OLD\.answered_correct IS FALSE AND NEW\.answered_correct IS TRUE/);
assert.match(migration, /v_stage\.stage_order <> v_progress\.stage_order \+ 1/);
assert.match(migration, /environment stages cannot be skipped or duplicated/);
assert.match(migration, /IF NOT v_attempt\.is_replay THEN/);
assert.match(migration, /main Story Mode environment did not advance atomically/);
assert.match(migration, /mandatory Story Mode environment milestone/);
assert.match(migration, /BEFORE UPDATE OF status ON public\.story_mode_attempts/);

assert.match(api, /get_my_story_mode_environment_state/);
assert.match(api, /fetchStoryEnvironmentState\(attemptId\)/);
assert.match(api, /result\.environmentState = await fetchStoryEnvironmentState/);
assert.doesNotMatch(api, /waterLevel|maxWater|floodComplete|oliveLeafFound|dryGround/);
assert.match(world, /story-traversal-\$\{environmentState\.traversalMode\}/);
assert.match(world, /StoryEnvironmentEffects state=\{environmentState\}/);

assert.match(effects, /Array\.from\(\{ length: 12 \}/);
assert.match(effects, /aria-live="polite"/);
assert.doesNotMatch(effects, /Math\.random|canvas|getContext|requestAnimationFrame/);
for (let stage = 0; stage <= 7; stage += 1) assert.match(css, new RegExp(`story-water-stage-${stage}`));
assert.match(css, /prefers-reduced-motion: reduce/);
assert.match(css, /story-rain span \{ display: none/);
assert.match(css, /story-ark-floating/);
assert.match(css, /story-ark-resting/);

console.log('Story Mode environment authority: 17 monotonic stages, rise/stable/fall, refresh payloads, replay isolation, lightweight effects, and completion guards passed.');
