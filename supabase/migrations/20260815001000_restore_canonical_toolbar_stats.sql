/*
  Restore the final streak calculator after an older relic migration replaced
  it, and keep the signed-in user's toolbar independent of board queries.
*/

CREATE OR REPLACE FUNCTION public.compute_strict_streak(p_user_id uuid)
RETURNS TABLE(
  current_streak integer,
  longest_streak integer,
  consecutive_inactive integer,
  cumulative_inactive integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_today date := timezone('Africa/Douala', now())::date;
  v_local_time time := timezone('Africa/Douala', now())::time;
  v_start date;
  v_check date;
  v_complete boolean;
  v_has_quiz boolean;
  v_has_simons_day boolean;
  v_current integer := 0;
  v_longest integer := 0;
  v_consecutive integer := 0;
  v_cumulative integer := 0;
BEGIN
  SELECT LEAST(
    COALESCE((profile.created_at AT TIME ZONE 'Africa/Douala')::date, v_today),
    COALESCE((
      SELECT min(record.record_date)
      FROM public.daily_records record
      WHERE record.user_id = p_user_id
    ), v_today)
  )
  INTO v_start
  FROM public.profiles profile
  WHERE profile.id = p_user_id;

  IF v_start IS NULL THEN
    RETURN QUERY SELECT 0, 0, 0, 0;
    RETURN;
  END IF;

  v_check := v_start;
  WHILE v_check <= v_today LOOP
    -- Sundays before the reading-open rule existed are neutral.
    IF extract(dow FROM v_check) = 0 AND v_check < date '2026-08-02' THEN
      v_check := v_check + 1;
      CONTINUE;
    END IF;

    -- A Saturday without a released quiz cannot count against anyone.
    IF extract(dow FROM v_check) = 6 THEN
      SELECT EXISTS (
        SELECT 1
        FROM public.quiz_sessions session
        WHERE session.session_date = v_check
          AND session.quiz_type = 'saturday'
      ) INTO v_has_quiz;
      IF NOT v_has_quiz THEN
        v_check := v_check + 1;
        CONTINUE;
      END IF;
    END IF;

    -- This function preserves earned pre-10-August days and applies the
    -- current attendance, meditation, quiz, and Sunday-reading rules.
    v_complete := public.streak_requirement_met(p_user_id, v_check);

    SELECT EXISTS (
      SELECT 1
      FROM public.streak_freezers simons_day
      WHERE simons_day.user_id = p_user_id
        AND simons_day.source = 'simons_purse'
        AND simons_day.used_at IS NULL
        AND simons_day.applied_to_date = v_check
        AND (simons_day.expires_at IS NULL OR simons_day.expires_at::date >= v_check)
    ) INTO v_has_simons_day;

    -- Today's incomplete requirements remain neutral until the 9 PM cutoff.
    -- Simon's Purse is already a completed weekday and counts immediately.
    IF v_check = v_today
      AND NOT v_complete
      AND v_local_time < time '21:00'
      AND NOT v_has_simons_day THEN
      v_check := v_check + 1;
      CONTINUE;
    END IF;

    IF NOT v_complete
      AND extract(dow FROM v_check) <> 0
      AND (
        v_current > 0
        OR EXISTS (
          SELECT 1
          FROM public.streak_freezers redemption
          WHERE redemption.user_id = p_user_id
            AND redemption.source = 'redemption'
            AND redemption.used_at IS NULL
            AND redemption.applied_to_date = v_check
        )
      )
    THEN
      SELECT EXISTS (
        SELECT 1
        FROM public.streak_freezers protection
        WHERE protection.user_id = p_user_id
          AND protection.used_at IS NULL
          AND protection.applied_to_date = v_check
          AND (protection.expires_at IS NULL OR protection.expires_at::date >= v_check)
          AND (
            extract(dow FROM v_check) BETWEEN 1 AND 5
            OR (
              extract(dow FROM v_check) = 6
              AND protection.freezer_type = 'weekly'
              AND protection.source IN ('relic', 'redemption')
            )
          )
      ) INTO v_complete;
    END IF;

    IF v_complete OR v_has_simons_day THEN
      v_current := v_current + 1;
      v_longest := greatest(v_longest, v_current);
      v_consecutive := 0;
    ELSE
      v_current := 0;
      v_consecutive := v_consecutive + 1;
      v_cumulative := v_cumulative + 1;
    END IF;

    v_check := v_check + 1;
  END LOOP;

  RETURN QUERY SELECT v_current, v_longest, v_consecutive, v_cumulative;
END;
$$;

REVOKE ALL ON FUNCTION public.compute_strict_streak(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.compute_strict_streak(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_my_toolbar_stats()
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
  FROM public.compute_strict_streak(v_user_id) strict
  LIMIT 1;
END;
$$;

REVOKE ALL ON FUNCTION public.get_my_toolbar_stats() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_toolbar_stats() TO authenticated, service_role;
