/*
# Birthday slide avatar metadata

Recreates the automatic birthday feed with avatar metadata so birthday slides
can display the celebrant's profile picture even if the prior function shape
was already applied remotely.
*/

DROP FUNCTION IF EXISTS public.get_today_birthday_announcements();

CREATE OR REPLACE FUNCTION public.get_today_birthday_announcements()
RETURNS TABLE (
  id uuid,
  announcement_type text,
  publish_at timestamptz,
  audience text,
  content text,
  is_active boolean,
  metadata jsonb,
  image_position_x numeric,
  image_position_y numeric,
  audio_start_seconds numeric,
  audio_end_seconds numeric
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH clock AS (
    SELECT timezone('Africa/Douala', now()) AS local_now
  ),
  automatic_birthdays AS (
    SELECT
      p.id,
      'birthday'::text AS announcement_type,
      date_trunc('day', c.local_now)::timestamptz AS publish_at,
      'all'::text AS audience,
      ('Celebrate ' || p.display_name || '''s birthday today!')::text AS content,
      true AS is_active,
      jsonb_build_object('user_id', p.id, 'display_name', p.display_name, 'avatar_url', p.avatar_url, 'kind', 'birthday') AS metadata,
      NULL::numeric AS image_position_x,
      NULL::numeric AS image_position_y,
      NULL::numeric AS audio_start_seconds,
      NULL::numeric AS audio_end_seconds
    FROM public.profiles p
    CROSS JOIN clock c
    WHERE p.birth_month = EXTRACT(month FROM c.local_now)::integer
      AND p.birth_day = EXTRACT(day FROM c.local_now)::integer
      AND NULLIF(btrim(COALESCE(p.display_name, '')), '') IS NOT NULL
  ),
  linda_tonight AS (
    SELECT
      '00000000-0000-0000-0000-000000081212'::uuid AS id,
      'birthday'::text AS announcement_type,
      date_trunc('day', c.local_now)::timestamptz AS publish_at,
      'all'::text AS audience,
      'Celebrate Linda Karen''s birthday today!'::text AS content,
      true AS is_active,
      COALESCE((
        SELECT jsonb_build_object('user_id', p.id, 'display_name', p.display_name, 'avatar_url', p.avatar_url, 'kind', 'birthday')
        FROM public.profiles p
        WHERE p.display_name ILIKE '%Linda%Karen%'
        ORDER BY p.created_at DESC
        LIMIT 1
      ), jsonb_build_object('display_name', 'Linda Karen', 'avatar_url', NULL, 'kind', 'birthday')) AS metadata,
      NULL::numeric AS image_position_x,
      NULL::numeric AS image_position_y,
      NULL::numeric AS audio_start_seconds,
      NULL::numeric AS audio_end_seconds
    FROM clock c
    WHERE c.local_now::date = DATE '2026-08-12'
      AND NOT EXISTS (
        SELECT 1 FROM automatic_birthdays birthday
        WHERE birthday.content ILIKE '%Linda Karen%'
      )
  )
  SELECT * FROM automatic_birthdays
  UNION ALL
  SELECT * FROM linda_tonight;
$$;

REVOKE ALL ON FUNCTION public.get_today_birthday_announcements() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_today_birthday_announcements() TO authenticated;
