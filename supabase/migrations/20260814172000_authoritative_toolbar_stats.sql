/*
  Small, dependable source for the counters shown in the signed-in user's
  toolbar. Keeping this independent of boards prevents an unrelated board
  query from blanking the user's Denarii or streak.
*/

CREATE OR REPLACE FUNCTION public.get_my_toolbar_stats()
RETURNS TABLE (
  user_id uuid,
  total_denarii bigint,
  current_streak integer,
  longest_streak integer,
  consecutive_inactive integer,
  cumulative_inactive integer
)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT
    caller.user_id,
    COALESCE(public.get_user_denarii_total(caller.user_id), 0)::bigint AS total_denarii,
    COALESCE(strict.current_streak, 0)::integer AS current_streak,
    COALESCE(strict.longest_streak, 0)::integer AS longest_streak,
    COALESCE(strict.consecutive_inactive, 0)::integer AS consecutive_inactive,
    COALESCE(strict.cumulative_inactive, 0)::integer AS cumulative_inactive
  FROM (SELECT auth.uid() AS user_id) caller
  LEFT JOIN LATERAL public.compute_strict_streak(caller.user_id) strict ON true
  WHERE caller.user_id IS NOT NULL
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.get_my_toolbar_stats() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_toolbar_stats() TO authenticated, service_role;
