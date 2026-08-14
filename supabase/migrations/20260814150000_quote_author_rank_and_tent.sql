/*
# Quote author rank and tent symbol data

Adds rank and tent-house metadata to the daily quote feed so dashboard quote
cards can show the author's rank and tent symbol without extra client queries.
*/

DROP FUNCTION IF EXISTS public.get_daily_quote_feed(integer);

CREATE OR REPLACE FUNCTION public.get_daily_quote_feed(p_limit integer DEFAULT 12)
RETURNS TABLE (
  record_date date,
  daily_quote text,
  user_id uuid,
  display_name text,
  avatar_url text,
  current_streak integer,
  total_figs integer,
  rhudes integer,
  role text,
  tent_house_id text,
  tent_name text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH clock AS (
    SELECT timezone('Africa/Douala', now())::date AS today
  ),
  active_roles AS (
    SELECT DISTINCT ON (assignment.user_id)
      assignment.user_id,
      assignment.role
    FROM public.role_assignments assignment
    WHERE assignment.status IN ('active', 'approved')
    ORDER BY
      assignment.user_id,
      CASE assignment.role WHEN 'instructor' THEN 1 WHEN 'sentry' THEN 2 ELSE 3 END,
      CASE assignment.status WHEN 'active' THEN 1 ELSE 2 END,
      assignment.start_date DESC NULLS LAST,
      assignment.created_at DESC
  ),
  active_tents AS (
    SELECT DISTINCT ON (member.user_id)
      member.user_id,
      tents.tent_house_id,
      tents.name AS tent_name
    FROM public.tent_members member
    JOIN public.tents tents ON tents.id = member.tent_id
    ORDER BY member.user_id, member.joined_at DESC
  )
  SELECT
    dr.record_date,
    dr.daily_quote,
    dr.user_id,
    p.display_name,
    p.avatar_url,
    COALESCE(marks.current_streak, (SELECT current_streak FROM public.compute_strict_streak(dr.user_id) LIMIT 1), 0)::integer AS current_streak,
    COALESCE(marks.total_figs, 0)::integer AS total_figs,
    COALESCE(marks.rhudes, 0)::integer AS rhudes,
    COALESCE(roles.role, 'cadet')::text AS role,
    tents.tent_house_id,
    tents.tent_name
  FROM public.daily_records dr
  JOIN public.profiles p ON p.id = dr.user_id
  LEFT JOIN public.get_marks_board_live() marks ON marks.user_id = dr.user_id
  LEFT JOIN active_roles roles ON roles.user_id = dr.user_id
  LEFT JOIN active_tents tents ON tents.user_id = dr.user_id
  CROSS JOIN clock c
  WHERE dr.meditation_submitted = true
    AND dr.record_date = c.today
    AND NULLIF(btrim(dr.daily_quote), '') IS NOT NULL
  ORDER BY dr.meditation_submitted_at DESC NULLS LAST, p.display_name ASC
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 12), 1), 30);
$$;

GRANT EXECUTE ON FUNCTION public.get_daily_quote_feed(integer) TO authenticated;
