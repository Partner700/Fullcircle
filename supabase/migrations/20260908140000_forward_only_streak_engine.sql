/*
  Start a forward-only streak lifecycle.

  The previous calculator replayed mutable attendance, quiz, freezer, and
  manual-repair history whenever a streak was read. A correction to an old row
  could therefore change today's board even though nothing happened today.

  This migration captures every member's current streak as the opening value
  immediately before the deployment day, then records one explicit outcome
  per day from that point onward. Settled prior days are never recalculated.
  Only the active day's evidence can change the active day's result.
*/

CREATE TABLE IF NOT EXISTS public.streak_forward_baselines (
  user_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  baseline_date date NOT NULL,
  current_streak integer NOT NULL DEFAULT 0 CHECK (current_streak >= 0),
  longest_streak integer NOT NULL DEFAULT 0 CHECK (longest_streak >= 0),
  consecutive_inactive integer NOT NULL DEFAULT 0 CHECK (consecutive_inactive >= 0),
  cumulative_inactive integer NOT NULL DEFAULT 0 CHECK (cumulative_inactive >= 0),
  captured_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.streak_forward_daily_states (
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  record_date date NOT NULL,
  opening_streak integer NOT NULL CHECK (opening_streak >= 0),
  current_streak integer NOT NULL CHECK (current_streak >= 0),
  longest_streak integer NOT NULL CHECK (longest_streak >= 0),
  consecutive_inactive integer NOT NULL DEFAULT 0 CHECK (consecutive_inactive >= 0),
  cumulative_inactive integer NOT NULL DEFAULT 0 CHECK (cumulative_inactive >= 0),
  outcome text NOT NULL CHECK (outcome IN (
    'pending', 'earned', 'purchased', 'restored', 'frozen', 'missed', 'neutral'
  )),
  requirement_met boolean NOT NULL DEFAULT false,
  purchased boolean NOT NULL DEFAULT false,
  restored boolean NOT NULL DEFAULT false,
  protected boolean NOT NULL DEFAULT false,
  settled boolean NOT NULL DEFAULT false,
  evaluated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, record_date)
);

CREATE INDEX IF NOT EXISTS streak_forward_daily_states_date_idx
  ON public.streak_forward_daily_states(record_date, current_streak DESC, user_id);

ALTER TABLE public.streak_forward_baselines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.streak_forward_daily_states ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.streak_forward_baselines
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.streak_forward_daily_states
  FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.streak_forward_baselines TO service_role;
GRANT ALL ON TABLE public.streak_forward_daily_states TO service_role;

/* Capture yesterday's last published value before compute_strict_streak is
   replaced. This is the clean cutover: mutable records from earlier dates no
   longer get another chance to rewrite today's opening streak. A user without
   a prior snapshot falls back to the live value minus any credit earned today. */
WITH clock AS (
  SELECT timezone('Africa/Douala', now())::date AS today
), live AS MATERIALIZED (
  SELECT
    profile.id AS user_id,
    clock.today,
    coalesce(streak.current_streak, 0)::integer AS visible_current,
    coalesce(streak.longest_streak, 0)::integer AS visible_longest,
    coalesce(streak.consecutive_inactive, 0)::integer AS visible_consecutive,
    coalesce(streak.cumulative_inactive, 0)::integer AS visible_cumulative,
    (
      public.streak_requirement_met(profile.id, clock.today)
      OR public.streak_day_is_restored(profile.id, clock.today)
      OR public.streak_day_is_purchased(profile.id, clock.today)
    ) AS credited_today
  FROM public.profiles profile
  CROSS JOIN clock
  LEFT JOIN LATERAL public.get_authoritative_streak(profile.id) streak ON true
), prior_snapshot AS (
  SELECT DISTINCT ON (snapshot.user_id)
    snapshot.user_id,
    snapshot.snapshot_date,
    snapshot.current_streak::integer AS current_streak,
    greatest(snapshot.longest_streak, snapshot.current_streak)::integer AS longest_streak
  FROM public.streakboard_snapshots snapshot
  CROSS JOIN clock
  WHERE snapshot.snapshot_date < clock.today
  ORDER BY
    snapshot.user_id,
    snapshot.snapshot_date DESC,
    snapshot.created_at DESC NULLS LAST,
    snapshot.id DESC
), prior_manual AS (
  SELECT
    adjustment.user_id,
    adjustment.effective_date,
    adjustment.current_streak::integer AS current_streak,
    greatest(adjustment.longest_streak, adjustment.current_streak)::integer AS longest_streak
  FROM public.streak_manual_adjustments adjustment
  CROSS JOIN clock
  WHERE adjustment.effective_date < clock.today
), opening AS (
  SELECT
    live.*,
    CASE
      WHEN prior_snapshot.user_id IS NOT NULL OR prior_manual.user_id IS NOT NULL
        THEN greatest(
          coalesce(prior_snapshot.current_streak, 0),
          CASE
            WHEN prior_snapshot.user_id IS NULL
              OR prior_manual.effective_date >= prior_snapshot.snapshot_date
              THEN coalesce(prior_manual.current_streak, 0)
            ELSE 0
          END
        )
      ELSE greatest(
        live.visible_current - CASE
          WHEN live.credited_today AND live.visible_current > 0 THEN 1
          ELSE 0
        END,
        0
      )
    END::integer AS opening_current,
    greatest(
      live.visible_longest,
      coalesce(prior_snapshot.longest_streak, 0),
      coalesce(prior_manual.longest_streak, 0)
    )::integer AS opening_longest
  FROM live
  LEFT JOIN prior_snapshot ON prior_snapshot.user_id = live.user_id
  LEFT JOIN prior_manual ON prior_manual.user_id = live.user_id
)
INSERT INTO public.streak_forward_baselines (
  user_id,
  baseline_date,
  current_streak,
  longest_streak,
  consecutive_inactive,
  cumulative_inactive,
  captured_at
)
SELECT
  opening.user_id,
  opening.today - 1,
  opening.opening_current,
  greatest(opening.opening_longest, opening.opening_current),
  opening.visible_consecutive,
  opening.visible_cumulative,
  now()
FROM opening
ON CONFLICT (user_id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.compute_strict_streak(p_user_id uuid)
RETURNS TABLE(
  current_streak integer,
  longest_streak integer,
  consecutive_inactive integer,
  cumulative_inactive integer
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
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
        evaluated_at = now();

    v_check := v_check + 1;
  END LOOP;

  RETURN QUERY SELECT v_current, v_longest, v_consecutive, v_cumulative;
END;
$$;

REVOKE ALL ON FUNCTION public.compute_strict_streak(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.compute_strict_streak(uuid)
  TO authenticated, service_role;

/* A new authorized correction may amend a settled day, but merely reading the
   board never does. Rebuild from the stored outcomes after that one corrected
   date instead of replaying mutable historical attendance. */
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

  /* Serialize an explicit correction with ordinary streak reads for this user. */
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

  /* If a correction reveals that the requirements were not actually met,
     honor a freezer that was already owned at that day's deadline. */
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

  PERFORM public.refresh_user_streak_snapshot(p_user_id);
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.reconcile_forward_streak_from_date(uuid, date)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reconcile_forward_streak_from_date(uuid, date)
  TO service_role;

CREATE OR REPLACE FUNCTION public.reconcile_forward_streak_after_daily_correction()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.record_date < timezone('Africa/Douala', now())::date THEN
    PERFORM public.reconcile_forward_streak_from_date(NEW.user_id, NEW.record_date);

    IF NEW.attendance_marked_by IS NOT NULL
      AND NEW.attendance_marked_by IS DISTINCT FROM NEW.user_id
    THEN
      PERFORM public.reconcile_forward_streak_from_date(
        NEW.attendance_marked_by,
        NEW.record_date
      );
    END IF;

    IF TG_OP = 'UPDATE'
      AND OLD.attendance_marked_by IS NOT NULL
      AND OLD.attendance_marked_by IS DISTINCT FROM NEW.attendance_marked_by
      AND OLD.attendance_marked_by IS DISTINCT FROM OLD.user_id
    THEN
      PERFORM public.reconcile_forward_streak_from_date(
        OLD.attendance_marked_by,
        OLD.record_date
      );
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS reconcile_forward_streak_after_daily_correction
  ON public.daily_records;
CREATE TRIGGER reconcile_forward_streak_after_daily_correction
AFTER UPDATE OF
  attendance_status,
  attendance_marked_at,
  attendance_marked_by,
  meditation_submitted,
  meditation_submitted_at,
  sunday_reading_opened_at
ON public.daily_records
FOR EACH ROW
WHEN (
  OLD.attendance_status IS DISTINCT FROM NEW.attendance_status
  OR OLD.attendance_marked_at IS DISTINCT FROM NEW.attendance_marked_at
  OR OLD.attendance_marked_by IS DISTINCT FROM NEW.attendance_marked_by
  OR OLD.meditation_submitted IS DISTINCT FROM NEW.meditation_submitted
  OR OLD.meditation_submitted_at IS DISTINCT FROM NEW.meditation_submitted_at
  OR OLD.sunday_reading_opened_at IS DISTINCT FROM NEW.sunday_reading_opened_at
)
EXECUTE FUNCTION public.reconcile_forward_streak_after_daily_correction();

DROP TRIGGER IF EXISTS reconcile_forward_streak_after_daily_insert
  ON public.daily_records;
CREATE TRIGGER reconcile_forward_streak_after_daily_insert
AFTER INSERT ON public.daily_records
FOR EACH ROW
EXECUTE FUNCTION public.reconcile_forward_streak_after_daily_correction();

CREATE OR REPLACE FUNCTION public.reconcile_forward_streak_after_quiz_correction()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_session_date date;
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.status IS NOT DISTINCT FROM NEW.status THEN
    RETURN NEW;
  END IF;

  SELECT session.session_date
  INTO v_session_date
  FROM public.quiz_sessions session
  WHERE session.id = NEW.quiz_session_id;

  IF v_session_date < timezone('Africa/Douala', now())::date THEN
    PERFORM public.reconcile_forward_streak_from_date(NEW.user_id, v_session_date);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS reconcile_forward_streak_after_quiz_correction
  ON public.quiz_attempts;
CREATE TRIGGER reconcile_forward_streak_after_quiz_correction
AFTER UPDATE OF status ON public.quiz_attempts
FOR EACH ROW
EXECUTE FUNCTION public.reconcile_forward_streak_after_quiz_correction();

DROP TRIGGER IF EXISTS reconcile_forward_streak_after_quiz_insert
  ON public.quiz_attempts;
CREATE TRIGGER reconcile_forward_streak_after_quiz_insert
AFTER INSERT ON public.quiz_attempts
FOR EACH ROW
EXECUTE FUNCTION public.reconcile_forward_streak_after_quiz_correction();

/* Thief's Request is an explicit recovery, so it is allowed to establish a
   new forward anchor. Its historical restoration rows remain the audit trail,
   while the manual anchor prevents settled forward days from being replayed. */
CREATE OR REPLACE FUNCTION public.complete_thiefs_request_after_use()
RETURNS trigger
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_slug text;
  v_cutoff date;
  v_join_date date;
  v_restored integer := 0;
  v_live_current integer := 0;
  v_live_longest integer := 0;
  v_recovered_current integer := 0;
BEGIN
  SELECT relic.slug
  INTO v_slug
  FROM public.relic_types relic
  WHERE relic.id = NEW.relic_type_id;

  IF coalesce(v_slug, '') <> 'thieves-request'
    AND coalesce(NEW.effect_applied, '') NOT ILIKE '%revive_lost_streak%'
    AND coalesce(NEW.effect_applied, '') NOT ILIKE '%resurrect_lost_streak%'
  THEN
    RETURN NEW;
  END IF;

  SELECT
    coalesce(streak.current_streak, 0),
    coalesce(streak.longest_streak, 0)
  INTO v_live_current, v_live_longest
  FROM public.get_authoritative_streak(NEW.user_id) streak
  LIMIT 1;

  v_cutoff := (NEW.created_at AT TIME ZONE 'Africa/Douala')::date
    - CASE
        WHEN (NEW.created_at AT TIME ZONE 'Africa/Douala')::time >= time '21:00' THEN 0
        ELSE 1
      END;
  v_restored := public.restore_thiefs_request_history(NEW.user_id, v_cutoff);

  IF v_restored <= 0 THEN
    RETURN NEW;
  END IF;

  SELECT (profile.created_at AT TIME ZONE 'Africa/Douala')::date
  INTO v_join_date
  FROM public.profiles profile
  WHERE profile.id = NEW.user_id;

  SELECT count(*)::integer
  INTO v_recovered_current
  FROM generate_series(v_join_date, v_cutoff, interval '1 day') day(record_date)
  WHERE (
      extract(dow FROM day.record_date) BETWEEN 1 AND 5
      OR (
        extract(dow FROM day.record_date) = 0
        AND day.record_date::date >= date '2026-08-02'
      )
      OR (
        extract(dow FROM day.record_date) = 6
        AND EXISTS (
          SELECT 1
          FROM public.quiz_sessions session
          WHERE session.session_date = day.record_date::date
            AND session.quiz_type = 'saturday'
        )
      )
    )
    AND (
      public.streak_requirement_met(NEW.user_id, day.record_date::date)
      OR public.streak_day_is_restored(NEW.user_id, day.record_date::date)
      OR public.streak_day_is_purchased(NEW.user_id, day.record_date::date)
    );

  IF v_recovered_current > v_live_current THEN
    INSERT INTO public.streak_manual_adjustments AS adjustment (
      user_id,
      effective_date,
      current_streak,
      longest_streak,
      reason,
      created_at
    ) VALUES (
      NEW.user_id,
      v_cutoff,
      v_recovered_current,
      greatest(v_live_longest, v_recovered_current),
      'Thief''s Request explicitly recovered the lost streak through ' || v_cutoff::text,
      now()
    )
    ON CONFLICT (user_id) DO UPDATE
    SET effective_date = EXCLUDED.effective_date,
        current_streak = greatest(adjustment.current_streak, EXCLUDED.current_streak),
        longest_streak = greatest(
          adjustment.longest_streak,
          adjustment.current_streak,
          EXCLUDED.longest_streak,
          EXCLUDED.current_streak
        ),
        reason = EXCLUDED.reason,
        created_at = now();
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.complete_thiefs_request_after_use()
  FROM PUBLIC, anon, authenticated;

/* Rebuild today's single published row for every profile from the new engine.
   This is what makes the quote feed, toolbar, and every role's streak board
   agree immediately. */
SELECT public.refresh_all_streak_snapshots();

/* Keep the existing immediate evidence triggers and install two independent
   settlement passes. The hourly pass repairs interrupted writes; 21:05 closes
   missed/frozen days even when nobody has the app open. */
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    BEGIN
      PERFORM cron.unschedule('full-circle-streak-snapshots');
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
    BEGIN
      PERFORM cron.unschedule('full-circle-streak-day-close');
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;

    PERFORM cron.schedule(
      'full-circle-streak-snapshots',
      '7 * * * *',
      'SELECT public.refresh_all_streak_snapshots();'
    );
    PERFORM cron.schedule(
      'full-circle-streak-day-close',
      '5 20 * * *',
      'SELECT public.refresh_all_streak_snapshots();'
    );
  END IF;
END;
$$;
