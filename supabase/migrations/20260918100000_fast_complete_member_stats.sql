-- A member's toolbar must not calculate every resident's marks and streak.
-- Keep the canonical lifetime achievement formula and existing access rules.
CREATE OR REPLACE FUNCTION public.get_user_live_stats(p_user_id uuid DEFAULT NULL)
RETURNS TABLE (
  user_id uuid, total_denarii bigint, current_streak integer,
  longest_streak integer, consecutive_inactive integer,
  cumulative_inactive integer, total_figs numeric, rhudes bigint, marks numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
VOLATILE
SET search_path = public
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_target uuid := COALESCE(p_user_id, auth.uid());
  v_streak record;
  v_denarii bigint;
  v_figs numeric;
  v_rhudes bigint;
  v_marks numeric;
BEGIN
  IF v_target IS NULL THEN RAISE EXCEPTION 'A signed-in user is required.'; END IF;
  IF auth.role() IS DISTINCT FROM 'service_role'
    AND v_caller IS DISTINCT FROM v_target
    AND NOT public.is_instructor(v_caller)
    AND NOT EXISTS (
      SELECT 1 FROM public.tents tent
      JOIN public.tent_members member ON member.tent_id = tent.id
      WHERE tent.sentry_id = v_caller AND member.user_id = v_target
    ) THEN
    RAISE EXCEPTION 'You cannot view these stats.';
  END IF;

  SELECT * INTO STRICT v_streak FROM public.get_authoritative_streak(v_target) LIMIT 1;
  SELECT COALESCE(sum(entry.amount), 0)::bigint INTO v_denarii
    FROM public.denarii_ledger_entries entry WHERE entry.user_id = v_target;
  v_figs := public.get_user_lifetime_figs(v_target, NULL);
  SELECT count(*)::bigint INTO v_rhudes FROM public.arena_rooms room
    WHERE room.winner_id = v_target AND room.status = 'completed';
  v_marks := public.calculate_normalized_marks(
    public.get_lifetime_qualifying_streak_days(v_target, NULL),
    public.get_qualifying_denarii_total(v_target, NULL), v_rhudes, v_figs
  );

  RETURN QUERY SELECT v_target, v_denarii, v_streak.current_streak::integer,
    v_streak.longest_streak::integer, v_streak.consecutive_inactive::integer,
    v_streak.cumulative_inactive::integer, v_figs, v_rhudes, v_marks;
END;
$$;

REVOKE ALL ON FUNCTION public.get_user_live_stats(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_user_live_stats(uuid) TO authenticated, service_role;
