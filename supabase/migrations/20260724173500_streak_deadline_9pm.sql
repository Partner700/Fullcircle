/*
# 9 PM streak deadline

- Daily meditation streak submissions close at 9:00 PM Africa/Douala time.
- Late meditation records no longer count toward strict streaks.
*/

CREATE OR REPLACE FUNCTION public.mark_cadet_attendance(
  p_sentry_id uuid,
  p_cadet_id uuid,
  p_record_date text,
  p_status text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_record_date date := p_record_date::date;
  v_day_type text;
  v_attendance_late boolean;
  v_record public.daily_records%ROWTYPE;
  v_reward_awarded boolean := false;
  v_reward_removed boolean := false;
  v_reward_id uuid;
BEGIN
  IF p_status NOT IN ('present', 'absent') THEN
    RAISE EXCEPTION 'Attendance status must be present or absent.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.tent_members cm
    JOIN public.tents t ON t.id = cm.tent_id
    LEFT JOIN public.tent_members sm
      ON sm.tent_id = t.id
      AND sm.user_id = p_sentry_id
      AND sm.role = 'sentry'
    WHERE cm.user_id = p_cadet_id
      AND cm.role = 'cadet'
      AND (t.sentry_id = p_sentry_id OR sm.id IS NOT NULL)
  )
  AND NOT EXISTS (
    SELECT 1
    FROM public.role_assignments ra
    WHERE ra.user_id = p_sentry_id
      AND ra.role = 'instructor'
      AND ra.status IN ('active', 'approved')
  ) THEN
    RAISE EXCEPTION 'You can only mark attendance for cadets in your assigned tent.';
  END IF;

  v_day_type := CASE
    WHEN EXTRACT(DOW FROM v_record_date) = 0 THEN 'sunday'
    WHEN EXTRACT(DOW FROM v_record_date) = 6 THEN 'saturday'
    ELSE 'weekday'
  END;
  v_attendance_late := ((now() AT TIME ZONE 'Africa/Douala')::time >= time '12:00');

  INSERT INTO public.daily_records (
    user_id,
    record_date,
    day_type,
    attendance_status,
    attendance_marked_at,
    attendance_marked_by,
    attendance_late,
    meditation_submitted,
    streak_valid
  )
  VALUES (
    p_cadet_id,
    v_record_date,
    v_day_type,
    p_status,
    now(),
    p_sentry_id,
    v_attendance_late,
    false,
    CASE
      WHEN v_day_type = 'sunday' THEN NULL
      WHEN v_day_type = 'weekday' THEN false
      ELSE false
    END
  )
  ON CONFLICT (user_id, record_date) DO UPDATE SET
    day_type = EXCLUDED.day_type,
    attendance_status = EXCLUDED.attendance_status,
    attendance_marked_at = EXCLUDED.attendance_marked_at,
    attendance_marked_by = EXCLUDED.attendance_marked_by,
    attendance_late = EXCLUDED.attendance_late,
    streak_valid = CASE
      WHEN EXCLUDED.day_type = 'sunday' THEN NULL
      WHEN EXCLUDED.day_type = 'weekday' THEN
        EXCLUDED.attendance_status = 'present'
        AND COALESCE(public.daily_records.meditation_submitted, false) = true
        AND (
          public.daily_records.meditation_submitted_at IS NULL
          OR (public.daily_records.meditation_submitted_at AT TIME ZONE 'Africa/Douala')::time < time '21:00'
        )
      ELSE COALESCE(public.daily_records.quiz_attempt_id IS NOT NULL, false)
    END
  RETURNING * INTO v_record;

  IF p_status = 'present' THEN
    INSERT INTO public.denarii_ledger_entries (user_id, amount, source_type, source_reference, description)
    SELECT p_cadet_id, 200, 'attendance', v_record_date::text, 'Attendance reward'
    WHERE NOT EXISTS (
      SELECT 1
      FROM public.denarii_ledger_entries dle
      WHERE dle.user_id = p_cadet_id
        AND dle.source_type = 'attendance'
        AND dle.source_reference = v_record_date::text
        AND dle.amount = 200
    )
    RETURNING id INTO v_reward_id;

    v_reward_awarded := v_reward_id IS NOT NULL;
  ELSE
    WITH deleted AS (
      DELETE FROM public.denarii_ledger_entries dle
      WHERE dle.user_id = p_cadet_id
        AND dle.source_type = 'attendance'
        AND dle.source_reference = v_record_date::text
        AND dle.amount = 200
      RETURNING dle.id
    )
    SELECT EXISTS(SELECT 1 FROM deleted) INTO v_reward_removed;
  END IF;

  RETURN jsonb_build_object(
    'record_id', v_record.id,
    'attendance_status', v_record.attendance_status,
    'attendance_late', v_record.attendance_late,
    'reward_awarded', v_reward_awarded,
    'reward_removed', v_reward_removed,
    'devotion_submitted', COALESCE(v_record.meditation_submitted, false),
    'streak_valid', v_record.streak_valid
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.mark_cadet_attendance(uuid, uuid, text, text) TO authenticated;

DROP FUNCTION IF EXISTS public.record_meditation_streak(uuid, date, text);
CREATE OR REPLACE FUNCTION public.record_meditation_streak(p_user_id uuid, p_date date, p_text text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_day_type text;
  v_now_local time := (now() AT TIME ZONE 'Africa/Douala')::time;
BEGIN
  IF p_date = (now() AT TIME ZONE 'Africa/Douala')::date
    AND v_now_local >= time '21:00' THEN
    RAISE EXCEPTION 'Streak submissions close at 9:00 PM.';
  END IF;

  v_day_type := CASE
    WHEN EXTRACT(DOW FROM p_date) = 0 THEN 'sunday'
    WHEN EXTRACT(DOW FROM p_date) = 6 THEN 'saturday'
    ELSE 'weekday'
  END;

  INSERT INTO public.daily_records (
    user_id,
    record_date,
    day_type,
    meditation_submitted,
    meditation_submitted_at,
    meditation_text,
    streak_valid
  )
  VALUES (
    p_user_id,
    p_date,
    v_day_type,
    true,
    now(),
    p_text,
    CASE
      WHEN v_day_type = 'sunday' THEN NULL
      WHEN v_day_type = 'weekday' THEN false
      ELSE false
    END
  )
  ON CONFLICT (user_id, record_date) DO UPDATE SET
    day_type = EXCLUDED.day_type,
    meditation_submitted = true,
    meditation_submitted_at = now(),
    meditation_text = COALESCE(p_text, public.daily_records.meditation_text),
    streak_valid = CASE
      WHEN EXCLUDED.day_type = 'sunday' THEN NULL
      WHEN EXCLUDED.day_type = 'weekday' THEN
        COALESCE(public.daily_records.attendance_status, 'unmarked') = 'present'
      ELSE COALESCE(public.daily_records.quiz_attempt_id IS NOT NULL, false)
    END;
END;
$$;

GRANT EXECUTE ON FUNCTION public.record_meditation_streak(uuid, date, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.record_meditation_streak(
  p_user_id uuid,
  p_date text,
  p_meditation_text text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.record_meditation_streak(p_user_id, p_date::date, p_meditation_text);
END;
$$;

GRANT EXECUTE ON FUNCTION public.record_meditation_streak(uuid, text, text) TO authenticated;

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
  v_today date := (now() AT TIME ZONE 'Africa/Douala')::date;
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
          AND qs.status IN ('live', 'closed', 'completed')
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
        ELSE
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
    ELSIF v_check = v_today AND COALESCE(v_attendance_status, 'unmarked') = 'absent' THEN
      v_consec := v_consec + 1;
      v_cum := v_cum + 1;
      v_current := 0;
      EXIT;
    ELSIF v_check < v_today
      AND (v_current > 0 OR v_prior_valid_exists)
      AND v_simons_purse_active
      AND v_absence_count < 5 THEN
      v_current := v_current + 1;
      v_consec := 0;
      v_absence_count := v_absence_count + 1;
    ELSIF v_check < v_today
      AND (v_current > 0 OR v_prior_valid_exists)
      AND v_dated_freezer_available THEN
      v_current := v_current + 1;
      v_consec := 0;
      v_absence_count := v_absence_count + 1;
    ELSIF v_check < v_today
      AND (v_current > 0 OR v_prior_valid_exists)
      AND v_unassigned_daily_freezers_used < v_unassigned_daily_freezers THEN
      v_current := v_current + 1;
      v_consec := 0;
      v_absence_count := v_absence_count + 1;
      v_unassigned_daily_freezers_used := v_unassigned_daily_freezers_used + 1;
    ELSIF v_check < v_today THEN
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

UPDATE public.daily_records dr
SET streak_valid = false
WHERE dr.day_type = 'weekday'
  AND COALESCE(dr.meditation_submitted, false) = true
  AND dr.meditation_submitted_at IS NOT NULL
  AND (dr.meditation_submitted_at AT TIME ZONE 'Africa/Douala')::time >= time '21:00';
