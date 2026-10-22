\set ON_ERROR_STOP on
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
SELECT pg_advisory_xact_lock(22170055);
SELECT EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='20261022170055') AS installed \gset
\if :installed
  \echo Photo access repair already installed. Checking its rules without repeating the migration.
\else
  \ir ../supabase/migrations/20261022170055_restore_app_storage_policies.sql
  INSERT INTO supabase_migrations.schema_migrations(version,name)
  VALUES('20261022170055','restore_app_storage_policies');
\endif
DO $$
BEGIN
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid='storage.objects'::regclass)
    OR NOT has_schema_privilege('authenticated','storage','USAGE')
    OR NOT has_table_privilege('authenticated','storage.objects','SELECT')
    OR NOT has_table_privilege('authenticated','storage.objects','INSERT')
    OR NOT has_table_privilege('authenticated','storage.objects','UPDATE')
    OR NOT has_function_privilege('authenticated','public.save_own_avatar(text)','EXECUTE')
    OR NOT has_function_privilege('authenticated','public.is_instructor(uuid)','EXECUTE')
    OR (SELECT count(*) FROM pg_policies WHERE schemaname='storage' AND tablename='objects'
      AND policyname IN ('avatar_read_all','avatar_upload_own','avatar_update_own','avatar_delete_own',
        'instructor_upload_shared_panel_images','instructor_update_shared_panel_images',
        'instructor_delete_shared_panel_images')) <> 7 THEN
    RAISE EXCEPTION 'Photo access checks failed. No repair was committed.';
  END IF;
END;
$$;
\if :rehearse
  ROLLBACK;
  \echo Photo access rehearsal passed and rolled back. No live changes were saved.
\else
  COMMIT;
  \echo Photo access rules installed. Existing pictures and account data were not changed.
\endif
