import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ENOCH_TAKEN_EVENT_ID, GENERATIONS_LEVELS } from '../src/screens/cadet/story-mode/generationsContent.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relativePath: string) => fs.readFileSync(path.join(root, relativePath), 'utf8');
const migration = read('supabase/migrations/20260831200000_story_mode_generations_enoch_arc.sql');
const foundationMigration = read('supabase/migrations/20260831110000_story_mode_abel_vertical_slice.sql');
const api = read('src/screens/cadet/story-mode/api.ts');
const player = read('src/screens/cadet/story-mode/StoryLevelPlayer.tsx');
const engine = read('src/screens/cadet/story-mode/engine.ts');

const eventScene = GENERATIONS_LEVELS[4].scenes.find((scene) => scene.canonicalEventId === ENOCH_TAKEN_EVENT_ID);
assert.equal(eventScene?.kind, 'canonical_event');
assert.equal(eventScene?.activeCharacterId, 'enoch');
assert.match(eventScene?.narrativeText || '', /walked with God.*God took him/i);
assert.ok(!eventScene?.characters.some((character) => character.id !== 'enoch'));

assert.match(migration, /'enoch-canonical-taking'.*'taken'.*'enoch-taking-event'.*'taken-complete'.*'canonical_transition'/s);
assert.match(migration, /'methuselah'.*'taken', true/);
assert.match(migration, /CREATE OR REPLACE FUNCTION public\.reach_story_mode_canonical_event/);
assert.match(migration, /Complete the server-selected questions before the canonical transition/);
assert.match(migration, /v_current_order \+ 1 <> v_event_order/);
assert.match(migration, /v_attempt\.checkpoint_id IS DISTINCT FROM v_event\.checkpoint_id/);

const reachFunction = migration.match(/CREATE OR REPLACE FUNCTION public\.reach_story_mode_canonical_event[\s\S]*?\$\$;/)?.[0] || '';
const settleFunction = migration.match(/CREATE OR REPLACE FUNCTION public\.settle_story_mode_canonical_event[\s\S]*?\$\$;/)?.[0] || '';
assert.ok(reachFunction);
assert.ok(settleFunction);
assert.doesNotMatch(reachFunction, /p_(?:complete|success|taken|figs|denarii|marks)/i);
assert.doesNotMatch(settleFunction, /p_(?:outcome|survived|success|level_complete|chapter_complete|figs|denarii|marks)/i);
assert.doesNotMatch(settleFunction, /selected_answer|correct_answer/);
assert.doesNotMatch(settleFunction, /v_attempt\.level_slug <> 'another-offspring'/, 'No level-specific settlement bypass may remain.');
assert.match(settleFunction, /status = 'completed',[\s\S]*checkpoint_id = v_event\.completion_checkpoint_id/);
assert.match(settleFunction, /settlement\.submission_id = p_submission_id/);
assert.match(settleFunction, /UNIQUE|INSERT INTO public\.story_mode_event_settlements/);
assert.equal(
  settleFunction.indexOf("checkpoint_id = v_event.completion_checkpoint_id") < settleFunction.indexOf('INSERT INTO public.story_mode_event_settlements'),
  true,
  'Canonical completion must persist before idempotent settlement is recorded.',
);

assert.match(api, /export async function reachStoryCanonicalEvent/);
assert.match(player, /reachStoryCanonicalEvent\(attempt\.attemptId, pendingEventId\)/);
assert.match(player, /settleStoryCanonicalEvent/);
assert.match(player, /canonicalScene\.canonicalActions/);
assert.match(engine, /CANONICAL_EVENT_SETTLED/);
assert.doesNotMatch(engine.match(/case 'CANONICAL_EVENT_SETTLED':[\s\S]*?case /)?.[0] || '', /phase: 'failure'/);

assert.match(foundationMigration, /PRIMARY KEY \(user_id, question_id\)/s);
assert.match(migration, /IF v_correct AND NOT v_attempt\.is_replay THEN/);
assert.match(migration, /ON CONFLICT \(user_id, question_id\) DO NOTHING/);
assert.match(migration, /'denarii_earned', 0/);
assert.doesNotMatch(migration, /story_mode_marks|INSERT INTO public\.[a-z_]*marks|award_[a-z_]*mark/);
assert.doesNotMatch(migration, /\('noah', 'beginnings'/);

console.log('Story Mode Enoch canonical authority, idempotency, recovery, and reward checks passed.');
