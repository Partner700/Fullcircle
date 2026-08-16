/*
  A versioned, lightweight toolbar endpoint. The legacy function name was
  replaced by several historical migrations, so clients use this stable RPC
  first and retain the old endpoint only for rollout compatibility.
*/

CREATE OR REPLACE FUNCTION public.get_my_toolbar_stats_v2()
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
  SELECT
    v_user_id,
    COALESCE((
      SELECT sum(entry.amount)::bigint
      FROM public.denarii_ledger_entries entry
      WHERE entry.user_id = v_user_id
    ), 0)::bigint,
    COALESCE(strict.current_streak, 0)::integer,
    COALESCE(strict.longest_streak, 0)::integer,
    COALESCE(strict.consecutive_inactive, 0)::integer,
    COALESCE(strict.cumulative_inactive, 0)::integer
  FROM (VALUES (1)) seed(value)
  LEFT JOIN LATERAL public.compute_strict_streak(v_user_id) strict ON true
  LIMIT 1;
END;
$$;

REVOKE ALL ON FUNCTION public.get_my_toolbar_stats_v2() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_toolbar_stats_v2() TO authenticated, service_role;
