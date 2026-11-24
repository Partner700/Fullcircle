const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const migration = read('supabase/migrations/20261019120000_arena_journey_machine.sql');
const server = read('supabase/functions/biblical-journey/index.ts');
const client = read('src/screens/cadet/JourneyGamePlay.tsx');

for (const name of ['initialize_machine_arena_journey_game', 'commit_machine_arena_journey_command']) {
  assert.match(migration, new RegExp(`CREATE OR REPLACE FUNCTION public\\.${name}\\(`));
  assert.match(migration, new RegExp(`REVOKE ALL ON FUNCTION public\\.${name}\\(`));
  assert.match(migration, new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${name}\\([^;]+TO service_role;`, 's'));
}
assert.equal((migration.match(/IF auth\.role\(\) <> 'service_role'/g) || []).length, 2);
assert.match(migration, /p_actor_id IS DISTINCT FROM v_human_id/);
assert.match(migration, /IF v_winner_id IS NOT NULL AND v_reward > 0 THEN/);
assert.match(migration, /UPDATE public\.arena_rooms SET machine_score = v_machine_score/);
assert.match(migration, /v_room\.room_name ILIKE '%\[arena:journey\]%' THEN coalesce\(v_room\.machine_score, 0\)/);
assert.match(server, /if \(action === 'BOT'\)/);
assert.match(server, /context\.room\.play_mode !== 'machine' \|\| !machineJourneyMayAct\(previous\)/);
assert.match(server, /const actorId = await authenticatedUserId\(request\)/);
assert.match(client, /machineJourneyMayAct\(state\)/);
assert.match(client, /commandRef\.current\?\.signature !== signature/);

console.log('Machine Journey permissions, settlement, scores, and idempotent client commands passed.');
