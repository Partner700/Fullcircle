import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relativePath: string) => fs.readFileSync(path.join(root, relativePath), 'utf8');
const migration = read('supabase/migrations/20260901100000_story_mode_noah_ark_construction.sql');
const api = read('src/screens/cadet/story-mode/api.ts');
const player = read('src/screens/cadet/story-mode/StoryLevelPlayer.tsx');

for (const table of [
  'story_mode_world_builds',
  'story_mode_world_build_stages',
  'story_mode_level_build_context',
  'story_mode_user_build_progress',
  'story_mode_attempt_build_progress',
]) {
  assert.match(migration, new RegExp(`CREATE TABLE IF NOT EXISTS public\\.${table}`));
  assert.match(migration, new RegExp(`ALTER TABLE public\\.${table} ENABLE ROW LEVEL SECURITY`));
}
assert.match(migration, /PRIMARY KEY \(user_id, build_id\)/);
assert.match(migration, /attempt_id uuid PRIMARY KEY REFERENCES public\.story_mode_attempts\(id\) ON DELETE CASCADE/);
assert.match(migration, /REVOKE ALL ON TABLE[\s\S]*story_mode_attempt_build_progress[\s\S]*FROM PUBLIC, anon, authenticated/);

const payload = migration.match(/CREATE OR REPLACE FUNCTION public\.story_mode_build_state_payload[\s\S]*?\n\$\$;/)?.[0] || '';
assert.match(payload, /'stage_order', progress\.stage_order/);
assert.match(payload, /'stage_slug', progress\.stage_slug/);
assert.match(payload, /'completed_components'/);
assert.match(payload, /stage\.stage_order <= progress\.stage_order/);
assert.match(payload, /'checkpoint_id', attempt\.checkpoint_id/);
assert.doesNotMatch(payload, /animation|frame|transform|elapsed/i);

const start = migration.match(/CREATE OR REPLACE FUNCTION public\.start_story_mode_level[\s\S]*?\n\$\$;/)?.[0] || '';
assert.match(start, /attempt\.status = 'in_progress'/);
assert.match(start, /v_restored := true/);
assert.match(start, /SELECT \* INTO v_user_build[\s\S]*FOR UPDATE/);
assert.match(start, /INSERT INTO public\.story_mode_attempt_build_progress/);
assert.match(start, /ON CONFLICT \(attempt_id\) DO NOTHING/);
assert.match(start, /'build_state', public\.story_mode_build_state_payload\(v_attempt\.id\)/);
assert.match(start, /IF v_attempt\.is_replay THEN[\s\S]*v_initial_build_stage := v_build_context\.starting_stage_order/);
assert.match(start, /ELSE[\s\S]*story_mode_user_build_progress/);

const submit = migration.match(/CREATE OR REPLACE FUNCTION public\.submit_story_mode_answer\([\s\S]*?\n\$\$;/)?.[0] || '';
assert.match(submit, /UPDATE public\.story_mode_attempt_build_progress/);
assert.match(submit, /IF NOT v_attempt\.is_replay THEN[\s\S]*UPDATE public\.story_mode_user_build_progress/);
assert.match(submit, /'build_state', public\.story_mode_build_state_payload\(v_attempt\.id\)/);
assert.match(submit, /WHEN v_correct AND v_next_question\.id IS NOT NULL THEN v_next_question\.checkpoint_id/);
assert.match(submit, /ELSE checkpoint_id/);

assert.match(api, /function parseBuildState/);
assert.match(api, /buildState: parseBuildState\(row\.build_state\)/);
assert.match(player, /useState<StoryBuildState \| null>\(attempt\.buildState\)/);
assert.match(player, /setBuildState\(attempt\.buildState\)/);
assert.match(player, /if \(result\.buildState\) setBuildState\(result\.buildState\)/);

for (const checkpoint of [
  'ark-command-start',
  'ark-read-question',
  'wood-covering-question',
  'dimensions-height-question',
  'structure-decks-question',
  'covenant-household-question',
  'animals-life-question',
  'provisions-storage-question',
  'ark-stands-readiness-question',
  'ark-stands-complete',
]) assert.ok(migration.includes(`'${checkpoint}'`), `Missing stable restoration checkpoint: ${checkpoint}`);

console.log('Story Mode Ark refresh, checkpoint, cross-session, completion, and replay persistence checks passed.');
