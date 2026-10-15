const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const migration = fs.readFileSync(path.join(__dirname,
  '../supabase/migrations/20261015151000_arena_scheduled_match_series.sql'), 'utf8');
const scorecardSql = fs.readFileSync(path.join(__dirname,
  '../supabase/migrations/20261015150000_arena_scorecard_winner.sql'), 'utf8');
const scorecard = fs.readFileSync(path.join(__dirname,
  '../src/components/ArenaFinalScorecard.tsx'), 'utf8');
const publicArena = fs.readFileSync(path.join(__dirname,
  '../src/screens/PublicArenaScreen.tsx'), 'utf8');
const roadHome = fs.readFileSync(path.join(__dirname,
  '../src/screens/cadet/RoadHomeGame.tsx'), 'utf8');
const cadetArena = fs.readFileSync(path.join(__dirname,
  '../src/screens/cadet/CadetArena.tsx'), 'utf8');

assert.match(migration, /v_room\.play_mode = 'machine'/);
assert.match(migration, /WHERE room\.status = 'waiting' AND room\.play_mode <> 'machine'/);
assert.match(migration, /CASE WHEN v_count = 4 THEN 3 ELSE 2 END/g);
assert.match(migration, /v_round\.round_number >= v_series\.required_rounds/);
assert.match(migration, /HAVING sum\(score\.correct_count\) = v_top_score/);
assert.match(migration, /IF v_ties = 1 THEN[\s\S]*?NEW\.winner_id := v_top/);
assert.match(migration, /NEW\.winner_id := NULL;[\s\S]*?NEW\.restarted_as_room_id := v_next_room/);
assert.match(migration, /IF NEW\.completion_reason = 'forfeit' THEN/);
assert.match(migration, /UPDATE public\.arena_tournament_games SET room_id = v_next_room/);
assert.match(migration, /INSERT INTO public\.arena_guest_witnesses/);
assert.match(migration, /v_next_room IS NOT NULL THEN RETURN/);
assert.match(migration, /CREATE OR REPLACE FUNCTION public\.get_public_arena_successor/);
assert.match(scorecardSql, /'winner_id', v_room\.winner_id/);
assert.match(scorecard, /compact && result\.winner_id === player\.user_id/);
assert.match(publicArena, /fetchPublicArenaSuccessor\(currentRoomId\)/);
assert.match(roadHome, /awaitSeriesResult && seriesResolution !== 'final'/);
assert.match(cadetArena, /finishedRoom\?\.status === 'completed' && !finishedRoom\.restarted_as_room_id/);
assert.match(cadetArena, /if \(!freshRoom\.restarted_as_room_id\) setPhase\('finished'\)/);
assert.match(cadetArena, /Waiting for the match result/);
assert.match(cadetArena, /completedRef\.current = false;\s*completeGame\(\)/);

console.log('Scheduled series, draw rematches, awards, witnesses, and winner display checks passed.');
