/*
# Purchase sync and tent-house sentry boards

- Returns live Denarii boards to cadets only.
- Adds sentry names to tent-house boards, where sentries should appear.
*/

DROP FUNCTION IF EXISTS public.get_leaderboard_live();
CREATE OR REPLACE FUNCTION public.get_leaderboard_live()
RETURNS TABLE (
  user_id uuid,
  display_name text,
  role text,
  tent_id uuid,
  tent_name text,
  tent_house_id text,
  total_denarii bigint,
  rank integer
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH active_cadets AS (
    SELECT DISTINCT ON (ra.user_id)
      ra.user_id
    FROM public.role_assignments ra
    WHERE ra.role = 'cadet'
      AND ra.status IN ('active', 'approved')
    ORDER BY ra.user_id, ra.created_at DESC
  ),
  totals AS (
    SELECT
      ac.user_id,
      p.display_name,
      'cadet'::text AS role,
      tm.tent_id,
      t.name AS tent_name,
      t.tent_house_id,
      public.get_user_denarii_total(ac.user_id)::bigint AS total_denarii
    FROM active_cadets ac
    JOIN public.profiles p ON p.id = ac.user_id
    LEFT JOIN LATERAL (
      SELECT tm2.tent_id
      FROM public.tent_members tm2
      WHERE tm2.user_id = ac.user_id
        AND tm2.role = 'cadet'
      ORDER BY tm2.joined_at DESC
      LIMIT 1
    ) tm ON true
    LEFT JOIN public.tents t ON t.id = tm.tent_id
  )
  SELECT
    totals.user_id,
    totals.display_name,
    totals.role,
    totals.tent_id,
    totals.tent_name,
    totals.tent_house_id,
    totals.total_denarii,
    RANK() OVER (ORDER BY totals.total_denarii DESC, totals.display_name ASC)::integer AS rank
  FROM totals
  ORDER BY total_denarii DESC, display_name ASC;
$$;

GRANT EXECUTE ON FUNCTION public.get_leaderboard_live() TO authenticated;

DROP FUNCTION IF EXISTS public.get_tent_house_leaderboard();
CREATE OR REPLACE FUNCTION public.get_tent_house_leaderboard()
RETURNS TABLE (
  tent_house_id text,
  tent_house_name text,
  total_denarii bigint,
  cadet_count integer,
  sentry_names text[],
  rank integer
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH house_cadets AS (
    SELECT DISTINCT
      t.tent_house_id,
      tm.user_id
    FROM public.tent_members tm
    JOIN public.tents t ON t.id = tm.tent_id
    WHERE tm.role = 'cadet'
  ),
  cadet_totals AS (
    SELECT
      hc.tent_house_id,
      COALESCE(SUM(public.get_user_denarii_total(hc.user_id)), 0)::bigint AS total_denarii,
      COUNT(DISTINCT hc.user_id)::integer AS cadet_count
    FROM house_cadets hc
    GROUP BY hc.tent_house_id
  ),
  sentry_lists AS (
    SELECT
      t.tent_house_id,
      ARRAY_AGG(DISTINCT p.display_name ORDER BY p.display_name) AS sentry_names
    FROM public.tent_members tm
    JOIN public.tents t ON t.id = tm.tent_id
    JOIN public.profiles p ON p.id = tm.user_id
    WHERE tm.role = 'sentry'
    GROUP BY t.tent_house_id
  ),
  standings AS (
    SELECT
      th.id AS tent_house_id,
      th.name AS tent_house_name,
      COALESCE(ct.total_denarii, 0)::bigint AS total_denarii,
      COALESCE(ct.cadet_count, 0)::integer AS cadet_count,
      COALESCE(sl.sentry_names, ARRAY[]::text[]) AS sentry_names
    FROM public.tent_houses th
    LEFT JOIN cadet_totals ct ON ct.tent_house_id = th.id
    LEFT JOIN sentry_lists sl ON sl.tent_house_id = th.id
  )
  SELECT
    standings.tent_house_id,
    standings.tent_house_name,
    standings.total_denarii,
    standings.cadet_count,
    standings.sentry_names,
    RANK() OVER (ORDER BY standings.total_denarii DESC, standings.tent_house_name ASC)::integer AS rank
  FROM standings
  ORDER BY total_denarii DESC, tent_house_name ASC;
$$;

GRANT EXECUTE ON FUNCTION public.get_tent_house_leaderboard() TO authenticated;

DROP FUNCTION IF EXISTS public.get_house_standings();
CREATE OR REPLACE FUNCTION public.get_house_standings()
RETURNS TABLE(
  tent_house_id text,
  house_name text,
  avg_streak numeric,
  avg_denarii numeric,
  member_count bigint,
  sentry_names text[],
  rank int
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH house_cadets AS (
    SELECT DISTINCT
      t.tent_house_id,
      tm.user_id
    FROM public.tent_members tm
    JOIN public.tents t ON t.id = tm.tent_id
    WHERE tm.role = 'cadet'
  ),
  streak_scores AS (
    SELECT
      hc.tent_house_id,
      AVG(COALESCE(s.current_streak, 0)) AS avg_streak
    FROM house_cadets hc
    LEFT JOIN LATERAL (
      SELECT COUNT(*)::numeric AS current_streak
      FROM public.daily_records dr
      WHERE dr.user_id = hc.user_id
        AND dr.streak_valid = true
    ) s ON true
    GROUP BY hc.tent_house_id
  ),
  denarii_scores AS (
    SELECT
      hc.tent_house_id,
      AVG(public.get_user_denarii_total(hc.user_id)) AS avg_denarii
    FROM house_cadets hc
    GROUP BY hc.tent_house_id
  ),
  sentry_lists AS (
    SELECT
      t.tent_house_id,
      ARRAY_AGG(DISTINCT p.display_name ORDER BY p.display_name) AS sentry_names
    FROM public.tent_members tm
    JOIN public.tents t ON t.id = tm.tent_id
    JOIN public.profiles p ON p.id = tm.user_id
    WHERE tm.role = 'sentry'
    GROUP BY t.tent_house_id
  ),
  combined AS (
    SELECT
      th.id AS tent_house_id,
      th.name AS house_name,
      COALESCE(ss.avg_streak, 0)::numeric AS avg_streak,
      COALESCE(ds.avg_denarii, 0)::numeric AS avg_denarii,
      COUNT(DISTINCT hc.user_id)::bigint AS member_count,
      COALESCE(sl.sentry_names, ARRAY[]::text[]) AS sentry_names
    FROM public.tent_houses th
    LEFT JOIN house_cadets hc ON hc.tent_house_id = th.id
    LEFT JOIN streak_scores ss ON ss.tent_house_id = th.id
    LEFT JOIN denarii_scores ds ON ds.tent_house_id = th.id
    LEFT JOIN sentry_lists sl ON sl.tent_house_id = th.id
    GROUP BY th.id, th.name, ss.avg_streak, ds.avg_denarii, sl.sentry_names
  )
  SELECT
    c.tent_house_id,
    c.house_name,
    c.avg_streak,
    c.avg_denarii,
    c.member_count,
    c.sentry_names,
    RANK() OVER (ORDER BY (c.avg_streak * 0.5 + c.avg_denarii / 1000 * 0.5) DESC, c.house_name ASC)::int AS rank
  FROM combined c
  ORDER BY rank ASC, house_name ASC;
$$;

GRANT EXECUTE ON FUNCTION public.get_house_standings() TO authenticated;
