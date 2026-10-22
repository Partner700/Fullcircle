\set ON_ERROR_STOP on
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '90s';
SELECT pg_advisory_xact_lock(208209);
SELECT EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '20261022091310') AS bank_installed,
  EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '20261022091508') AS reset_completed \gset
\if :bank_installed
  \echo Automatic question bank already installed.
\else
  \ir ../supabase/migrations/20261022091310_journey_automatic_question_bank.sql
  INSERT INTO supabase_migrations.schema_migrations(version, name)
  VALUES ('20261022091310', 'journey_automatic_question_bank');
\endif
\if :reset_completed
  \echo Previous bank reset already completed. New questions are preserved.
\else
  SELECT count(*) AS journey_questions_before_reset FROM public.arena_journey_questions;
  \ir ../supabase/migrations/20261022091508_journey_reset_question_bank.sql
  INSERT INTO supabase_migrations.schema_migrations(version, name)
  VALUES ('20261022091508', 'journey_reset_question_bank');
  SELECT count(*) AS journey_questions_after_reset FROM public.arena_journey_questions;
\endif
\if :rehearse
  SET LOCAL fullcircle.journey_rehearsal = 'on';
  \ir journey-bank-rehearsal.sql
  ROLLBACK;
  \echo Database rehearsal passed and rolled back. No changes saved.
\else
  COMMIT;
  \echo Journey bank changes committed. The old questions will not be deleted again on retry.
\endif
