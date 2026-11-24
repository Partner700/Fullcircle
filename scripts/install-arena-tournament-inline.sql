\set ON_ERROR_STOP on
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '90s';
SELECT pg_advisory_xact_lock(213213);
SELECT EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations
  WHERE version = '20261026100000') AS installed \gset
\if :installed
  \echo Inline tournament choices are already installed.
\else
  \ir ../supabase/migrations/20261026100000_arena_tournament_inline_choices.sql
  INSERT INTO supabase_migrations.schema_migrations(version,name)
  VALUES ('20261026100000','arena_tournament_inline_choices');
\endif
DO $$
BEGIN
  IF to_regprocedure('public.create_instructor_arena_tournament_with_fixtures(text,text,uuid[],timestamptz[],boolean,jsonb)') IS NULL
    OR has_function_privilege('anon','public.set_arena_tournament_game_players(uuid,jsonb)','EXECUTE')
    OR NOT has_function_privilege('authenticated','public.set_arena_tournament_game_players(uuid,jsonb)','EXECUTE')
    OR has_function_privilege('anon','public.create_instructor_arena_tournament_with_fixtures(text,text,uuid[],timestamptz[],boolean,jsonb)','EXECUTE')
    OR NOT has_function_privilege('authenticated','public.create_instructor_arena_tournament_with_fixtures(text,text,uuid[],timestamptz[],boolean,jsonb)','EXECUTE')
    OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public'
      AND table_name='arena_tournament_games' AND column_name='left_override_id') THEN
    RAISE EXCEPTION 'Inline tournament choices are not ready.';
  END IF;
END;
$$;
\if :rehearse
  ROLLBACK;
  \echo Inline tournament rehearsal rolled back.
\else
  COMMIT;
  \echo Inline tournament choices installed.
\endif
