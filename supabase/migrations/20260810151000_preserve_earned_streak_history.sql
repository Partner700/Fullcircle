/*
  Preserve streak days that were already awarded before the deterministic
  calculator was deployed. From 10 August 2026 onward, streaks continue to use
  the strict attendance, meditation, quiz, and Sunday-reading evidence rules.
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
  -- A migration must not erase a day the platform had already awarded.
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
    IF p_record_date < date '2026-08-02' THEN RETURN false; END IF;
    RETURN EXISTS (
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
      AND COALESCE(record.meditation_submitted, false)
      AND (
        record.meditation_submitted_at IS NULL
        OR (record.meditation_submitted_at AT TIME ZONE 'Africa/Douala')::time < time '21:00'
      )
      AND (
        COALESCE(record.attendance_status, 'unmarked') = 'present'
        OR EXISTS (
          SELECT 1
          FROM public.daily_records marked
          JOIN public.tent_members cadet_member
            ON cadet_member.user_id = marked.user_id
            AND cadet_member.role = 'cadet'
          JOIN public.tents tent ON tent.id = cadet_member.tent_id
          LEFT JOIN public.tent_members sentry_member
            ON sentry_member.tent_id = cadet_member.tent_id
            AND sentry_member.user_id = p_user_id
            AND sentry_member.role = 'sentry'
          WHERE marked.record_date = p_record_date
            AND marked.attendance_marked_by = p_user_id
            AND marked.attendance_marked_at IS NOT NULL
            AND (marked.attendance_marked_at AT TIME ZONE 'Africa/Douala')::time < time '12:00'
            AND (tent.sentry_id = p_user_id OR sentry_member.user_id IS NOT NULL)
        )
      )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.streak_requirement_met(uuid, date)
  FROM PUBLIC, anon, authenticated;

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

    -- Do not break today's streak while the user still has time to complete it.
    -- Simon's Purse is the exception because it grants today's weekday at once.
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
          FROM public.streak_freezers starter
          WHERE starter.user_id = p_user_id
            AND starter.source IN ('redemption', 'simons_purse')
            AND starter.used_at IS NULL
            AND starter.applied_to_date = v_check
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

    IF v_complete THEN
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
GRANT EXECUTE ON FUNCTION public.compute_strict_streak(uuid) TO authenticated;
