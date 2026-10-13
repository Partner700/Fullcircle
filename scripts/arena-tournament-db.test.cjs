const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const baseSql = fs.readFileSync(path.join(__dirname, '../supabase/migrations/20261013140827_instructor_arena_tournaments_and_rewards.sql'), 'utf8');
const sql = fs.readFileSync(path.join(__dirname, '../supabase/migrations/20261013170000_flexible_arena_tournament_stages.sql'), 'utf8');
const arrivals = fs.readFileSync(path.join(__dirname, '../src/components/DoveNotificationArrival.tsx'), 'utf8');

for (const table of ['arena_tournaments', 'arena_tournament_games']) {
  assert.match(baseSql, new RegExp(`ALTER TABLE public\\.${table} ENABLE ROW LEVEL SECURITY`));
}
assert.match(baseSql, /REVOKE ALL ON public\.arena_tournaments, public\.arena_tournament_games FROM PUBLIC, anon, authenticated/);
assert.match(baseSql, /CREATE UNIQUE INDEX arena_scheduled_award_once/);
assert.match(baseSql, /source_reference LIKE 'scheduled:%'/);
assert.doesNotMatch(baseSql, /has_group_stage/);
assert.match(sql, /ADD COLUMN IF NOT EXISTS has_group_stage boolean/);
assert.match(sql, /ADD COLUMN IF NOT EXISTS knockout_rounds integer/);
assert.match(sql, /CREATE OR REPLACE FUNCTION public\.create_instructor_arena_tournament\([\s\S]*?p_has_group_stage boolean/);
assert.match(sql, /auth\.uid\(\) IS NULL OR NOT EXISTS[\s\S]*?role = 'instructor'/);
assert.match(sql, /p_has_group_stage AND v_count NOT IN \(8, 16, 32\)/);
assert.match(sql, /NOT p_has_group_stage AND v_count NOT IN \(2, 4, 8, 16\)/);
assert.match(sql, /v_expected_games := v_group_count \* 6 \+ \(v_count \/ 2 - 1\)/);
assert.match(sql, /IF coalesce\(cardinality\(p_game_times\), 0\) <> v_expected_games THEN/);
assert.match(sql, /v_pair_left\[v_pair\]/);
assert.match(sql, /v_pair_right\[v_pair\]/);
const groupLeft = sql.match(/v_pair_left integer\[\] := ARRAY\[([\d, ]+)\]/)?.[1].split(',').map(Number);
const groupRight = sql.match(/v_pair_right integer\[\] := ARRAY\[([\d, ]+)\]/)?.[1].split(',').map(Number);
assert.deepEqual(groupLeft?.map((left, index) => `${left}-${groupRight?.[index]}`).sort(),
  ['1-2', '1-3', '1-4', '2-3', '2-4', '3-4']);
assert.match(sql, /standing\.wins DESC,[\s\S]*standing\.answers DESC/);
assert.match(sql, /IF v_game\.round_number = 0 THEN/);
assert.match(sql, /public\.create_arena_tournament_room\(v_next\.id\)/);
assert.match(sql, /p_game_times\[v_index\] < greatest\(v_left_time, v_right_time\) \+ interval '20 minutes'/);
assert.match(sql, /IF NEW\.status = 'playing' AND OLD\.status = 'waiting'[\s\S]*?1000, 'arena_reward'/);
assert.match(sql, /IF NEW\.status <> 'completed' OR OLD\.status <> 'playing' THEN RETURN NEW/);
assert.match(sql, /NEW\.winner_id = ANY\(v_schedule\.player_ids\)/);
assert.match(sql, /5000, 'arena_reward', 'scheduled:win:'/);
assert.match(sql, /25000, 'arena_reward', 'scheduled:champion:'/);
assert.match(sql, /v_game\.round_number = v_tournament\.knockout_rounds THEN/);
assert.match(sql, /SET status = 'completed', champion_id = NEW\.winner_id/);
assert.match(sql, /public\.create_arena_tournament_room\(v_next\.id\)/);
assert.match(sql, /'arena_scheduled_result'/);
assert.match(arrivals, /arenaWinnerAvatar/);
assert.match(arrivals, /arenaWinnerTent/);
assert.match(arrivals, /arenaWinnerAmount\.toLocaleString\(\)/);

console.log('Scheduled Arena reward, bracket, and winner announcement checks passed.');
