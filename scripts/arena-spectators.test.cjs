const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

const migration = read('supabase/migrations/20261009014844_arena_live_spectators.sql');
const viewerChatMigration = read('supabase/migrations/20261009025309_arena_viewer_chat_game_calls.sql');
const queries = read('src/lib/queries.ts');
const arena = read('src/screens/cadet/CadetArena.tsx');
const roadHome = read('src/screens/cadet/RoadHomeGame.tsx');
const arenaRoomChat = read('src/components/ArenaRoomChat.tsx');
const arenaQuestionGenerator = read('supabase/functions/generate-arena-questions/index.ts');

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
assert.doesNotMatch(arena, /Viewer chat is read-only/);
assert.match(arena, /const ARENA_ROUND_LENGTHS = \[6, 6, 7\]/);
assert.match(arena, /const ARENA_ROUND_LABELS = \['Easy', 'Medium', 'Hard'\]/);
assert.match(arena, /allowGameCalls/);
assert.match(arena, /participants\.length >= room\.max_players[\s\S]*?watchRoom\(room\.id, 'waiting'\)/);

assert.match(roadHome, /spectator\s*\? await fetchRoadHomeSpectatorState\(roomId\)/);
assert.match(roadHome, /if \(spectator \|\| !state \|\| sending\) return false/);
assert.match(roadHome, /<ArenaRoomChat[\s\S]*?allowGameCalls=\{spectator\}/);
assert.doesNotMatch(roadHome, /Viewer chat is read-only/);

assert.match(viewerChatMigration, /CREATE TABLE IF NOT EXISTS public\.arena_chat_game_calls/);
assert.match(viewerChatMigration, /ALTER TABLE public\.arena_chat_game_calls ENABLE ROW LEVEL SECURITY/);
assert.match(viewerChatMigration, /arena players and viewers write room chat/);
assert.match(viewerChatMigration, /sender_id = \(SELECT auth\.uid\(\)\)/);
assert.match(viewerChatMigration, /CREATE OR REPLACE FUNCTION public\.create_arena_chat_game_call/);
assert.match(viewerChatMigration, /Only a current viewer can call a game from this live chat/);
assert.match(viewerChatMigration, /v_target_room_id := public\.create_arena_room/);
assert.match(viewerChatMigration, /CASE WHEN v_game_type = 'ludo' THEN 4 ELSE 8 END/);
assert.match(viewerChatMigration, /CREATE OR REPLACE FUNCTION public\.get_arena_chat_game_calls/);
assert.match(viewerChatMigration, /room\.status IN \('waiting', 'playing'\)/);
assert.match(viewerChatMigration, /ALTER PUBLICATION supabase_realtime ADD TABLE public\.%I|ALTER PUBLICATION supabase_realtime ADD TABLE public\.arena_chat_game_calls/);

assert.match(queries, /export type ArenaChatGameCall/);
assert.match(queries, /export async function fetchArenaChatGameCalls/);
assert.match(queries, /export async function createArenaChatGameCall/);
assert.match(arenaRoomChat, /Talk during the match/);
assert.match(arenaRoomChat, /Call game/);
assert.match(arenaRoomChat, /gameCall\.participant_count < gameCall\.max_players/);
assert.match(arenaRoomChat, /label: 'Watch'/);
assert.match(arenaRoomChat, /sendArenaRoomMessage\(roomId, userId, body\)/);

assert.match(arenaQuestionGenerator, /const round = index < 6 \? 1 : index < 12 \? 2 : 3/);
assert.match(arenaQuestionGenerator, /\{ difficulty: 'easy', count: 6 \}/);
assert.match(arenaQuestionGenerator, /\{ difficulty: 'moderate', count: 6 \}/);
assert.match(arenaQuestionGenerator, /\{ difficulty: 'hard', count: 7 \}/);
assert.doesNotMatch(arenaQuestionGenerator, /index < 18 \? 3 : 4/);

console.log('Arena spectator, shared chat, game-call, and three-round checks passed.');
