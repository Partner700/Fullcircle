\set ON_ERROR_STOP on
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '90s';
SELECT pg_advisory_xact_lock(209210);
SELECT EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='20261022152313') AS installed \gset
\if :installed
  \echo Arena turns and relics already installed. No inventory or question reset is performed.
\else
  \ir ../supabase/migrations/20261022152313_arena_journey_turns_and_relics.sql
  INSERT INTO supabase_migrations.schema_migrations(version,name)
  VALUES('20261022152313','arena_journey_turns_and_relics');
\endif
DO $$
BEGIN
  IF to_regprocedure('public.commit_arena_journey_turn(uuid,integer,jsonb,uuid,uuid,text)') IS NULL
    OR to_regprocedure('public.commit_arena_ludo_turn(uuid,integer,jsonb,jsonb,uuid,uuid,text)') IS NULL
    OR has_function_privilege('authenticated','public.commit_arena_journey_turn(uuid,integer,jsonb,uuid,uuid,text)','EXECUTE')
    OR has_function_privilege('anon','public.commit_arena_ludo_turn(uuid,integer,jsonb,jsonb,uuid,uuid,text)','EXECUTE')
    OR has_schema_privilege('authenticated','journey_private','USAGE') THEN
    RAISE EXCEPTION 'Arena permission verification failed.';
  END IF;
END;
$$;
\if :rehearse
  ROLLBACK;
  \echo Arena database rehearsal rolled back. No live data changed.
\else
  COMMIT;
  \echo Arena rules installed. Questions and owned relic quantities are preserved.
\endif
