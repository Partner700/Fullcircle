/*
  Keep confirmed attendance distinct from the time it was entered.

  A cadet can be present at the morning call while the sentry records or
  corrects that presence later. The former rule compared attendance_marked_at
  with noon, turning a delayed administrative action into a missed streak even
  though attendance_status was authoritatively corrected to present. Punctuality
  remains represented by attendance_late and its original timestamp; streak
  eligibility now relies on the confirmed status plus an on-time meditation.
*/

CREATE OR REPLACE FUNCTION public.streak_requirement_met(
  p_user_id uuid,
  p_record_date date
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_record_date < date '2026-08-10' AND EXISTS (
    SELECT 1
    FROM public.daily_records historical
    WHERE historical.user_id = p_user_id
      AND historical.record_date = p_record_date
      AND historical.streak_valid IS TRUE
  ) THEN
    RETURN true;
  END IF;

  IF extract(dow FROM p_record_date) = 0 THEN
    RETURN p_record_date >= date '2026-08-02' AND EXISTS (
      SELECT 1
      FROM public.daily_records record
      WHERE record.user_id = p_user_id
        AND record.record_date = p_record_date
        AND record.sunday_reading_opened_at IS NOT NULL
        AND (record.sunday_reading_opened_at AT TIME ZONE 'Africa/Douala')::time < time '21:00'
    );
  END IF;

  IF extract(dow FROM p_record_date) = 6 THEN
    RETURN EXISTS (
      SELECT 1
      FROM public.quiz_attempts attempt
      JOIN public.quiz_sessions session ON session.id = attempt.quiz_session_id
      WHERE attempt.user_id = p_user_id
        AND session.session_date = p_record_date
        AND session.quiz_type = 'saturday'
        AND attempt.status IN ('submitted', 'timed_out')
    );
  END IF;

  RETURN EXISTS (
    SELECT 1
    FROM public.daily_records record
    WHERE record.user_id = p_user_id
      AND record.record_date = p_record_date
      AND coalesce(record.meditation_submitted, false)
      AND (
        (
          record.meditation_submitted_at IS NOT NULL
          AND (record.meditation_submitted_at AT TIME ZONE 'Africa/Douala')::time < time '21:00'
        )
        OR (
          p_record_date < date '2026-08-10'
          AND record.meditation_submitted_at IS NULL
        )
      )
      AND (
        /* The authorized sentry/instructor status is the attendance fact.
           The entry timestamp remains available for punctuality reporting. */
        coalesce(record.attendance_status, 'unmarked') = 'present'
        OR EXISTS (
          /* Sentry duty is still earned only by actually recording at least
             one cadet before noon. This branch is intentionally unchanged. */
          SELECT 1
          FROM public.daily_records marked
          WHERE marked.record_date = p_record_date
            AND marked.attendance_marked_by = p_user_id
            AND marked.attendance_marked_at IS NOT NULL
            AND (marked.attendance_marked_at AT TIME ZONE 'Africa/Douala')::time < time '12:00'
        )
      )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.streak_requirement_met(uuid, date)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.streak_requirement_met(uuid, date)
  TO service_role;

/* Function replacement does not itself fire the daily-record trigger. Bring
   records from the corrected rule's release date into agreement before
   rebuilding snapshots, including the affected record if deployment happens
   after the reported day. */
UPDATE public.daily_records record
SET streak_valid = (
  public.streak_requirement_met(record.user_id, record.record_date)
  OR public.streak_day_is_restored(record.user_id, record.record_date)
  OR public.streak_day_is_purchased(record.user_id, record.record_date)
)
WHERE record.record_date >= date '2026-09-08'
  AND record.streak_valid IS DISTINCT FROM (
    public.streak_requirement_met(record.user_id, record.record_date)
    OR public.streak_day_is_restored(record.user_id, record.record_date)
    OR public.streak_day_is_purchased(record.user_id, record.record_date)
  );

/* PH's reported completion occurred on 8 September. Anchor that verified day
   from the strongest 7 September published value so this repair remains exact
   even if deployed after midnight. It runs only when the stored record itself
   proves both requirements under the corrected rule. */
DO $$
DECLARE
  v_ph_id uuid;
  v_ph_count integer := 0;
  v_prior_streak integer := 0;
  v_prior_longest integer := 0;
  v_affected_date date := date '2026-09-08';
BEGIN
  SELECT count(*)::integer, (array_agg(profile.id ORDER BY profile.id))[1]
  INTO v_ph_count, v_ph_id
  FROM public.profiles profile
  WHERE regexp_replace(lower(btrim(profile.display_name)), '[^a-z0-9]+', '', 'g') = 'ph';

  IF v_ph_count = 1
     AND public.streak_requirement_met(v_ph_id, v_affected_date)
  THEN
    SELECT
      coalesce(max(snapshot.current_streak), 0)::integer,
      coalesce(max(greatest(snapshot.longest_streak, snapshot.current_streak)), 0)::integer
    INTO v_prior_streak, v_prior_longest
    FROM public.streakboard_snapshots snapshot
    WHERE snapshot.user_id = v_ph_id
      AND snapshot.snapshot_date = v_affected_date - 1;

    SELECT
      greatest(v_prior_streak, coalesce(max(adjustment.current_streak), 0)),
      greatest(v_prior_longest, coalesce(max(adjustment.longest_streak), 0))
    INTO v_prior_streak, v_prior_longest
    FROM public.streak_manual_adjustments adjustment
    WHERE adjustment.user_id = v_ph_id
      AND adjustment.effective_date <= v_affected_date - 1;

    IF coalesce(v_prior_streak, 0) > 0 THEN
      INSERT INTO public.streak_manual_adjustments AS adjustment(
        user_id,
        effective_date,
        current_streak,
        longest_streak,
        reason,
        created_at
      ) VALUES (
        v_ph_id,
        v_affected_date,
        v_prior_streak + 1,
        greatest(v_prior_longest, v_prior_streak + 1),
        'Verified PH attendance and meditation for 8 September; corrected delayed attendance entry handling',
        now()
      )
      ON CONFLICT (user_id) DO UPDATE
      SET effective_date = greatest(adjustment.effective_date, EXCLUDED.effective_date),
          current_streak = greatest(adjustment.current_streak, EXCLUDED.current_streak),
          longest_streak = greatest(
            adjustment.longest_streak,
            adjustment.current_streak,
            EXCLUDED.longest_streak,
            EXCLUDED.current_streak
          ),
          reason = CASE
            WHEN EXCLUDED.current_streak >= adjustment.current_streak THEN EXCLUDED.reason
            ELSE adjustment.reason
          END,
          created_at = now();
    END IF;
  END IF;
END;
$$;

/* Reconcile every current published view under the corrected rule. No streak
   is invented when either required piece of evidence is absent. */
SELECT public.refresh_all_streak_snapshots();
