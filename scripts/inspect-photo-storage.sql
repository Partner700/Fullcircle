\set ON_ERROR_STOP on
BEGIN READ ONLY;
SET LOCAL statement_timeout = '15s';
SELECT id AS bucket, public, file_size_limit, allowed_mime_types
FROM storage.buckets WHERE id = 'avatars';
SELECT c.relrowsecurity AS row_security,
  has_schema_privilege('authenticated','storage','USAGE') AS signed_in_schema_access,
  has_table_privilege('authenticated','storage.objects','SELECT') AS can_select,
  has_table_privilege('authenticated','storage.objects','INSERT') AS can_insert,
  has_table_privilege('authenticated','storage.objects','UPDATE') AS can_update,
  has_function_privilege('authenticated','public.save_own_avatar(text)','EXECUTE') AS can_save_photo
FROM pg_class c WHERE c.oid = 'storage.objects'::regclass;
SELECT policyname, permissive, roles, cmd, qual, with_check
FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects'
ORDER BY policyname;
COMMIT;
