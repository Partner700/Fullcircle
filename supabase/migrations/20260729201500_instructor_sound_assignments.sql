/* Instructor-managed sound files for the dashboard and button feedback. */

ALTER TABLE public.scheduled_announcements
  DROP CONSTRAINT IF EXISTS scheduled_announcements_announcement_type_check;

ALTER TABLE public.scheduled_announcements
  ADD CONSTRAINT scheduled_announcements_announcement_type_check
  CHECK (
    announcement_type IN (
      'morning_call', 'midday_reminder', 'evening_reminder', 'quote_of_day',
      'streakboard_release', 'general', 'weekly_background'
    )
    OR announcement_type LIKE 'panel_image_%'
    OR announcement_type IN ('sound_dashboard', 'sound_button')
  );

DROP POLICY IF EXISTS "instructor_upload_shared_sound_assets" ON storage.objects;
CREATE POLICY "instructor_upload_shared_sound_assets"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'avatars'
    AND public.is_instructor(auth.uid())
    AND (storage.foldername(name))[1] = 'sound-assets'
  );

DROP POLICY IF EXISTS "instructor_update_shared_sound_assets" ON storage.objects;
CREATE POLICY "instructor_update_shared_sound_assets"
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'avatars' AND public.is_instructor(auth.uid()) AND (storage.foldername(name))[1] = 'sound-assets')
  WITH CHECK (bucket_id = 'avatars' AND public.is_instructor(auth.uid()) AND (storage.foldername(name))[1] = 'sound-assets');

DROP POLICY IF EXISTS "instructor_delete_shared_sound_assets" ON storage.objects;
CREATE POLICY "instructor_delete_shared_sound_assets"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'avatars' AND public.is_instructor(auth.uid()) AND (storage.foldername(name))[1] = 'sound-assets');
