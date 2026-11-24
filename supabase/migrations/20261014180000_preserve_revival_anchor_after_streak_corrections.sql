/* A correction to an old attendance or quiz row must not replay across a
   later recovery relic as if its restored streak were only one earned day. */
CREATE OR REPLACE FUNCTION public.reconcile_forward_streak_from_date(
  p_user_id uuid,
  p_record_date date
)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_today date := timezone('Africa/Douala', now())::date;
  v_state public.streak_forward_daily_states%ROWTYPE;
  v_later public.streak_forward_daily_states%ROWTYPE;
  v_anchor public.streak_manual_adjustments%ROWTYPE;
  v_opening integer := 0;
  v_current integer := 0;
  v_longest integer := 0;
  v_consecutive integer := 0;
  v_cumulative integer := 0;
  v_cumulative_delta integer := 0;
  v_requirement_met boolean := false;
  v_restored boolean := false;
  v_purchased boolean := false;
  v_protected boolean := false;
  v_has_saturday_quiz boolean := false;
  v_outcome text := 'neutral';
BEGIN
  IF p_user_id IS NULL OR p_record_date IS NULL OR p_record_date >= v_today THEN
    RETURN false;
  END IF;

  PERFORM 1
  FROM public.streak_forward_baselines baseline
  WHERE baseline.user_id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  SELECT state.*
  INTO v_state
  FROM public.streak_forward_daily_states state
  WHERE state.user_id = p_user_id
    AND state.record_date = p_record_date
    AND state.settled
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  SELECT coalesce(previous.consecutive_inactive, baseline.consecutive_inactive, 0)
  INTO v_consecutive
  FROM public.streak_forward_baselines baseline
  LEFT JOIN LATERAL (
    SELECT state.consecutive_inactive
    FROM public.streak_forward_daily_states state
    WHERE state.user_id = p_user_id
      AND state.record_date < p_record_date
      AND state.settled
    ORDER BY state.record_date DESC
    LIMIT 1
  ) previous ON true
  WHERE baseline.user_id = p_user_id;

  v_current := v_state.opening_streak;
  v_longest := greatest(v_state.longest_streak, v_current);
  v_requirement_met := public.streak_requirement_met(p_user_id, p_record_date);
  v_restored := public.streak_day_is_restored(p_user_id, p_record_date);
  v_purchased := public.streak_day_is_purchased(p_user_id, p_record_date);
  v_protected := public.streak_day_is_protected(p_user_id, p_record_date);
  v_has_saturday_quiz := extract(dow FROM p_record_date) = 6 AND EXISTS (
    SELECT 1
    FROM public.quiz_sessions session
    WHERE session.session_date = p_record_date
      AND session.quiz_type = 'saturday'
  );

  IF NOT v_requirement_met
    AND NOT v_restored
    AND NOT v_purchased
    AND NOT v_protected
    AND v_current > 0
    AND extract(dow FROM p_record_date) BETWEEN 1 AND 5
  THEN
    v_protected := public.activate_streak_freezer_for_date(p_user_id, p_record_date);
  END IF;

  IF v_requirement_met THEN
    v_outcome := 'earned';
    v_current := v_current + 1;
    v_consecutive := 0;
  ELSIF v_restored THEN
    v_outcome := 'restored';
    v_current := v_current + 1;
    v_consecutive := 0;
  ELSIF v_purchased THEN
    v_outcome := 'purchased';
    v_current := v_current + 1;
    v_consecutive := 0;
  ELSIF v_protected THEN
    v_outcome := 'frozen';
    v_consecutive := 0;
  ELSIF extract(dow FROM p_record_date) = 0
    OR (extract(dow FROM p_record_date) = 6 AND NOT v_has_saturday_quiz)
  THEN
    v_outcome := 'neutral';
  ELSE
    v_outcome := 'missed';
    v_current := 0;
    v_consecutive := v_consecutive + 1;
  END IF;

  v_cumulative_delta := CASE WHEN v_outcome = 'missed' THEN 1 ELSE 0 END
    - CASE WHEN v_state.outcome = 'missed' THEN 1 ELSE 0 END;
  v_cumulative := greatest(0, v_state.cumulative_inactive + v_cumulative_delta);
  v_longest := greatest(v_longest, v_current);

  UPDATE public.streak_forward_daily_states state
  SET current_streak = v_current,
      longest_streak = v_longest,
      consecutive_inactive = v_consecutive,
      cumulative_inactive = v_cumulative,
      outcome = v_outcome,
      requirement_met = v_requirement_met,
      purchased = v_purchased,
      restored = v_restored,
      protected = v_protected,
      evaluated_at = now()
  WHERE state.user_id = p_user_id
    AND state.record_date = p_record_date;

  FOR v_later IN
    SELECT state.*
    FROM public.streak_forward_daily_states state
    WHERE state.user_id = p_user_id
      AND state.record_date > p_record_date
      AND state.record_date < v_today
      AND state.settled
    ORDER BY state.record_date
    FOR UPDATE
  LOOP
    v_opening := v_current;
    IF v_later.outcome IN ('earned', 'purchased', 'restored') THEN
      v_current := v_current + 1;
      v_consecutive := 0;
    ELSIF v_later.outcome = 'missed' THEN
      v_current := 0;
      v_consecutive := v_consecutive + 1;
    ELSIF v_later.outcome = 'frozen' THEN
      v_consecutive := 0;
    END IF;

    v_longest := greatest(v_longest, v_later.longest_streak, v_current);
    v_cumulative := greatest(0, v_later.cumulative_inactive + v_cumulative_delta);

    UPDATE public.streak_forward_daily_states state
    SET opening_streak = v_opening,
        current_streak = v_current,
        longest_streak = v_longest,
        consecutive_inactive = v_consecutive,
        cumulative_inactive = v_cumulative,
        evaluated_at = now()
    WHERE state.user_id = p_user_id
      AND state.record_date = v_later.record_date;
  END LOOP;

  SELECT adjustment.* INTO v_anchor
  FROM public.streak_manual_adjustments adjustment
  JOIN public.streak_forward_baselines baseline
    ON baseline.user_id = adjustment.user_id
  WHERE adjustment.user_id = p_user_id
    AND adjustment.effective_date BETWEEN p_record_date AND v_today
    AND adjustment.effective_date > baseline.baseline_date
    AND (
      adjustment.reason ILIKE '%Redemption Coin%'
      OR adjustment.reason ILIKE '%Revival relic%'
      OR adjustment.reason ILIKE '%Thief''s Request%'
    );

  IF FOUND THEN
    /* Restore the explicit anchor, then replay stored outcomes after it.
       A genuine later missed day still resets the streak. */
    PERFORM public.rebase_forward_streak_from_manual_anchor(
      v_anchor.user_id,
      v_anchor.effective_date,
      v_anchor.current_streak,
      v_anchor.longest_streak
    );
  ELSE
    PERFORM public.refresh_user_streak_snapshot(p_user_id);
  END IF;
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.reconcile_forward_streak_from_date(uuid, date)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reconcile_forward_streak_from_date(uuid, date)
  TO service_role;

/* Restore recorded relic anchors already diminished by a previous replay.
   The rebase preserves every later stored outcome, including missed days. */
DO $$
DECLARE
  v_anchor record;
BEGIN
  FOR v_anchor IN
    SELECT adjustment.*
    FROM public.streak_manual_adjustments adjustment
    JOIN public.streak_forward_baselines baseline
      ON baseline.user_id = adjustment.user_id
    WHERE adjustment.effective_date > baseline.baseline_date
      AND adjustment.effective_date <= timezone('Africa/Douala', now())::date
      AND (
        adjustment.reason ILIKE '%Redemption Coin%'
        OR adjustment.reason ILIKE '%Revival relic%'
        OR adjustment.reason ILIKE '%Thief''s Request%'
      )
    ORDER BY adjustment.user_id
  LOOP
    PERFORM public.rebase_forward_streak_from_manual_anchor(
      v_anchor.user_id,
      v_anchor.effective_date,
      v_anchor.current_streak,
      v_anchor.longest_streak
    );
  END LOOP;
END;
$$;
