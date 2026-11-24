\set ON_ERROR_STOP on
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '90s';
SELECT pg_advisory_xact_lock(212212);
SELECT EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations
  WHERE version = '20261026090000') AS installed \gset
\if :installed
  \echo Tournament fixture function is already installed.
\else
  \ir ../supabase/migrations/20261026090000_arena_tournament_fixture_players.sql
  INSERT INTO supabase_migrations.schema_migrations(version,name)
  VALUES ('20261026090000','arena_tournament_fixture_players');
\endif
DO $$
BEGIN
  IF to_regprocedure('public.set_arena_tournament_game_players(uuid,jsonb)') IS NULL
    OR has_function_privilege('anon','public.set_arena_tournament_game_players(uuid,jsonb)','EXECUTE')
    OR NOT has_function_privilege('authenticated','public.set_arena_tournament_game_players(uuid,jsonb)','EXECUTE') THEN
    RAISE EXCEPTION 'Tournament fixture permissions are not ready.';
  END IF;
END;
$$;
\if :rehearse
  ROLLBACK;
  \echo Tournament fixture migration rehearsal rolled back.
\else
  COMMIT;
  \echo Tournament fixture function installed.
\endif
