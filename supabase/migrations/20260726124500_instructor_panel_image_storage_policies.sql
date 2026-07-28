/*
# Instructor panel image storage policies

Panel and background images are shared app assets, so they do not live under
the uploader's user-id folder. The original avatar policy only allowed
`avatars/{auth.uid()}/...`, which blocked instructor uploads to:

- avatars/panel-images/...
- avatars/weekly-backgrounds/...
*/

INSERT INTO storage.buckets (id, name, public)
VALUES ('avatars', 'avatars', true)
ON CONFLICT (id) DO UPDATE SET public = true;

DROP POLICY IF EXISTS "instructor_upload_shared_panel_images" ON storage.objects;
CREATE POLICY "instructor_upload_shared_panel_images"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'avatars'
    AND public.is_instructor(auth.uid())
    AND (storage.foldername(name))[1] IN ('panel-images', 'weekly-backgrounds')
  );

DROP POLICY IF EXISTS "instructor_update_shared_panel_images" ON storage.objects;
CREATE POLICY "instructor_update_shared_panel_images"
  ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'avatars'
    AND public.is_instructor(auth.uid())
    AND (storage.foldername(name))[1] IN ('panel-images', 'weekly-backgrounds')
  )
  WITH CHECK (
    bucket_id = 'avatars'
    AND public.is_instructor(auth.uid())
    AND (storage.foldername(name))[1] IN ('panel-images', 'weekly-backgrounds')
  );

DROP POLICY IF EXISTS "instructor_delete_shared_panel_images" ON storage.objects;
CREATE POLICY "instructor_delete_shared_panel_images"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'avatars'
    AND public.is_instructor(auth.uid())
    AND (storage.foldername(name))[1] IN ('panel-images', 'weekly-backgrounds')
  );
