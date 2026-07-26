/*
# Prevent freezers from inventing streak history

Protection can bridge a missed day only when there was already a valid streak
before that missed day. It should not count blank days before a cadet's first
valid day as protected streak days.
*/

CREATE OR REPLACE FUNCTION public.compute_strict_streak(p_user_id uuid)
RETURNS TABLE(current_streak integer, longest_streak integer, consecutive_inactive integer, cumulative_inactive integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_med boolean;
  v_med_at timestamptz;
  v_med_on_time boolean;
  v_attendance_status text;
  v_day_complete boolean;
  v_current int := 0;
  v_longest int := 0;
  v_consec int := 0;
  v_cum int := 0;
  v_today date := timezone('Africa/Douala', now())::date;
  v_after_cutoff boolean := timezone('Africa/Douala', now())::time >= time '21:00';
  v_check date;
  v_dated_freezer_available boolean;
  v_unassigned_daily_freezers int := 0;
  v_unassigned_daily_freezers_used int := 0;
  v_simons_purse_active boolean;
  v_absence_count int := 0;
  v_has_saturday_quiz boolean;
  v_quiz_valid boolean;
  v_prior_valid_exists boolean;
BEGIN
  SELECT EXISTS(
    SELECT 1
    FROM public.relic_inventory ri
    JOIN public.relic_types rt ON ri.relic_type_id = rt.id
    WHERE ri.user_id = p_user_id
      AND rt.slug = 'simons-purse'
      AND ri.quantity > 0
  ) INTO v_simons_purse_active;

  SELECT count(*) INTO v_unassigned_daily_freezers
  FROM public.streak_freezers
  WHERE user_id = p_user_id
    AND freezer_type = 'daily'
    AND used_at IS NULL
    AND applied_to_date IS NULL
    AND (expires_at IS NULL OR expires_at >= v_today);

  v_check := v_today;
  LOOP
    IF EXTRACT(DOW FROM v_check) = 0 THEN
      v_check := v_check - 1;
      CONTINUE;
    END IF;

    v_med := NULL;
    v_med_at := NULL;
    v_attendance_status := NULL;
    SELECT dr.meditation_submitted, dr.meditation_submitted_at, dr.attendance_status
    INTO v_med, v_med_at, v_attendance_status
    FROM public.daily_records dr
    WHERE dr.user_id = p_user_id
      AND dr.record_date = v_check;

    v_med_on_time := COALESCE(v_med, false) = true
      AND (
        v_med_at IS NULL
        OR (v_med_at AT TIME ZONE 'Africa/Douala')::time < time '21:00'
      );

    v_has_saturday_quiz := false;
    v_quiz_valid := false;
    IF EXTRACT(DOW FROM v_check) = 6 THEN
      SELECT EXISTS(
        SELECT 1
        FROM public.quiz_sessions qs
        WHERE qs.session_date = v_check
          AND qs.quiz_type = 'saturday'
      ) INTO v_has_saturday_quiz;

      IF v_has_saturday_quiz THEN
        SELECT EXISTS(
          SELECT 1
          FROM public.quiz_attempts qa
          JOIN public.quiz_sessions qs ON qa.quiz_session_id = qs.id
          WHERE qa.user_id = p_user_id
            AND qs.session_date = v_check
            AND qs.quiz_type = 'saturday'
            AND qa.status = 'submitted'
        ) INTO v_quiz_valid;

        IF v_quiz_valid THEN
          v_current := v_current + 1;
          v_consec := 0;
          v_absence_count := 0;
          IF v_current > v_longest THEN v_longest := v_current; END IF;
          v_check := v_check - 1;
          CONTINUE;
        ELSIF v_check = v_today AND NOT v_after_cutoff THEN
          v_check := v_check - 1;
          CONTINUE;
        ELSE
          IF v_current > 0 THEN
            EXIT;
          END IF;
          v_consec := v_consec + 1;
          v_cum := v_cum + 1;
          v_current := 0;
          EXIT;
        END IF;
      END IF;
    END IF;

    SELECT EXISTS(
      SELECT 1
      FROM public.streak_freezers
      WHERE user_id = p_user_id
        AND used_at IS NULL
        AND applied_to_date = v_check
        AND (expires_at IS NULL OR expires_at >= v_check)
    ) INTO v_dated_freezer_available;

    SELECT EXISTS(
      SELECT 1
      FROM public.daily_records prior
      WHERE prior.user_id = p_user_id
        AND prior.record_date < v_check
        AND (
          (
            prior.day_type = 'weekday'
            AND COALESCE(prior.attendance_status, 'unmarked') = 'present'
            AND COALESCE(prior.meditation_submitted, false) = true
            AND (
              prior.meditation_submitted_at IS NULL
              OR (prior.meditation_submitted_at AT TIME ZONE 'Africa/Douala')::time < time '21:00'
            )
          )
          OR (
            prior.day_type = 'saturday'
            AND COALESCE(prior.streak_valid, false) = true
          )
        )
    ) INTO v_prior_valid_exists;

    v_day_complete := v_med_on_time
      AND COALESCE(v_attendance_status, 'unmarked') = 'present';

    IF v_day_complete THEN
      v_current := v_current + 1;
      v_consec := 0;
      v_absence_count := 0;
    ELSIF v_check = v_today AND COALESCE(v_attendance_status, 'unmarked') <> 'absent' AND NOT v_after_cutoff THEN
      v_check := v_check - 1;
      CONTINUE;
    ELSIF v_check = v_today THEN
      v_consec := v_consec + 1;
      v_cum := v_cum + 1;
      v_current := 0;
      EXIT;
    ELSIF v_check < v_today
      AND v_prior_valid_exists
      AND v_simons_purse_active
      AND v_absence_count < 5 THEN
      v_current := v_current + 1;
      v_consec := 0;
      v_absence_count := v_absence_count + 1;
    ELSIF v_check < v_today
      AND v_prior_valid_exists
      AND v_dated_freezer_available THEN
      v_current := v_current + 1;
      v_consec := 0;
      v_absence_count := v_absence_count + 1;
    ELSIF v_check < v_today
      AND v_prior_valid_exists
      AND v_unassigned_daily_freezers_used < v_unassigned_daily_freezers THEN
      v_current := v_current + 1;
      v_consec := 0;
      v_absence_count := v_absence_count + 1;
      v_unassigned_daily_freezers_used := v_unassigned_daily_freezers_used + 1;
    ELSIF v_check < v_today THEN
      IF v_current > 0 THEN
        EXIT;
      END IF;
      v_consec := v_consec + 1;
      v_cum := v_cum + 1;
      v_current := 0;
      EXIT;
    END IF;

    IF v_current > v_longest THEN v_longest := v_current; END IF;
    IF v_check < v_today - 365 THEN EXIT; END IF;
    v_check := v_check - 1;
  END LOOP;

  RETURN QUERY SELECT v_current, v_longest, v_consec, v_cum;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.compute_strict_streak(uuid) TO authenticated;
