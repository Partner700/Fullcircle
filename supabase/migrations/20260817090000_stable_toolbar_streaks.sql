/*
  Keep the toolbar authoritative while surviving a transient zero from the
  streak calculator. A zero is accepted when the calculator reports a real
  inactive day. Otherwise, a recent confirmed snapshot remains visible until
  the next successful calculation replaces it.
*/

CREATE OR REPLACE FUNCTION public.get_my_toolbar_stats_v3()
RETURNS TABLE (
  user_id uuid,
  total_denarii bigint,
  current_streak integer,
  longest_streak integer,
  consecutive_inactive integer,
  cumulative_inactive integer
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required.';
  END IF;

  RETURN QUERY
  WITH strict AS (
    SELECT * FROM public.compute_strict_streak(v_user_id) LIMIT 1
  ),
  latest_snapshot AS (
    SELECT snapshot.current_streak, snapshot.longest_streak
    FROM public.streakboard_snapshots snapshot
    WHERE snapshot.user_id = v_user_id
      AND snapshot.snapshot_date >= timezone('Africa/Douala', now())::date - 7
    ORDER BY snapshot.snapshot_date DESC, snapshot.created_at DESC
    LIMIT 1
  )
  SELECT
    v_user_id,
    public.get_user_denarii_total(v_user_id)::bigint,
    CASE
      WHEN COALESCE(strict.current_streak, 0) = 0
        AND COALESCE(strict.consecutive_inactive, 0) = 0
      THEN GREATEST(COALESCE(strict.current_streak, 0), COALESCE(latest_snapshot.current_streak, 0))
      ELSE COALESCE(strict.current_streak, 0)
    END::integer,
    GREATEST(COALESCE(strict.longest_streak, 0), COALESCE(latest_snapshot.longest_streak, 0))::integer,
    COALESCE(strict.consecutive_inactive, 0)::integer,
    COALESCE(strict.cumulative_inactive, 0)::integer
  FROM strict
  LEFT JOIN latest_snapshot ON true
  LIMIT 1;
END;
$$;

REVOKE ALL ON FUNCTION public.get_my_toolbar_stats_v3() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_toolbar_stats_v3() TO authenticated, service_role;
