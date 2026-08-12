/*
# Profile birthdays and automatic birthday slides

- Stores birthdays as month/day without requiring a birth year.
- Exposes today's birthday announcements as regular slideshow rows.
- Seeds Linda Karen's birthday slide for August 12 so it appears tonight.
*/

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS birth_month integer,
  ADD COLUMN IF NOT EXISTS birth_day integer;

ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_birth_month_check,
  DROP CONSTRAINT IF EXISTS profiles_birth_day_check;

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_birth_month_check CHECK (birth_month IS NULL OR birth_month BETWEEN 1 AND 12),
  ADD CONSTRAINT profiles_birth_day_check CHECK (birth_day IS NULL OR birth_day BETWEEN 1 AND 31);

CREATE OR REPLACE FUNCTION public.get_today_birthday_announcements()
RETURNS TABLE (
  id uuid,
  announcement_type text,
  publish_at timestamptz,
  audience text,
  content text,
  is_active boolean,
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
