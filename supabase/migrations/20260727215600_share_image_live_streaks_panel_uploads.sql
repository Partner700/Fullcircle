/*
# Share image, live streak board, and flexible panel image slots

- Allows every instructor-managed `panel_image_*` slot to save without
  fighting the scheduled_announcements check constraint.
- Adds a live streak board RPC that uses the existing strict streak function,
  so the board stays aligned with app streak rules at all times.
*/

ALTER TABLE public.scheduled_announcements
  DROP CONSTRAINT IF EXISTS scheduled_announcements_announcement_type_check;

ALTER TABLE public.scheduled_announcements
  ADD CONSTRAINT scheduled_announcements_announcement_type_check
  CHECK (
    announcement_type IN (
      'morning_call',
      'midday_reminder',
      'evening_reminder',
      'quote_of_day',
      'streakboard_release',
      'general',
      'weekly_background'
    )
    OR announcement_type LIKE 'panel_image_%'
  );

CREATE OR REPLACE FUNCTION public.get_streakboard_live()
RETURNS TABLE(
  id uuid,
  snapshot_date date,
  user_id uuid,
  tent_id uuid,
  tent_house_id text,
  volume integer,
  consistency integer,
  improvement numeric,
  current_streak integer,
  longest_streak integer,
  rank integer,
  profiles jsonb
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH active_cadets AS (
    SELECT DISTINCT ON (ra.user_id) ra.user_id
    FROM public.role_assignments ra
    WHERE ra.role = 'cadet'
      AND ra.status = 'active'
    ORDER BY ra.user_id, ra.created_at DESC
  ),
  member_tents AS (
    SELECT DISTINCT ON (tm.user_id)
      tm.user_id,
      tm.tent_id,
      t.tent_house_id
    FROM public.tent_members tm
    JOIN public.tents t ON t.id = tm.tent_id
    ORDER BY tm.user_id, tm.joined_at DESC
  ),
  scored AS (
    SELECT
      ac.user_id,
      mt.tent_id,
      mt.tent_house_id,
      COALESCE((
        SELECT count(*)::integer
        FROM public.daily_records dr
        WHERE dr.user_id = ac.user_id
          AND COALESCE(dr.streak_valid, false) = true
      ), 0) AS volume,
      COALESCE(st.current_streak, 0)::integer AS current_streak,
      COALESCE(st.longest_streak, 0)::integer AS longest_streak,
      p.display_name,
      p.avatar_url
    FROM active_cadets ac
    JOIN public.profiles p ON p.id = ac.user_id
    LEFT JOIN member_tents mt ON mt.user_id = ac.user_id
    LEFT JOIN LATERAL public.compute_strict_streak(ac.user_id) st ON true
  )
  SELECT
    gen_random_uuid() AS id,
    timezone('Africa/Douala', now())::date AS snapshot_date,
    scored.user_id,
    scored.tent_id,
    scored.tent_house_id,
    scored.volume,
    scored.longest_streak AS consistency,
    0::numeric AS improvement,
    scored.current_streak,
    scored.longest_streak,
    rank() OVER (
      ORDER BY scored.current_streak DESC, scored.longest_streak DESC, scored.volume DESC, scored.display_name ASC
    )::integer AS rank,
    jsonb_build_object(
      'display_name', scored.display_name,
      'avatar_url', scored.avatar_url
    ) AS profiles
  FROM scored
  ORDER BY rank, scored.display_name;
$$;

GRANT EXECUTE ON FUNCTION public.get_streakboard_live() TO authenticated;
