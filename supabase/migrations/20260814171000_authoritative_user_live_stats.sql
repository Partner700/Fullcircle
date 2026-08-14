/*
# Authoritative user live stats

Provides one SECURITY DEFINER read for the visible counters that must never
quietly fall back to zero because of client-side RLS limitations.
*/

CREATE OR REPLACE FUNCTION public.get_user_live_stats(p_user_id uuid DEFAULT NULL)
RETURNS TABLE (
  user_id uuid,
  total_denarii bigint,
  current_streak integer,
  longest_streak integer,
  consecutive_inactive integer,
  cumulative_inactive integer,
  total_figs numeric,
  rhudes bigint,
  marks numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_target uuid := COALESCE(p_user_id, auth.uid());
BEGIN
  IF v_target IS NULL THEN
    RAISE EXCEPTION 'A signed-in user is required.';
  END IF;

  IF auth.role() IS DISTINCT FROM 'service_role'
    AND v_caller IS DISTINCT FROM v_target
    AND NOT public.is_instructor(v_caller)
    AND NOT EXISTS (
      SELECT 1
      FROM public.tents tent
      WHERE tent.sentry_id = v_caller
        AND EXISTS (
          SELECT 1
          FROM public.tent_members member
          WHERE member.tent_id = tent.id
            AND member.user_id = v_target
        )
    ) THEN
    RAISE EXCEPTION 'You cannot view these stats.';
  END IF;

  RETURN QUERY
  WITH requested AS (
    SELECT v_target AS user_id
  ),
  strict AS (
    SELECT *
    FROM public.compute_strict_streak(v_target)
    LIMIT 1
  ),
  board AS (
    SELECT *
    FROM public.get_marks_board_live()
    WHERE get_marks_board_live.user_id = v_target
    LIMIT 1
  )
  SELECT
    requested.user_id AS user_id,
    COALESCE(board.total_denarii, public.get_user_denarii_total(v_target), 0)::bigint AS total_denarii,
    COALESCE(strict.current_streak, board.current_streak, 0)::integer AS current_streak,
    COALESCE(strict.longest_streak, 0)::integer AS longest_streak,
    COALESCE(strict.consecutive_inactive, 0)::integer AS consecutive_inactive,
    COALESCE(strict.cumulative_inactive, 0)::integer AS cumulative_inactive,
    COALESCE(board.total_figs, 0)::numeric AS total_figs,
    COALESCE(board.rhudes, 0)::bigint AS rhudes,
    COALESCE(board.marks, 0)::numeric AS marks
  FROM requested
  LEFT JOIN strict ON true
  LEFT JOIN board ON true;
END;
$$;

REVOKE ALL ON FUNCTION public.get_user_live_stats(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_user_live_stats(uuid) TO authenticated, service_role;
