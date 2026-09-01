const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');
const migration = read('supabase/migrations/20260901150000_story_mode_flood_book_completion.sql');
const api = read('src/screens/cadet/story-mode/api.ts');

const protectedTables = [
  'story_mode_environment_sequences',
  'story_mode_environment_stages',
  'story_mode_level_environment_context',
  'story_mode_user_environment_progress',
  'story_mode_attempt_environment_progress',
  'story_mode_book_completions',
];

for (const table of protectedTables) {
  assert.match(migration, new RegExp(`ALTER TABLE public\\.${table} ENABLE ROW LEVEL SECURITY`));
  assert.match(migration, new RegExp(`public\\.${table}`));
}
assert.match(migration, /REVOKE ALL ON TABLE[\s\S]*FROM PUBLIC, anon, authenticated/);

assert.match(migration, /public\.story_mode_require_player\(\)/);
assert.match(migration, /attempt\.user_id = v_user_id/);
assert.match(migration, /This Story Mode environment is not available for your account/);
assert.match(migration, /SECURITY DEFINER/g);
assert.match(migration, /SET search_path = public/g);
assert.match(migration, /REVOKE ALL ON FUNCTION public\.story_mode_environment_state_payload\(uuid\) FROM PUBLIC, anon, authenticated/);
assert.match(migration, /REVOKE ALL ON FUNCTION public\.story_mode_advance_environment_stage\(\) FROM PUBLIC, anon, authenticated/);
assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.get_my_story_mode_environment_state\(uuid\) TO authenticated, service_role/);
assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.get_my_story_mode_book_completion\(text\) TO authenticated, service_role/);

assert.match(migration, /OLD\.answered_correct IS FALSE AND NEW\.answered_correct IS TRUE/);
assert.match(migration, /v_stage\.stage_order <> v_progress\.stage_order \+ 1/);
assert.match(migration, /stage_order = v_progress\.stage_order/);
assert.match(migration, /IF NOT v_attempt\.is_replay THEN/);
assert.match(migration, /ON CONFLICT \(user_id, book_slug\) DO NOTHING/);
assert.match(migration, /mandatory Story Mode environment milestone/);
assert.match(migration, /Book I cannot complete before the covenant and rainbow sequence/);

assert.doesNotMatch(api, /\.from\(['"]story_mode_(environment|book)/);
assert.doesNotMatch(api, /water_stage\s*:/);
assert.doesNotMatch(api, /rainbow_visible\s*:/);
assert.doesNotMatch(api, /olive_leaf_visible\s*:/);
assert.doesNotMatch(api, /book_complete\s*:/);
assert.match(api, /supabase\.rpc\('get_my_story_mode_environment_state'/);
assert.match(api, /supabase\.rpc\('get_my_story_mode_book_completion'/);

assert.doesNotMatch(migration, /INSERT INTO public\.(?:profiles|wallet|denarii|marks|relic_inventory)/i);
assert.doesNotMatch(migration, /road_home|match_denarii|story_mode_marks/i);
assert.match(migration, /denarii_earned integer NOT NULL DEFAULT 0/);

console.log('Story Mode Flood security: RLS, revokes, owner checks, server-only stage advancement, replay isolation, completion gates, and no economy contamination passed.');
