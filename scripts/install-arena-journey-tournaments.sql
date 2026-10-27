\set ON_ERROR_STOP on
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '90s';
SELECT pg_advisory_xact_lock(215215);
SELECT EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations
  WHERE version = '20261027191312') AS installed \gset
\if :installed
  \echo Journey tournaments are already installed.
\else
  \ir ../supabase/migrations/20261027191312_arena_journey_tournaments.sql
  INSERT INTO supabase_migrations.schema_migrations(version,name)
  VALUES ('20261027191312','arena_journey_tournaments');
\endif
DO $$
BEGIN
  IF to_regprocedure('public.create_instructor_arena_tournament_lineups(text,text,uuid[],timestamptz[],boolean,jsonb,integer,text)') IS NULL
    OR has_function_privilege('anon','public.create_instructor_arena_tournament_lineups(text,text,uuid[],timestamptz[],boolean,jsonb,integer,text)','EXECUTE')
    OR NOT has_function_privilege('authenticated','public.create_instructor_arena_tournament_lineups(text,text,uuid[],timestamptz[],boolean,jsonb,integer,text)','EXECUTE')
    OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public'
      AND table_name='arena_tournaments' AND column_name='journey_character_slug') THEN
    RAISE EXCEPTION 'Journey tournaments are not ready.';
  END IF;
END;
$$;
NOTIFY pgrst, 'reload schema';
\if :rehearse
  ROLLBACK;
  \echo Journey tournament rehearsal rolled back.
\else
  COMMIT;
  \echo Journey tournaments installed.
\endif
