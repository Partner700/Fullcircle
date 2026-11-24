-- Allow the existing FCX photo upsert only within the instructor’s own active event folder.

CREATE POLICY fcx_guest_photo_select ON storage.objects
FOR SELECT TO authenticated
USING (
  bucket_id = 'avatars'
  AND (SELECT public.is_instructor(auth.uid()))
  AND name ~ (
    '^' || (SELECT auth.uid())::text ||
    '/fcx/[0-9a-f-]{36}/guest-[0-9]+[.](jpg|png|webp|avif)$'
  )
  AND EXISTS (
    SELECT 1 FROM public.fcx_events AS event
    WHERE event.is_active AND event.id::text = split_part(name, '/', 3)
  )
);

CREATE POLICY fcx_guest_photo_insert ON storage.objects
FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'avatars'
  AND (SELECT public.is_instructor(auth.uid()))
  AND name ~ (
    '^' || (SELECT auth.uid())::text ||
    '/fcx/[0-9a-f-]{36}/guest-[0-9]+[.](jpg|png|webp|avif)$'
  )
  AND EXISTS (
    SELECT 1 FROM public.fcx_events AS event
    WHERE event.is_active AND event.id::text = split_part(name, '/', 3)
  )
);

CREATE POLICY fcx_guest_photo_update ON storage.objects
FOR UPDATE TO authenticated
USING (
  bucket_id = 'avatars'
  AND (SELECT public.is_instructor(auth.uid()))
  AND name ~ (
    '^' || (SELECT auth.uid())::text ||
    '/fcx/[0-9a-f-]{36}/guest-[0-9]+[.](jpg|png|webp|avif)$'
  )
  AND EXISTS (
    SELECT 1 FROM public.fcx_events AS event
    WHERE event.is_active AND event.id::text = split_part(name, '/', 3)
  )
);
