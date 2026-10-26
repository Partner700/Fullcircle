import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

// Uses an isolated PostgreSQL-compatible database, never a live project.
const { PGlite } = await import(process.env.PGLITE_MODULE || '@electric-sql/pglite');
const db = new PGlite();
const ids = Array.from({ length: 10 }, (_, i) => `00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`);
const [instructor, a, b, c, d, e, f, g, h, outsider] = ids;
const migration = (name) => readFileSync(new URL(`../supabase/migrations/${name}.sql`, import.meta.url), 'utf8');
const inlineSql = migration('20261026100000_arena_tournament_inline_choices');
const sql = migration('20261026111736_arena_match_two_to_four_players');
const seriesSql = migration('20261015151000_arena_scheduled_match_series');
const flexible = migration('20261013170000_flexible_arena_tournament_stages');
try {
  await db.exec(`CREATE ROLE authenticated; CREATE ROLE anon; CREATE ROLE service_role; CREATE SCHEMA auth;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT nullif(current_setting('app.uid', true), '')::uuid $$;
    CREATE TABLE profiles (id uuid PRIMARY KEY, display_name text, avatar_url text);
    CREATE TABLE role_assignments (user_id uuid, role text, status text);
    CREATE TABLE tents (id uuid, sentry_id uuid, tent_house_id text);
    CREATE TABLE tent_members (tent_id uuid, user_id uuid, role text);
    CREATE TABLE arena_tournaments (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), title text, created_by uuid, game_type text,
      player_ids uuid[], has_group_stage boolean DEFAULT false, knockout_rounds int, status text DEFAULT 'scheduled',
      champion_id uuid, created_at timestamptz DEFAULT now(), completed_at timestamptz);
    CREATE TABLE arena_tournament_games (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tournament_id uuid,
      round_number int, match_number int, planned_at timestamptz, group_number int, left_player_id uuid,
      right_player_id uuid, left_source_id uuid, right_source_id uuid, room_id uuid UNIQUE, winner_id uuid);
    CREATE TABLE arena_rooms (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), creator_id uuid, room_name text,
      stake_amount numeric, max_players int, status text, tagged_user_ids uuid[], game_call_fee numeric, expires_at timestamptz, winner_id uuid,
      play_mode text DEFAULT 'human', started_at timestamptz, completion_reason text, restarted_as_room_id uuid,
      narrative_date date, game_type text);
    CREATE TABLE arena_scheduled_matches (room_id uuid PRIMARY KEY, scheduled_by uuid, starts_at timestamptz, player_ids uuid[]);
    CREATE TABLE arena_participants (room_id uuid, user_id uuid, forfeited_at timestamptz, correct_count int DEFAULT 0, score int DEFAULT 0, joined_at timestamptz DEFAULT now(), stake_paid boolean, UNIQUE(room_id,user_id));
    CREATE TABLE arena_viewers (room_id uuid, user_id uuid, joined_at timestamptz, last_seen_at timestamptz, UNIQUE(room_id,user_id));
    CREATE TABLE arena_guest_witnesses (room_id uuid, guest_key_hash text, last_seen_at timestamptz, UNIQUE(room_id,guest_key_hash));
    CREATE TABLE denarii_ledger_entries (user_id uuid, amount numeric, source_type text, source_reference text, description text, UNIQUE(user_id,source_reference));
    CREATE TABLE test_notifications (user_id uuid, title text, payload jsonb);
    CREATE FUNCTION public.notify_user(uuid, uuid, text, text, text, text, jsonb) RETURNS void LANGUAGE sql AS $$
      INSERT INTO public.test_notifications VALUES ($1, $4, $7) $$;`);
  await db.exec(flexible.slice(flexible.indexOf('CREATE OR REPLACE FUNCTION public.create_arena_tournament_room')));
  await db.exec(inlineSql);
  await db.exec(seriesSql.slice(0, seriesSql.indexOf('-- The standard trivia function')));
  await db.exec(sql);
  await db.exec(`CREATE TRIGGER settle AFTER UPDATE ON arena_rooms FOR EACH ROW EXECUTE FUNCTION settle_instructor_arena_match_awards();
    CREATE TRIGGER reservation BEFORE INSERT ON arena_participants FOR EACH ROW EXECUTE FUNCTION enforce_instructor_arena_reservation();`);
  for (const [index, id] of ids.entries()) {
    await db.query('INSERT INTO profiles VALUES ($1,$2,null)', [id, `Player ${index}`]);
    await db.query('INSERT INTO role_assignments VALUES ($1,$2,$3)', [id, index === 0 ? 'instructor' : 'cadet', 'active']);
  }
  const signIn = (id) => db.query("SELECT set_config('app.uid', $1, false)", [id]);
  await signIn(instructor);
  const create = async (roster, pairs, groups = false) => {
    const times = pairs.map((_, index) => new Date(Date.now() + (index + 2) * 3600000).toISOString());
    return (await db.query(`SELECT create_instructor_arena_tournament_lineups('Four Player Cup','ludo',$1::uuid[],$2::timestamptz[],$3,$4::jsonb,$5) AS id`, [roster, times, groups, JSON.stringify(pairs), groups ? roster.length : pairs.length + 1])).rows[0].id;
  };
  const games = async (id) => (await db.query('SELECT * FROM arena_tournament_games WHERE tournament_id=$1 ORDER BY round_number,match_number', [id])).rows;
  const change = (id, values) => db.query('SELECT set_arena_tournament_game_players($1,$2::jsonb)', [id, JSON.stringify(values)]);
  const fixture = (game, pair) => ({ game_id: game.id, player_ids: pair });
  const finish = async (game, winner) => {
    let roomId = game.room_id;
    for (let round = 0; round < 4; round++) {
      const schedule = (await db.query('SELECT * FROM arena_scheduled_matches WHERE room_id=$1', [roomId])).rows[0];
      for (const id of schedule.player_ids) await db.query('INSERT INTO arena_participants(room_id,user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [roomId,id]);
      await db.query("UPDATE arena_rooms SET status='playing' WHERE id=$1 AND status='waiting'", [roomId]);
      await db.query('UPDATE arena_participants SET correct_count=CASE WHEN user_id=$2 THEN 10 ELSE 2 END,score=CASE WHEN user_id=$2 THEN 10 ELSE 2 END WHERE room_id=$1', [roomId,winner]);
      await db.query("UPDATE arena_rooms SET status='completed',winner_id=$2 WHERE id=$1", [roomId,winner]);
      const room = (await db.query('SELECT restarted_as_room_id FROM arena_rooms WHERE id=$1', [roomId])).rows[0];
      if (!room.restarted_as_room_id) return;
      roomId = room.restarted_as_room_id;
    }
    assert.fail('Scheduled match did not finish within its configured rounds');
  };

  const id = await create([a,b,c,d], [[a,c],[b,d],[d,null]]);
  let fixtures = await games(id);
  assert.deepEqual(fixtures.map((row) => [row.left_player_id,row.right_player_id]), [[a,c],[b,d],[null,null]]);
  assert.equal(fixtures[2].left_override_id, d);
  assert.equal(fixtures[2].room_id, null, 'Future manual choices do not start a match early');
  assert.deepEqual((await db.query('SELECT player_ids FROM arena_scheduled_matches ORDER BY starts_at')).rows.map((row) => row.player_ids), [[a,c],[b,d]]);
  let fetched = (await db.query('SELECT get_arena_tournaments() AS items')).rows[0].items.find((item) => item.id === id);
  assert.equal(fetched.games[2].can_edit_players, true, 'A final can be edited before qualifiers arrive');
  assert.equal(fetched.games[2].left_player_id, d);
  await change(id, [fixture(fixtures[0],[a,b]), fixture(fixtures[1],[c,d]), fixture(fixtures[2],[d,null])]);
  assert.deepEqual((await db.query('SELECT player_ids FROM arena_scheduled_matches ORDER BY starts_at')).rows.map((row) => row.player_ids), [[a,b],[c,d]]);
  await assert.rejects(change(id,[fixture(fixtures[0],[a,d])]), /one match per knockout/);
  await change(id,[fixture(fixtures[2],[d,null,e])]);
  assert.equal((await games(id))[2].third_player_id, e);
  await change(id,[fixture(fixtures[2],[d,null])]);
  await assert.rejects(change(id,[fixture(fixtures[2],[a,a])]), /different players/);
  await signIn(a);
  await assert.rejects(change(id,[fixture(fixtures[2],[a,c])]), /Only the scheduling/);
  await signIn(instructor);
  await assert.rejects(db.query('INSERT INTO arena_participants(room_id,user_id) VALUES ($1,$2)', [fixtures[0].room_id,c]), /reserved/);
  await finish(fixtures[0], a);
  await assert.rejects(change(id,[fixture(fixtures[0],[a,b])]), /finished/);
  await finish(fixtures[1], c);
  fixtures = await games(id);
  assert.equal(fixtures[2].left_player_id, a, 'Automatic qualifier remains recorded');
  assert.equal(fixtures[2].left_override_id, d, 'Instructor choice survives advancement');
  assert.deepEqual((await db.query('SELECT player_ids FROM arena_scheduled_matches WHERE room_id=$1',[fixtures[2].room_id])).rows[0].player_ids, [d,c]);
  await change(id,[fixture(fixtures[2],[null,null])]);
  assert.deepEqual((await db.query('SELECT player_ids FROM arena_scheduled_matches WHERE room_id=$1',[fixtures[2].room_id])).rows[0].player_ids, [a,c], 'Automatic winners can be restored');
  await db.query('INSERT INTO arena_participants(room_id,user_id) VALUES ($1,$2)', [fixtures[2].room_id,a]);
  await assert.rejects(change(id,[fixture(fixtures[2],[d,c])]), /player has entered/);
  fetched = (await db.query('SELECT get_arena_tournaments() AS items')).rows[0].items.find((item) => item.id === id);
  assert.equal(fetched.games[2].can_edit_players, false);

  const conflictId = await create([a,b,c,d], [[a,b],[c,d],[c,null]]);
  let conflict = await games(conflictId);
  await finish(conflict[0], a);
  await finish(conflict[1], c);
  conflict = await games(conflictId);
  assert.equal(conflict[1].winner_id, c, 'A conflicting future choice cannot roll back the completed match');
  assert.equal(conflict[2].room_id, null, 'A player cannot face themselves');
  await change(conflictId,[fixture(conflict[2],[null,null])]);
  assert.ok((await games(conflictId))[2].room_id, 'Correcting the conflict opens the qualified match');

  const groupPairs = [[a,d],[a,c],[a,b],[b,c],[b,d],[c,d],[e,h],[e,f],[e,g],[f,g],[f,h],[g,h],[null,null],[null,null],[null,null]];
  const groupId = await create([a,b,c,d,e,f,g,h], groupPairs, true);
  let groupGames = await games(groupId);
  assert.deepEqual(groupGames.slice(0,12).map((row) => [row.left_player_id,row.right_player_id]), groupPairs.slice(0,12));
  await assert.rejects(change(groupId,[fixture(groupGames[0],[a,e])]), /from this group/);
  await assert.rejects(change(groupId,[fixture(groupGames[0],[a,c])]), /lineup can meet only once/);
  for (const game of groupGames.slice(0,12)) await finish(game, game.left_player_id);
  groupGames = await games(groupId);
  assert.deepEqual(groupGames.slice(12,14).map((row) => [row.left_player_id,row.right_player_id]), [[a,f],[e,b]], 'Group winners and runners-up still advance automatically');
  assert.ok(groupGames[12].room_id && groupGames[13].room_id);
  await assert.rejects(create([a,b,c,d],[[a,b],[a,d],[null,null]]), /one match per knockout/);
  await assert.rejects(create([a,b,c,d],[[a,b],[c,null],[null,null]]), /both required players/);
  await assert.rejects(create([a,b,c,d],[[a,b],[c,d],[outsider,null]]), /from this tournament/);
  const privilege = (await db.query(`SELECT has_function_privilege('anon','public.create_instructor_arena_tournament_lineups(text,text,uuid[],timestamptz[],boolean,jsonb,integer)','EXECUTE') AS allowed`)).rows[0];
  assert.equal(privilege.allowed, false);
  const directFinal = await create([a,b], [[b,a]]);
  const finalGames = await games(directFinal);
  assert.equal(finalGames.length, 1);
  assert.deepEqual([finalGames[0].left_player_id, finalGames[0].right_player_id], [b,a]);
  await db.exec('BEGIN');
  await db.exec(sql);
  await db.exec('ROLLBACK');
  assert.deepEqual(await games(directFinal), finalGames, 'Migration rehearsal preserves existing tournaments');
  const mixed = await create([a,b,c,d,e,f,g], [[a,b,c],[d,e,f,g],[null,null]]);
  let mixedGames = await games(mixed);
  const capacity = async (room) => (await db.query('SELECT max_players FROM arena_rooms WHERE id=$1', [room])).rows[0].max_players;
  const rounds = async (room) => (await db.query('SELECT required_rounds FROM arena_match_series WHERE initial_room_id=$1', [room])).rows[0].required_rounds;
  assert.equal(await capacity(mixedGames[0].room_id), 3);
  assert.equal(await capacity(mixedGames[1].room_id), 4);
  assert.equal(await rounds(mixedGames[0].room_id), 2);
  assert.equal(await rounds(mixedGames[1].room_id), 3);
  const mixedFetched = (await db.query('SELECT get_arena_tournaments() AS items')).rows[0].items.find((item) => item.id === mixed);
  assert.equal(mixedFetched.bracket_size, 4, 'Seven entrants still form two semifinals and one final');
  assert.deepEqual(mixedFetched.games[1].player_ids, [d,e,f,g]);
  await change(mixed,[fixture(mixedGames[0],[a,b,c,h])]);
  assert.equal(await capacity(mixedGames[0].room_id), 4, 'Editing a lineup updates room capacity');
  assert.equal(await rounds(mixedGames[0].room_id), 3, 'Editing to four players updates the scheduled rounds');
  await change(mixed,[fixture(mixedGames[0],[a,b,c])]);
  assert.equal(await capacity(mixedGames[0].room_id), 3);
  assert.equal(await rounds(mixedGames[0].room_id), 2);
  await assert.rejects(change(mixed,[fixture(mixedGames[0],[a,b,c,h,outsider])]), /2 to 4/);
  await assert.rejects(change(mixed,[fixture(mixedGames[0],[a])]), /2 to 4/);
  await assert.rejects(change(mixed,[fixture(mixedGames[0],[a,b,a])]), /different players/);
  await assert.rejects(change(mixed,[fixture(mixedGames[0],[a,b,d])]), /one match per knockout/);
  await finish(mixedGames[0], c);
  await finish(mixedGames[1], g);
  mixedGames = await games(mixed);
  assert.deepEqual([mixedGames[2].left_player_id,mixedGames[2].right_player_id], [c,g], 'Third and fourth seated players can win and advance');
  await change(mixed,[fixture(mixedGames[2],[null,null,a,b])]);
  assert.equal(await capacity(mixedGames[2].room_id), 4);
  await finish(mixedGames[2], b);
  assert.equal((await db.query('SELECT champion_id FROM arena_tournaments WHERE id=$1',[mixed])).rows[0].champion_id, b);
  assert.equal(Number((await db.query("SELECT amount FROM denarii_ledger_entries WHERE user_id=$1 AND source_reference=$2",[b,'scheduled:champion:'+mixed])).rows[0].amount), 25000);
  for (const roster of [[a], [a,b,c,d,e]]) {
    await assert.rejects(create(roster,[roster]), /supported|2 to 4/);
    await assert.rejects(db.query("SELECT schedule_instructor_arena_match('Exhibition','standard',$1,now()+interval '1 day')",[roster]), /2 to 4/);
  }
  for (const roster of [[a,b], [a,b,c], [a,b,c,d]]) {
    const matchId = (await db.query("SELECT schedule_instructor_arena_match('Exhibition','standard',$1,now()+interval '1 day') AS id",[roster])).rows[0].id;
    assert.equal(await capacity(matchId), roster.length);
  }
  const groupThreeId = await create([a,b,c,d,e,f,g,h], [[a,b,c], ...groupPairs.slice(1)], true);
  const groupThreeGames = await games(groupThreeId);
  assert.equal(await capacity(groupThreeGames[0].room_id),3);
  await assert.rejects(change(groupThreeId,[fixture(groupThreeGames[0],[a,b,e])]), /from this group/);
  console.log('2-4 player match integration passed: mixed capacities, extra-player joins, rounds, advancement, champion rewards, edits, groups and legacy clients.');
} catch (error) {
  console.error(error.message, error.where || '');
  process.exitCode = 1;
} finally { await db.close(); }
