\set ON_ERROR_STOP on
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '90s';
SELECT pg_advisory_xact_lock(209211);
SELECT EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='20261023150000') AS installed \gset
\if :installed
  \echo Journey score and question-set functions are already installed. No questions were changed.
\else
  \ir ../supabase/migrations/20261023150000_journey_score_floor_and_set_deletion.sql
  INSERT INTO supabase_migrations.schema_migrations(version,name)
  VALUES('20261023150000','journey_score_floor_and_set_deletion');
\endif
DO $$
BEGIN
  IF to_regprocedure('public.delete_arena_journey_question_set(text,text)') IS NULL
    OR has_function_privilege('anon','public.delete_arena_journey_question_set(text,text)','EXECUTE')
    OR NOT has_function_privilege('authenticated','public.delete_arena_journey_question_set(text,text)','EXECUTE')
    OR has_schema_privilege('authenticated','journey_private','USAGE') THEN
    RAISE EXCEPTION 'Journey question-set permissions are not ready.';
  END IF;
END;
$$;
\if :rehearse
  ROLLBACK;
  \echo Journey database rehearsal rolled back. No live data changed.
\else
  COMMIT;
  \echo Journey score and set functions installed. No question set was deleted.
\endif
