import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

// Uses an isolated PostgreSQL-compatible database, never a live project.
const { PGlite } = await import(process.env.PGLITE_MODULE || '@electric-sql/pglite');
const db = new PGlite();
const ids = Array.from({ length: 10 }, (_, i) => `00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`);
const [instructor, a, b, c, d, e, f, g, h, outsider] = ids;
const migration = (name) => readFileSync(new URL(`../supabase/migrations/${name}.sql`, import.meta.url), 'utf8');
const sql = migration('20261026100000_arena_tournament_inline_choices');
const flexible = migration('20261013170000_flexible_arena_tournament_stages');
try {
  await db.exec(`CREATE ROLE authenticated; CREATE ROLE anon; CREATE SCHEMA auth;
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
      stake_amount numeric, max_players int, status text, tagged_user_ids uuid[], game_call_fee numeric, expires_at timestamptz, winner_id uuid);
    CREATE TABLE arena_scheduled_matches (room_id uuid PRIMARY KEY, scheduled_by uuid, starts_at timestamptz, player_ids uuid[]);
    CREATE TABLE arena_participants (room_id uuid, user_id uuid, forfeited_at timestamptz, correct_count int DEFAULT 0, score int DEFAULT 0);
    CREATE TABLE denarii_ledger_entries (user_id uuid, amount numeric, source_type text, source_reference text, description text, UNIQUE(user_id,source_reference));
    CREATE TABLE test_notifications (user_id uuid, title text, payload jsonb);
    CREATE FUNCTION public.notify_user(uuid, uuid, text, text, text, text, jsonb) RETURNS void LANGUAGE sql AS $$
      INSERT INTO public.test_notifications VALUES ($1, $4, $7) $$;`);
  await db.exec(flexible.slice(flexible.indexOf('CREATE OR REPLACE FUNCTION public.create_arena_tournament_room')));
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
    return (await db.query(`SELECT create_instructor_arena_tournament_with_fixtures('Inline Cup','ludo',$1::uuid[],$2::timestamptz[],$3,$4::jsonb) AS id`, [roster, times, groups, JSON.stringify(pairs)])).rows[0].id;
  };
  const games = async (id) => (await db.query('SELECT * FROM arena_tournament_games WHERE tournament_id=$1 ORDER BY round_number,match_number', [id])).rows;
  const change = (id, values) => db.query('SELECT set_arena_tournament_game_players($1,$2::jsonb)', [id, JSON.stringify(values)]);
  const fixture = (game, pair) => ({ game_id: game.id, player_ids: pair });
  const finish = async (game, winner) => {
    const schedule = (await db.query('SELECT * FROM arena_scheduled_matches WHERE room_id=$1', [game.room_id])).rows[0];
    for (const id of schedule.player_ids) await db.query('INSERT INTO arena_participants(room_id,user_id) VALUES ($1,$2)', [game.room_id,id]);
    await db.query("UPDATE arena_rooms SET status='playing' WHERE id=$1", [game.room_id]);
    await db.query("UPDATE arena_rooms SET status='completed',winner_id=$2 WHERE id=$1", [game.room_id,winner]);
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
  await assert.rejects(change(id,[fixture(fixtures[2],[outsider,null])]), /from this tournament/);
  await assert.rejects(change(id,[fixture(fixtures[2],[a,a])]), /two different/);
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
  await assert.rejects(change(groupId,[fixture(groupGames[0],[a,c])]), /meet only once/);
  for (const game of groupGames.slice(0,12)) await finish(game, game.left_player_id);
  groupGames = await games(groupId);
  assert.deepEqual(groupGames.slice(12,14).map((row) => [row.left_player_id,row.right_player_id]), [[a,f],[e,b]], 'Group winners and runners-up still advance automatically');
  assert.ok(groupGames[12].room_id && groupGames[13].room_id);
  await assert.rejects(create([a,b,c,d],[[a,b],[a,d],[null,null]]), /one match per knockout/);
  await assert.rejects(create([a,b,c,d],[[a,b],[c,null],[null,null]]), /both players/);
  await assert.rejects(create([a,b,c,d],[[a,b],[c,d],[outsider,null]]), /from this tournament/);
  const privilege = (await db.query(`SELECT has_function_privilege('anon','public.create_instructor_arena_tournament_with_fixtures(text,text,uuid[],timestamptz[],boolean,jsonb)','EXECUTE') AS allowed`)).rows[0];
  assert.equal(privilege.allowed, false);
  const directFinal = await create([a,b], [[b,a]]);
  const finalGames = await games(directFinal);
  assert.equal(finalGames.length, 1);
  assert.deepEqual([finalGames[0].left_player_id, finalGames[0].right_player_id], [b,a]);
  await db.exec('BEGIN');
  await db.exec(sql);
  await db.exec('ROLLBACK');
  assert.deepEqual(await games(directFinal), finalGames, 'Migration rehearsal preserves existing tournaments');
  console.log('Inline tournament integration passed: explicit fixtures, pending rounds, overrides, auto winners, groups, join reservations, atomic edits and authorization.');
} catch (error) {
  console.error(error.message, error.where || '');
  process.exitCode = 1;
} finally { await db.close(); }
