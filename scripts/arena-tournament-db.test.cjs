const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const sql = fs.readFileSync(path.join(__dirname, '../supabase/migrations/20261013140827_instructor_arena_tournaments_and_rewards.sql'), 'utf8');
const arrivals = fs.readFileSync(path.join(__dirname, '../src/components/DoveNotificationArrival.tsx'), 'utf8');

for (const table of ['arena_tournaments', 'arena_tournament_games']) {
  assert.match(sql, new RegExp(`ALTER TABLE public\\.${table} ENABLE ROW LEVEL SECURITY`));
}
assert.match(sql, /REVOKE ALL ON public\.arena_tournaments, public\.arena_tournament_games FROM PUBLIC, anon, authenticated/);
assert.match(sql, /CREATE UNIQUE INDEX arena_scheduled_award_once/);
assert.match(sql, /source_reference LIKE 'scheduled:%'/);
assert.match(sql, /auth\.uid\(\) IS NULL OR NOT EXISTS[\s\S]*?role = 'instructor'/);
assert.match(sql, /coalesce\(cardinality\(p_game_times\), 0\) <> v_count - 1/);
assert.match(sql, /p_game_times\[v_index\] < greatest\(v_left_time, v_right_time\) \+ interval '20 minutes'/);
assert.match(sql, /IF NEW\.status = 'playing' AND OLD\.status = 'waiting'[\s\S]*?1000, 'arena_reward'/);
assert.match(sql, /IF NEW\.status <> 'completed' OR OLD\.status <> 'playing' THEN RETURN NEW/);
assert.match(sql, /NEW\.winner_id = ANY\(v_schedule\.player_ids\)/);
assert.match(sql, /5000, 'arena_reward', 'scheduled:win:'/);
assert.match(sql, /25000, 'arena_reward', 'scheduled:champion:'/);
assert.match(sql, /SET status = 'completed', champion_id = NEW\.winner_id/);
assert.match(sql, /public\.create_arena_tournament_room\(v_next\.id\)/);
assert.match(sql, /'arena_scheduled_result'/);
assert.match(arrivals, /arenaWinnerAvatar/);
assert.match(arrivals, /arenaWinnerTent/);
assert.match(arrivals, /arenaWinnerAmount\.toLocaleString\(\)/);

console.log('Scheduled Arena reward, bracket, and winner announcement checks passed.');
