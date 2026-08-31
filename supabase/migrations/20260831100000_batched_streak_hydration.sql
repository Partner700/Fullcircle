-- Return the complete authoritative streak state for a visible set of members
-- in one network round trip. The existing lifecycle remains authoritative.
CREATE OR REPLACE FUNCTION public.get_public_streak_details(p_user_ids uuid[])
RETURNS TABLE(
  user_id uuid,
  current_streak integer,
  longest_streak integer,
  consecutive_inactive integer,
  cumulative_inactive integer
)
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    requested.user_id,
    coalesce(streak.current_streak, 0)::integer,
    coalesce(streak.longest_streak, 0)::integer,
    coalesce(streak.consecutive_inactive, 0)::integer,
    coalesce(streak.cumulative_inactive, 0)::integer
  FROM unnest(coalesce(p_user_ids, ARRAY[]::uuid[])) AS requested(user_id)
  LEFT JOIN LATERAL public.get_authoritative_streak(requested.user_id) streak ON true;
$$;

REVOKE ALL ON FUNCTION public.get_public_streak_details(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_public_streak_details(uuid[])
  TO authenticated, service_role;
