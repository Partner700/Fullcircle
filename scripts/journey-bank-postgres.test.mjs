import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// PGlite is a test-only PostgreSQL runtime; do not add it to the shipped app.
if (!process.env.PGLITE_MODULE) throw new Error('Set PGLITE_MODULE to the installed PGlite ESM module.');
const { PGlite } = await import(process.env.PGLITE_MODULE);
const db = new PGlite();
const file = name => readFile(new URL(`../${name}`, import.meta.url), 'utf8');
const migration = name => file(`supabase/migrations/${name}.sql`);
const auto = await migration('20261022091310_journey_automatic_question_bank');
const reset = await migration('20261022091508_journey_reset_question_bank');
const checks = await file('scripts/journey-bank-rehearsal.sql');
const scalar = async sql => (await db.query(sql)).rows[0].value;
try {
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE SCHEMA auth;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS
      $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    CREATE TABLE auth.users(id uuid PRIMARY KEY);
    INSERT INTO auth.users VALUES ('00000000-0000-0000-0000-000000000001');
    CREATE TABLE public.role_assignments(user_id uuid, role text, status text);
    INSERT INTO public.role_assignments VALUES ('00000000-0000-0000-0000-000000000001', 'instructor', 'active');
    CREATE TABLE public.arena_rooms(id uuid PRIMARY KEY, status text);
    CREATE TABLE public.daily_trivia_sentinel(id integer PRIMARY KEY);
    INSERT INTO public.daily_trivia_sentinel VALUES (123);
    CREATE SCHEMA supabase_migrations;
    CREATE TABLE supabase_migrations.schema_migrations(version text PRIMARY KEY, name text);
  `);
  await db.exec(await migration('20261017171726_biblical_journey_runtime'));
  await db.exec(await migration('20261019150000_arena_journey_question_bank'));
  await db.exec(`
    INSERT INTO public.arena_journey_characters(slug,display_name,narrative_beats,ready)
    VALUES ('elisha','Elisha','["1","2","3","4","5","6","7"]',true),
      ('elijah','Elijah','["1","2","3","4","5","6","7"]',true);
    INSERT INTO public.arena_journey_questions(character_slug,question_stage,question_type,question_text,
      correct_answer,source_kind,review_status,retired_at)
    SELECT slug,1,'true_false','Original ' || n,'true','supplied-pdf',
      CASE n WHEN 1 THEN 'pending' WHEN 2 THEN 'rejected' ELSE 'approved' END,
      CASE n WHEN 4 THEN now() ELSE NULL END
    FROM public.arena_journey_characters CROSS JOIN generate_series(1,4) AS numbers(n);
    INSERT INTO public.arena_rooms VALUES ('00000000-0000-0000-0000-000000000002','completed');
    INSERT INTO public.arena_journey_games(room_id,character_slug,state,current_question_id)
    SELECT '00000000-0000-0000-0000-000000000002','elisha','{"game":{"status":"finished"}}',id
    FROM public.arena_journey_questions WHERE character_slug='elisha' LIMIT 1;
  `);
  const install = async rehearse => {
    await db.exec('BEGIN');
    try {
      if (!await scalar("SELECT EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='20261022091310') AS value")) {
        await db.exec(auto);
        await db.exec("INSERT INTO supabase_migrations.schema_migrations VALUES ('20261022091310','automatic_bank')");
      }
      if (!await scalar("SELECT EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='20261022091508') AS value")) {
        await db.exec(reset);
        await db.exec("INSERT INTO supabase_migrations.schema_migrations VALUES ('20261022091508','bank_reset')");
      }
      if (rehearse) {
        await db.exec("SET LOCAL fullcircle.journey_rehearsal='on'");
        await db.exec(checks);
      }
      await db.exec(rehearse ? 'ROLLBACK' : 'COMMIT');
    } catch (error) { await db.exec('ROLLBACK'); throw error; }
  };
  await db.exec("UPDATE public.arena_rooms SET status='playing'");
  await assert.rejects(() => install(true), /still playing/);
  assert.equal(await scalar('SELECT count(*)::int AS value FROM public.arena_journey_questions'), 8);
  assert.equal(await scalar("SELECT to_regnamespace('journey_private')::text AS value"), null);
  await db.exec("UPDATE public.arena_rooms SET status='completed'");
  await install(true);
  assert.equal(await scalar('SELECT count(*)::int AS value FROM public.arena_journey_questions'), 8);
  assert.equal(await scalar('SELECT count(*)::int AS value FROM supabase_migrations.schema_migrations'), 0);
  await install(false);
  assert.equal(await scalar('SELECT count(*)::int AS value FROM public.arena_journey_questions'), 0);
  assert.equal(await scalar('SELECT count(*)::int AS value FROM public.arena_journey_characters'), 2);
  assert.equal(await scalar('SELECT count(*)::int AS value FROM public.arena_journey_characters WHERE ready'), 0);
  assert.equal(await scalar('SELECT count(*)::int AS value FROM public.arena_journey_games'), 1);
  assert.equal(await scalar('SELECT current_question_id AS value FROM public.arena_journey_games'), null);
  assert.equal(await scalar('SELECT id AS value FROM public.daily_trivia_sentinel'), 123);
  await db.exec("SET fullcircle.journey_rehearsal='on'");
  await db.exec(checks);
  const added = await scalar('SELECT count(*)::int AS value FROM public.arena_journey_questions');
  assert.equal(added, 201);
  await install(false);
  assert.equal(await scalar('SELECT count(*)::int AS value FROM public.arena_journey_questions'), added);
  await install(true);
  assert.equal(await scalar('SELECT count(*)::int AS value FROM public.arena_journey_questions'), added);
  console.log('PostgreSQL integration passed: real import RPCs, exact 200 threshold, automatic stages, permissions, hard delete, rollback and retry preservation.');
} finally { await db.close(); }
