/* Keep public streak displays aligned with the user's verified live state.
   Only the current streak is exposed; private attendance and ledger data stay
   behind their existing policies. */

CREATE OR REPLACE FUNCTION public.get_public_quote_streak(p_user_id uuid)
RETURNS TABLE(current_streak integer)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  WITH clock AS (
    SELECT timezone('Africa/Douala', now())::date AS today
  ),
  authoritative AS (
    SELECT COALESCE(streak.current_streak, 0)::integer AS current_streak
    FROM public.get_authoritative_streak(p_user_id) streak
    LIMIT 1
  ),
  today_snapshot AS (
    SELECT COALESCE(snapshot.current_streak, 0)::integer AS current_streak
    FROM public.streakboard_snapshots snapshot
    CROSS JOIN clock
    WHERE snapshot.user_id = p_user_id
      AND snapshot.snapshot_date = clock.today
    ORDER BY snapshot.created_at DESC
    LIMIT 1
  ),
  today_record AS (
    SELECT CASE WHEN EXISTS (
      SELECT 1
      FROM public.daily_records record
      CROSS JOIN clock
      WHERE record.user_id = p_user_id
        AND record.record_date = clock.today
        AND COALESCE(record.streak_valid, false)
    ) THEN 1 ELSE 0 END::integer AS current_streak
  )
  SELECT GREATEST(
    COALESCE((SELECT current_streak FROM authoritative), 0),
    COALESCE((SELECT current_streak FROM today_snapshot), 0),
    COALESCE((SELECT current_streak FROM today_record), 0)
  )::integer;
$$;

REVOKE ALL ON FUNCTION public.get_public_quote_streak(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_public_quote_streak(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_public_streaks(p_user_ids uuid[])
RETURNS TABLE(user_id uuid, current_streak integer)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT requested.user_id, COALESCE(streak.current_streak, 0)::integer
  FROM unnest(COALESCE(p_user_ids, ARRAY[]::uuid[])) AS requested(user_id)
  LEFT JOIN LATERAL public.get_public_quote_streak(requested.user_id) streak ON true;
$$;

REVOKE ALL ON FUNCTION public.get_public_streaks(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_public_streaks(uuid[]) TO authenticated, service_role;
