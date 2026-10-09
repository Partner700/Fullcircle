const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

const migration = read('supabase/migrations/20261009014844_arena_live_spectators.sql');
const queries = read('src/lib/queries.ts');
const arena = read('src/screens/cadet/CadetArena.tsx');
const roadHome = read('src/screens/cadet/RoadHomeGame.tsx');

assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.arena_viewers/);
assert.match(migration, /ALTER TABLE public\.arena_viewers ENABLE ROW LEVEL SECURITY/);
assert.match(migration, /PRIMARY KEY \(room_id, user_id\)/);
assert.match(migration, /user_id = \(SELECT auth\.uid\(\)\)/);
assert.match(migration, /room\.status = 'playing'/);
assert.match(migration, /NOT EXISTS \([\s\S]*?public\.arena_participants/);

assert.match(migration, /CREATE OR REPLACE FUNCTION public\.watch_arena_room\(p_room_id uuid\)[\s\S]*?SECURITY INVOKER/);
assert.match(migration, /CREATE OR REPLACE FUNCTION public\.heartbeat_arena_viewer\(p_room_id uuid\)[\s\S]*?SECURITY INVOKER/);
assert.match(migration, /CREATE OR REPLACE FUNCTION public\.leave_arena_room_view\(p_room_id uuid\)[\s\S]*?SECURITY INVOKER/);
assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.watch_arena_room\(uuid\) TO authenticated/);

assert.match(migration, /arena players and viewers read trivia responses/);
assert.match(migration, /FROM public\.arena_machine_trivia_responses machine/);
assert.match(migration, /ORDER BY feed\.created_at DESC\s+LIMIT 160/);
assert.match(migration, /arena players and viewers read ludo public state/);
assert.match(migration, /arena players and viewers read room chat/);
assert.doesNotMatch(migration, /CREATE POLICY "arena viewers[^\n]*write/);
assert.doesNotMatch(migration, /arena_viewers[\s\S]{0,160}(stake|score|reward|figs_earned)/i);

assert.match(migration, /IF NEW\.status <> 'playing' OR OLD\.status = 'playing'/);
assert.match(migration, /notification_type[\s\S]*arena_live|PERFORM public\.notify_user\([\s\S]*?'arena_live'/);
assert.match(migration, /NOT EXISTS \([\s\S]*?participant\.user_id = assignment\.user_id/);
assert.match(migration, /ARRAY\['arena_rooms', 'arena_participants', 'arena_trivia_responses', 'arena_viewers'\]/);

assert.match(queries, /export async function watchArenaRoom/);
assert.match(queries, /export async function heartbeatArenaViewer/);
assert.match(queries, /export async function leaveArenaRoomView/);
assert.match(queries, /fetchRoadHomeSpectatorState[\s\S]*?\.from\('arena_ludo_public_states'\)/);
assert.match(queries, /\.select\('room_id,user_id,joined_at,last_seen_at'\)/);

assert.match(arena, /> Live Now</);
assert.match(arena, /isParticipant \? 'Enter Game' : 'Watch'/);
assert.match(arena, /<ArenaViewerStrip viewers=\{viewers\} compact/);
assert.match(arena, /<ArenaViewerStrip viewers=\{viewers\} \/>/);
assert.match(arena, /heartbeatArenaViewer\(activeRoomId\)/);
assert.match(arena, /table: 'arena_trivia_responses'.*filter: `room_id=eq\.\$\{room\.id\}`/s);
assert.match(arena, /setFeed\(\(current\) => \[[\s\S]*?\.slice\(0, 160\)\)/);
assert.match(arena, /score: scores\.get\(ARENA_MACHINE_USER_ID\) \|\| 0/);
assert.doesNotMatch(arena, /score: Number\(room\.machine_score\)/);
assert.match(arena, /Viewer chat is read-only/);

assert.match(roadHome, /spectator\s*\? await fetchRoadHomeSpectatorState\(roomId\)/);
assert.match(roadHome, /if \(spectator \|\| !state \|\| sending\) return false/);
assert.match(roadHome, /<ArenaMatchChat roomId=\{roomId\} userId=\{userId\} readOnly=\{spectator\}/);

console.log('Arena spectator checks passed.');
