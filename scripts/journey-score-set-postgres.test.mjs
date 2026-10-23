import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

if (!process.env.PGLITE_MODULE) throw new Error('Set PGLITE_MODULE to a test-only PGlite installation.');
const { PGlite } = await import(process.env.PGLITE_MODULE);
const db = new PGlite();
const migration = (name) => readFile(new URL(`../supabase/migrations/${name}.sql`, import.meta.url), 'utf8');
const scalar = async (sql, args = []) => (await db.query(sql, args)).rows[0]?.value;
const instructor = '10000000-0000-4000-8000-000000000001';
const outsider = '10000000-0000-4000-8000-000000000002';
const machine = '00000000-0000-0000-0000-000000000000';
const liveRoom = '20000000-0000-4000-8000-000000000001';
const scoreRoom = '20000000-0000-4000-8000-000000000002';

try {
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE SCHEMA auth; CREATE SCHEMA journey_private;
    REVOKE ALL ON SCHEMA journey_private FROM PUBLIC, anon, authenticated;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$
      SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    CREATE TABLE public.role_assignments(user_id uuid, role text, status text);
    CREATE TABLE public.arena_journey_characters(slug text PRIMARY KEY, ready boolean, updated_at timestamptz);
    CREATE TABLE public.arena_journey_questions(
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), character_slug text,
      question_set_name text, question_stage integer, question_text text,
      difficulty_tag text, bank_order bigint GENERATED ALWAYS AS IDENTITY,
      review_status text, retired_at timestamptz
    );
    CREATE TABLE public.arena_rooms(id uuid PRIMARY KEY, room_name text, status text, completed_at timestamptz, machine_score integer);
    CREATE TABLE public.arena_participants(room_id uuid, user_id uuid, score integer);
    CREATE TABLE public.arena_journey_games(
      room_id uuid PRIMARY KEY REFERENCES public.arena_rooms(id), character_slug text,
      state jsonb, current_question_id uuid REFERENCES public.arena_journey_questions(id)
    );
    CREATE FUNCTION journey_private.get_public_arena_final_scorecard(p_room_id uuid)
    RETURNS jsonb LANGUAGE sql STABLE AS $$
      SELECT CASE WHEN status = 'completed' THEN jsonb_build_object(
        'room_name', room_name, 'winner_id', NULL,
        'players', jsonb_build_array(
          jsonb_build_object('user_id', '${instructor}', 'display_name', 'PH', 'correct_count', 3),
          jsonb_build_object('user_id', '${machine}', 'display_name', 'The Scribe', 'correct_count', 2)))
        END FROM public.arena_rooms WHERE id = p_room_id $$;
    INSERT INTO public.role_assignments VALUES ('${instructor}', 'instructor', 'active');
    INSERT INTO public.arena_journey_characters VALUES ('abraham', true, now()), ('elisha', true, now());
    INSERT INTO public.arena_journey_questions
      (character_slug, question_set_name, question_stage, question_text, difficulty_tag, review_status)
    SELECT 'abraham', 'Correct set', 1, 'Correct question ' || n, 'easy', 'approved'
    FROM generate_series(1, 199) n;
    INSERT INTO public.arena_journey_questions
      (character_slug, question_set_name, question_stage, question_text, difficulty_tag, review_status)
    VALUES ('abraham', 'Wrong set', 1, 'Wrong question 1', 'easy', 'approved'),
      ('abraham', 'Wrong set', 1, 'Wrong question 2', 'easy', 'approved'),
      ('elisha', 'Wrong set', 1, 'Elisha question', 'easy', 'approved');
    INSERT INTO public.arena_rooms VALUES ('${liveRoom}', '[arena:journey] Abraham', 'playing', NULL, 0),
      ('${scoreRoom}', '[arena:journey] Elisha', 'completed', now(), -2);
  `);

  const auto = await migration('20261022091310_journey_automatic_question_bank');
  await db.exec(auto.slice(auto.indexOf('CREATE FUNCTION journey_private.require_instructor()'),
    auto.indexOf('CREATE FUNCTION public.append_arena_journey_question_set')));
  await db.exec(await migration('20261023150000_journey_score_floor_and_set_deletion'));
  await db.exec(`
    CREATE TRIGGER test_journey_participant_points BEFORE UPDATE OF score ON public.arena_participants
      FOR EACH ROW EXECUTE FUNCTION journey_private.sync_journey_points();
    CREATE TRIGGER test_journey_machine_points BEFORE UPDATE OF machine_score ON public.arena_rooms
      FOR EACH ROW EXECUTE FUNCTION journey_private.sync_journey_points();
    INSERT INTO public.arena_journey_games(room_id, character_slug, state, current_question_id)
      SELECT '${liveRoom}', 'abraham', '{"game":{"players":[]}}', id
      FROM public.arena_journey_questions WHERE question_text = 'Wrong question 1';
    INSERT INTO public.arena_journey_games(room_id, character_slug, state)
      VALUES ('${scoreRoom}', 'elisha', '{"game":{"winnerId":"${machine}","players":[
        {"id":"${instructor}","score":-4,"correctAnswers":3},
        {"id":"${machine}","score":-2,"correctAnswers":2}
      ]}}');
    INSERT INTO public.arena_participants VALUES ('${scoreRoom}', '${instructor}', -4);
    SET request.jwt.claim.sub = '${instructor}';
  `);
  const remove = () => scalar('SELECT public.delete_arena_journey_question_set($1, $2) AS value', ['abraham', 'Wrong set']);
  await assert.rejects(remove, /match is using this character/);
  assert.equal(await scalar("SELECT count(*)::integer AS value FROM public.arena_journey_questions WHERE character_slug = 'abraham' AND question_set_name = 'Wrong set'"), 2);
  await db.exec(`UPDATE public.arena_rooms SET status = 'completed', completed_at = now() WHERE id = '${liveRoom}'`);
  const deleted = await remove();
  assert.equal(deleted.deleted, 2);
  assert.equal(deleted.active, 199);
  assert.equal(deleted.ready, false);
  assert.equal(await scalar("SELECT count(*)::integer AS value FROM public.arena_journey_questions WHERE character_slug = 'elisha' AND question_set_name = 'Wrong set'"), 1);
  assert.equal(await scalar(`SELECT current_question_id AS value FROM public.arena_journey_games WHERE room_id = '${liveRoom}'`), null);
  await assert.rejects(remove, /no longer available/);

  const players = JSON.stringify([{ user_id: instructor, correct_count: 3 }]);
  const scored = await scalar('SELECT journey_private.add_journey_scores($1, $2::jsonb) AS value', [scoreRoom, players]);
  assert.equal(scored[0].score, 0);
  assert.equal(scored[0].correct_count, 3);
  const scorecard = await scalar('SELECT public.get_public_arena_final_scorecard($1) AS value', [scoreRoom]);
  assert.equal(scorecard.winner_id, machine);
  assert.deepEqual(scorecard.players.map((player) => player.score), [0, 0]);
  await db.exec(`UPDATE public.arena_participants SET score = 99 WHERE room_id = '${scoreRoom}'`);
  assert.equal(await scalar(`SELECT score AS value FROM public.arena_participants WHERE room_id = '${scoreRoom}'`), 0);
  await db.exec(`UPDATE public.arena_rooms SET machine_score = 99 WHERE id = '${scoreRoom}'`);
  assert.equal(await scalar(`SELECT machine_score AS value FROM public.arena_rooms WHERE id = '${scoreRoom}'`), 0);

  await db.exec(`SET request.jwt.claim.sub = '${outsider}'`);
  await assert.rejects(() => scalar('SELECT public.delete_arena_journey_question_set($1,$2) AS value', ['elisha', 'Wrong set']), /Only an active instructor/);
  assert.equal(await scalar("SELECT has_function_privilege('anon', 'public.delete_arena_journey_question_set(text,text)', 'EXECUTE') AS value"), false);
  console.log('Journey score floor, set deletion, live-match guard, character isolation and instructor permissions passed.');
} catch (error) {
  console.error(error.message, error.where || '', error.detail || '');
  process.exitCode = 1;
} finally { await db.close(); }
