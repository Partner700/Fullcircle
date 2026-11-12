-- The client compresses avatars to <=640px and targets <=160KiB.
-- Its timestamped paths allow unlimited replacements without stale image caching.
-- Upsert needs SELECT, INSERT and UPDATE; every policy is scoped to the caller.
CREATE POLICY own_profile_photo_select ON storage.objects
FOR SELECT TO authenticated USING (bucket_id = 'avatars' AND name ~ ('^' || (SELECT auth.uid())::text || '/avatar-[0-9]+[.](webp|jpg|jpeg|png|avif)$'));
CREATE POLICY own_profile_photo_insert ON storage.objects
FOR INSERT TO authenticated WITH CHECK (bucket_id = 'avatars' AND name ~ ('^' || (SELECT auth.uid())::text || '/avatar-[0-9]+[.](webp|jpg|jpeg|png|avif)$'));
CREATE POLICY own_profile_photo_update ON storage.objects
FOR UPDATE TO authenticated USING (bucket_id = 'avatars' AND name ~ ('^' || (SELECT auth.uid())::text || '/avatar-[0-9]+[.](webp|jpg|jpeg|png|avif)$')) WITH CHECK (bucket_id = 'avatars' AND name ~ ('^' || (SELECT auth.uid())::text || '/avatar-[0-9]+[.](webp|jpg|jpeg|png|avif)$'));
