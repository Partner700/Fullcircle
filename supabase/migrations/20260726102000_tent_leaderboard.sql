CREATE OR REPLACE FUNCTION public.get_tent_leaderboard()
RETURNS TABLE (
  tent_id uuid,
  tent_name text,
  tent_house_id text,
  tent_profile_image_url text,
  sentry_names text[],
  cadet_count bigint,
  total_denarii bigint,
  total_streak bigint,
  combined_score bigint,
  rank bigint
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH tent_people AS (
    SELECT
      t.id AS tent_id,
      t.name AS tent_name,
      t.tent_house_id,
      t.profile_image_url AS tent_profile_image_url,
      tm.user_id,
      tm.role,
      p.display_name
    FROM public.tents t
    LEFT JOIN public.tent_members tm ON tm.tent_id = t.id
    LEFT JOIN public.profiles p ON p.id = tm.user_id
  ),
  cadet_scores AS (
    SELECT
      tp.tent_id,
      COALESCE(SUM(CASE WHEN tp.role = 'cadet' THEN public.get_user_denarii_total(tp.user_id) ELSE 0 END), 0)::bigint AS total_denarii,
      COALESCE(SUM(CASE WHEN tp.role = 'cadet' THEN COALESCE((SELECT current_streak FROM public.compute_strict_streak(tp.user_id) LIMIT 1), 0) ELSE 0 END), 0)::bigint AS total_streak,
      COUNT(*) FILTER (WHERE tp.role = 'cadet')::bigint AS cadet_count,
      ARRAY_REMOVE(ARRAY_AGG(tp.display_name ORDER BY tp.display_name) FILTER (WHERE tp.role = 'sentry'), NULL) AS sentry_names
    FROM tent_people tp
    GROUP BY tp.tent_id
  ),
  rows AS (
    SELECT DISTINCT
      tp.tent_id,
      tp.tent_name,
      tp.tent_house_id,
      tp.tent_profile_image_url,
      COALESCE(cs.sentry_names, ARRAY[]::text[]) AS sentry_names,
      COALESCE(cs.cadet_count, 0) AS cadet_count,
      COALESCE(cs.total_denarii, 0) AS total_denarii,
      COALESCE(cs.total_streak, 0) AS total_streak,
      (COALESCE(cs.total_denarii, 0) + COALESCE(cs.total_streak, 0) * 1000)::bigint AS combined_score
    FROM tent_people tp
    LEFT JOIN cadet_scores cs ON cs.tent_id = tp.tent_id
    WHERE tp.tent_id IS NOT NULL
  )
  SELECT
    rows.*,
    RANK() OVER (ORDER BY rows.combined_score DESC, rows.total_streak DESC, rows.tent_name ASC) AS rank
  FROM rows
  ORDER BY rank ASC, rows.tent_name ASC;
$$;

GRANT EXECUTE ON FUNCTION public.get_tent_leaderboard() TO authenticated;
