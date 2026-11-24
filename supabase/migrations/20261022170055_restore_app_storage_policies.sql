-- Storage policies are outside the application schema dump. Restore the existing
-- folder boundaries explicitly after a project copy, without touching any files.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'avatars') THEN
    RAISE EXCEPTION 'The avatars bucket is missing. Restore the bucket before repairing its access rules.';
  END IF;
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'storage.objects'::regclass) THEN
    RAISE EXCEPTION 'Storage row security is disabled. Stop for a security review.';
  END IF;
END;
$$;

GRANT USAGE ON SCHEMA storage TO anon, authenticated;
GRANT SELECT ON storage.objects TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON storage.objects TO authenticated;

DROP POLICY IF EXISTS avatar_read_all ON storage.objects;
CREATE POLICY avatar_read_all ON storage.objects FOR SELECT
TO anon, authenticated USING (bucket_id = 'avatars');

DROP POLICY IF EXISTS avatar_upload_own ON storage.objects;
CREATE POLICY avatar_upload_own ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'avatars' AND (storage.foldername(name))[1] = (SELECT auth.uid())::text);

DROP POLICY IF EXISTS avatar_update_own ON storage.objects;
CREATE POLICY avatar_update_own ON storage.objects FOR UPDATE TO authenticated
USING (bucket_id = 'avatars' AND (storage.foldername(name))[1] = (SELECT auth.uid())::text)
WITH CHECK (bucket_id = 'avatars' AND (storage.foldername(name))[1] = (SELECT auth.uid())::text);

DROP POLICY IF EXISTS avatar_delete_own ON storage.objects;
CREATE POLICY avatar_delete_own ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'avatars' AND (storage.foldername(name))[1] = (SELECT auth.uid())::text);

DROP POLICY IF EXISTS instructor_upload_shared_panel_images ON storage.objects;
CREATE POLICY instructor_upload_shared_panel_images ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'avatars' AND (storage.foldername(name))[1] IN ('panel-images', 'weekly-backgrounds')
  AND public.is_instructor((SELECT auth.uid())));

DROP POLICY IF EXISTS instructor_update_shared_panel_images ON storage.objects;
CREATE POLICY instructor_update_shared_panel_images ON storage.objects FOR UPDATE TO authenticated
USING (bucket_id = 'avatars' AND (storage.foldername(name))[1] IN ('panel-images', 'weekly-backgrounds')
  AND public.is_instructor((SELECT auth.uid())))
WITH CHECK (bucket_id = 'avatars' AND (storage.foldername(name))[1] IN ('panel-images', 'weekly-backgrounds')
  AND public.is_instructor((SELECT auth.uid())));

DROP POLICY IF EXISTS instructor_delete_shared_panel_images ON storage.objects;
CREATE POLICY instructor_delete_shared_panel_images ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'avatars' AND (storage.foldername(name))[1] IN ('panel-images', 'weekly-backgrounds')
  AND public.is_instructor((SELECT auth.uid())));
