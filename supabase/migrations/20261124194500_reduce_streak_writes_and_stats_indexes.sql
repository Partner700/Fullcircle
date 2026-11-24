-- No change to streak eligibility, values, manual restores, or protections.
-- Avoid rewriting identical days on every streak read.
CREATE OR REPLACE FUNCTION public.compute_strict_streak(p_user_id uuid)
 RETURNS TABLE(current_streak integer, longest_streak integer, consecutive_inactive integer, cumulative_inactive integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_today date := timezone('Africa/Douala', now())::date;
  v_local_time time := timezone('Africa/Douala', now())::time;
  v_anchor_date date;
  v_anchor_evaluated_at timestamptz;
  v_check date;
  v_current integer := 0;
  v_longest integer := 0;
  v_consecutive integer := 0;
  v_cumulative integer := 0;
  v_opening integer := 0;
  v_requirement_met boolean := false;
  v_restored boolean := false;
  v_purchased boolean := false;
  v_protected boolean := false;
  v_has_saturday_quiz boolean := false;
  v_deadline_passed boolean := false;
  v_outcome text := 'pending';
  v_settled boolean := false;
  v_baseline public.streak_forward_baselines%ROWTYPE;
  v_latest public.streak_forward_daily_states%ROWTYPE;
  v_existing public.streak_forward_daily_states%ROWTYPE;
  v_manual public.streak_manual_adjustments%ROWTYPE;
BEGIN
  IF p_user_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.profiles profile WHERE profile.id = p_user_id
  ) THEN
    RETURN QUERY SELECT 0, 0, 0, 0;
    RETURN;
  END IF;

  /* This row lock serializes evidence-trigger, board-read, and cron refreshes
     for one person without blocking the rest of the camp. */
  INSERT INTO public.streak_forward_baselines (
    user_id,
    baseline_date,
    current_streak,
    longest_streak,
    consecutive_inactive,
    cumulative_inactive
  ) VALUES (p_user_id, v_today - 1, 0, 0, 0, 0)
  ON CONFLICT (user_id) DO NOTHING;

  SELECT baseline.*
  INTO v_baseline
  FROM public.streak_forward_baselines baseline
  WHERE baseline.user_id = p_user_id
  FOR UPDATE;

  v_anchor_date := v_baseline.baseline_date;
  v_anchor_evaluated_at := v_baseline.captured_at;
  v_current := v_baseline.current_streak;
  v_longest := greatest(v_baseline.longest_streak, v_current);
  v_consecutive := v_baseline.consecutive_inactive;
  v_cumulative := v_baseline.cumulative_inactive;

  /* A settled forward state is immutable. It is the only ordinary source for
     tomorrow's opening value; pre-cutover records are never replayed. */
  SELECT state.*
  INTO v_latest
  FROM public.streak_forward_daily_states state
  WHERE state.user_id = p_user_id
    AND state.record_date > v_baseline.baseline_date
    AND state.record_date < v_today
    AND state.settled
  ORDER BY state.record_date DESC
  LIMIT 1;

  IF FOUND THEN
    v_anchor_date := v_latest.record_date;
    v_anchor_evaluated_at := v_latest.evaluated_at;
    v_current := v_latest.current_streak;
    v_longest := greatest(v_longest, v_latest.longest_streak, v_current);
    v_consecutive := v_latest.consecutive_inactive;
    v_cumulative := v_latest.cumulative_inactive;
  END IF;

  /* Reviewed restorations and recovery relics deliberately establish a new
     value. Old manual repairs before the cutover baseline are ignored. */
  SELECT adjustment.*
  INTO v_manual
  FROM public.streak_manual_adjustments adjustment
  WHERE adjustment.user_id = p_user_id
    AND adjustment.effective_date <= v_today
    AND (
      adjustment.effective_date > v_anchor_date
      OR adjustment.created_at > v_anchor_evaluated_at
    )
  ORDER BY adjustment.effective_date DESC, adjustment.created_at DESC
  LIMIT 1;

  IF FOUND THEN
    IF v_manual.effective_date > v_anchor_date THEN
      v_anchor_date := v_manual.effective_date;
    END IF;
    v_anchor_evaluated_at := greatest(v_anchor_evaluated_at, v_manual.created_at);
    v_current := greatest(v_current, v_manual.current_streak, 0);
    v_longest := greatest(v_longest, v_manual.longest_streak, v_current);
    v_consecutive := 0;
  END IF;

  v_check := v_anchor_date + 1;
  WHILE v_check <= v_today LOOP
    /* Once a former day has settled, later edits to old attendance or quiz
       rows cannot rewrite the current streak. Explicit restoration remains
       available through the reviewed/manual path above. */
    IF v_check < v_today THEN
      SELECT state.*
      INTO v_existing
      FROM public.streak_forward_daily_states state
      WHERE state.user_id = p_user_id
        AND state.record_date = v_check
        AND state.settled;

      IF FOUND THEN
        v_current := v_existing.current_streak;
        v_longest := greatest(v_longest, v_existing.longest_streak, v_current);
        v_consecutive := v_existing.consecutive_inactive;
        v_cumulative := v_existing.cumulative_inactive;
        v_check := v_check + 1;
        CONTINUE;
      END IF;
    END IF;

    v_opening := v_current;
    v_requirement_met := public.streak_requirement_met(p_user_id, v_check);
    v_restored := public.streak_day_is_restored(p_user_id, v_check);
    v_purchased := public.streak_day_is_purchased(p_user_id, v_check);
    v_protected := public.streak_day_is_protected(p_user_id, v_check);
    v_deadline_passed := v_check < v_today
      OR (v_check = v_today AND v_local_time >= time '21:00');
    v_has_saturday_quiz := extract(dow FROM v_check) = 6 AND EXISTS (
      SELECT 1
      FROM public.quiz_sessions session
      WHERE session.session_date = v_check
        AND session.quiz_type = 'saturday'
    );
    v_settled := false;

    IF v_requirement_met THEN
      v_outcome := 'earned';
      v_current := v_opening + 1;
      v_longest := greatest(v_longest, v_current);
      v_consecutive := 0;
      v_settled := true;
    ELSIF v_restored THEN
      v_outcome := 'restored';
      v_current := v_opening + 1;
      v_longest := greatest(v_longest, v_current);
      v_consecutive := 0;
      v_settled := true;
    ELSIF v_purchased THEN
      v_outcome := 'purchased';
      v_current := v_opening + 1;
      v_longest := greatest(v_longest, v_current);
      v_consecutive := 0;
      v_settled := true;
    ELSE
      /* A freezer is consumed only when the 21:00 deadline actually passes.
         Before then, the active streak remains pending and can still be
         earned normally. */
      IF v_deadline_passed
        AND NOT v_protected
        AND v_opening > 0
        AND extract(dow FROM v_check) BETWEEN 1 AND 5
      THEN
        v_protected := public.activate_streak_freezer_for_date(p_user_id, v_check);
      END IF;

      IF v_deadline_passed AND v_protected THEN
        v_outcome := 'frozen';
        v_current := v_opening;
        v_consecutive := 0;
        v_settled := true;
      ELSIF NOT v_deadline_passed THEN
        v_outcome := 'pending';
        v_current := v_opening;
        v_settled := false;
      ELSIF extract(dow FROM v_check) = 0 THEN
        /* Sunday reading is an optional bonus. Not opening it is neutral. */
        v_outcome := 'neutral';
        v_current := v_opening;
        v_settled := true;
      ELSIF extract(dow FROM v_check) = 6 AND NOT v_has_saturday_quiz THEN
        /* A Saturday without a released weekly quiz cannot break a streak. */
        v_outcome := 'neutral';
        v_current := v_opening;
        v_settled := true;
      ELSE
        v_outcome := 'missed';
        v_current := 0;
        v_consecutive := v_consecutive + 1;
        v_cumulative := v_cumulative + 1;
        v_settled := true;
      END IF;
    END IF;

    INSERT INTO public.streak_forward_daily_states AS state (
      user_id,
      record_date,
      opening_streak,
      current_streak,
      longest_streak,
      consecutive_inactive,
      cumulative_inactive,
      outcome,
      requirement_met,
      purchased,
      restored,
      protected,
      settled,
      evaluated_at
    ) VALUES (
      p_user_id,
      v_check,
      v_opening,
      v_current,
      v_longest,
      v_consecutive,
      v_cumulative,
      v_outcome,
      v_requirement_met,
      v_purchased,
      v_restored,
      v_protected AND v_deadline_passed,
      v_settled,
      now()
    )
    ON CONFLICT (user_id, record_date) DO UPDATE
    SET opening_streak = EXCLUDED.opening_streak,
        current_streak = EXCLUDED.current_streak,
        longest_streak = EXCLUDED.longest_streak,
        consecutive_inactive = EXCLUDED.consecutive_inactive,
        cumulative_inactive = EXCLUDED.cumulative_inactive,
        outcome = EXCLUDED.outcome,
        requirement_met = EXCLUDED.requirement_met,
        purchased = EXCLUDED.purchased,
        restored = EXCLUDED.restored,
        protected = EXCLUDED.protected,
        settled = EXCLUDED.settled,
        evaluated_at = now()
    WHERE (state.opening_streak, state.current_streak, state.longest_streak,
           state.consecutive_inactive, state.cumulative_inactive, state.outcome,
           state.requirement_met, state.purchased, state.restored, state.protected, state.settled)
      IS DISTINCT FROM
          (EXCLUDED.opening_streak, EXCLUDED.current_streak, EXCLUDED.longest_streak,
           EXCLUDED.consecutive_inactive, EXCLUDED.cumulative_inactive, EXCLUDED.outcome,
           EXCLUDED.requirement_met, EXCLUDED.purchased, EXCLUDED.restored, EXCLUDED.protected, EXCLUDED.settled);

    v_check := v_check + 1;
  END LOOP;

  RETURN QUERY SELECT v_current, v_longest, v_consecutive, v_cumulative;
END;
$function$
;

-- Accelerate lifetime marks and Arena stats without touching any game scores.
CREATE INDEX IF NOT EXISTS arena_rooms_completed_winner_idx
  ON public.arena_rooms(winner_id)
  WHERE status='completed' AND winner_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS arena_participants_player_history_idx
  ON public.arena_participants(user_id, finished_at)
  WHERE finished_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS game_attempts_completed_user_idx
  ON public.game_attempts(user_id, completed_at)
  WHERE completed_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS quiz_attempts_user_submission_idx
  ON public.quiz_attempts(user_id, submitted_at)
  WHERE status IN ('submitted','timed_out');
