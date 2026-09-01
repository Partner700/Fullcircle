import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { STORY_ACTIONS } from '../src/screens/cadet/story-mode/actions.ts';
import { GENERATIONS_LEVELS } from '../src/screens/cadet/story-mode/generationsContent.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relativePath: string) => fs.readFileSync(path.join(root, relativePath), 'utf8');
const migration = read('supabase/migrations/20260831200000_story_mode_generations_enoch_arc.sql');
const world = read('src/screens/cadet/story-mode/StoryWorld.tsx');
const css = read('src/index.css');
const engine = read('src/screens/cadet/story-mode/engine.ts');

for (const action of ['slow_walk', 'brisk_walk', 'ascend', 'observe', 'age_transition', 'lineage_transition', 'appear', 'disappear'] as const) {
  assert.ok(STORY_ACTIONS[action].durationMs > 0);
  assert.match(css, new RegExp(`story-action-${action.replace(/_/g, '-')}`));
}

assert.match(world, /scene\.environment\.timePassage/);
assert.match(world, /scene\.environment\.elevation/);
assert.match(world, /scene\.locomotion/);
assert.match(world, /placement\.id === scene\.activeCharacterId/);
assert.match(world, /story-lineage-indicator/);
assert.match(world, /story-title-reveal/);
assert.match(css, /story-passage-seasons/);
assert.match(css, /story-passage-generations/);
assert.match(css, /story-time-sweep/);
assert.match(css, /prefers-reduced-motion: reduce/);
assert.match(css, /story-time-sweep \{ opacity: 0\.34; transform: none; \}/);

assert.equal(engine.includes('TIME_TRANSITION'), false, 'Data-driven effects should not add a redundant state.');
for (const phase of ['walking', 'reading', 'canonical_transition', 'character_transition', 'chapter_complete']) {
  assert.match(engine, new RegExp(`'${phase}'`));
}

const transitions = GENERATIONS_LEVELS.flatMap((level) => level.scenes)
  .filter((scene) => scene.lineage?.length || scene.transitionLabel || scene.titleReveal);
assert.ok(transitions.length >= 10);
assert.ok(transitions.some((scene) => scene.lineage?.join(':') === 'seth:enosh'));
assert.ok(transitions.some((scene) => scene.lineage?.includes('enoch') && scene.titleReveal === 'ENOCH'));
assert.ok(transitions.some((scene) => scene.lineage?.join(':') === 'enoch:methuselah:lamech'));
assert.ok(transitions.some((scene) => scene.lineage?.includes('noah') && scene.titleReveal === 'NOAH'));
assert.equal(GENERATIONS_LEVELS[7].scenes.find((scene) => scene.id === 'toward-noah-walk')?.activeCharacterId, 'lamech');

for (const [level, prerequisite] of [
  ['seth', 'another-offspring'],
  ['the-line-continues', 'seth'],
  ['enoch-walks', 'the-line-continues'],
  ['walked-with-god', 'enoch-walks'],
  ['taken', 'walked-with-god'],
  ['methuselah', 'taken'],
  ['long-years', 'methuselah'],
  ['toward-noah', 'long-years'],
] as const) {
  assert.match(migration, new RegExp(`\\('${level}', 'beginnings', 'generations', [^\n]+, \\d+, '${prerequisite}', true\\)`));
}
assert.match(migration, /current_chapter_slug = 'generations'[\s\S]*current_level_slug = 'seth'/);
assert.match(migration, /next_level\.unlock_after_level_slug = v_attempt\.level_slug/);

const home = read('src/screens/cadet/story-mode/StoryModeHome.tsx');
assert.match(home, /book\.chapters\.map/);
assert.match(home, /replay available/);
assert.match(home, /Next chronological character/);
assert.match(home, />Noah</);
assert.match(home, /locked/);

console.log('Story Mode lineage transitions, time passage, navigation, and Noah-lock checks passed.');
