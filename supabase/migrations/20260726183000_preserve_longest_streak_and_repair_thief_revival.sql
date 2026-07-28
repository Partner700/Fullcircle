/*
# Preserve historical streaks and repair Thief's Request revival

- Calculate longest streak across the full activity calendar instead of only the
  current backward scan.
- Treat missing required days as real streak breaks even when no daily_records
  row was created.
- Let The Thief's Request bridge a missed Saturday quiz without enabling normal
  freezers or Simon's Purse in the arena/quiz day.
- Repair prior Thief uses that awarded the talent but failed to add a revival.
*/

CREATE OR REPLACE FUNCTION public.is_required_streak_day(p_date date)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF EXTRACT(DOW FROM p_date) = 0 THEN
    RETURN false;
  END IF;

  IF EXTRACT(DOW FROM p_date) = 6 THEN
    RETURN EXISTS (
      SELECT 1
      FROM public.quiz_sessions qs
      WHERE qs.session_date = p_date
        AND qs.quiz_type = 'saturday'
    );
  END IF;

  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.is_streak_day_complete(
  p_user_id uuid,
  p_date date
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_required_streak_day(p_date) THEN
    RETURN false;
  END IF;

  IF EXTRACT(DOW FROM p_date) = 6 THEN
    RETURN
      EXISTS (
        SELECT 1
        FROM public.quiz_attempts qa
        JOIN public.quiz_sessions qs ON qs.id = qa.quiz_session_id
        WHERE qa.user_id = p_user_id
          AND qs.session_date = p_date
          AND qs.quiz_type = 'saturday'
          AND qa.status = 'submitted'
      )
      OR EXISTS (
        SELECT 1
        FROM public.daily_records dr
        WHERE dr.user_id = p_user_id
          AND dr.record_date = p_date
          AND COALESCE(dr.streak_valid, false) = true
      )
      OR EXISTS (
        SELECT 1
        FROM public.streak_freezers sf
        WHERE sf.user_id = p_user_id
          AND sf.applied_to_date = p_date
          AND sf.freezer_type = 'weekly'
          AND sf.source = 'relic'
      );
  END IF;

  RETURN
    EXISTS (
      SELECT 1
      FROM public.daily_records dr
      WHERE dr.user_id = p_user_id
        AND dr.record_date = p_date
        AND (
          COALESCE(dr.streak_valid, false) = true
          OR (
            COALESCE(dr.attendance_status, 'unmarked') = 'present'
            AND COALESCE(dr.meditation_submitted, false) = true
            AND (
              dr.meditation_submitted_at IS NULL
              OR (dr.meditation_submitted_at AT TIME ZONE 'Africa/Douala')::time < time '21:00'
            )
          )
        )
    )
    OR EXISTS (
      SELECT 1
      FROM public.streak_freezers sf
      WHERE sf.user_id = p_user_id
        AND sf.applied_to_date = p_date
        AND (sf.expires_at IS NULL OR sf.expires_at >= p_date)
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.compute_historical_longest_streak(p_user_id uuid)
RETURNS integer
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_start date;
  v_today date := timezone('Africa/Douala', now())::date;
  v_check date;
  v_run integer := 0;
  v_longest integer := 0;
  v_snapshot_longest integer := 0;
BEGIN
  SELECT MIN(activity_date)
  INTO v_start
  FROM (
    SELECT dr.record_date AS activity_date
    FROM public.daily_records dr
    WHERE dr.user_id = p_user_id

    UNION ALL

    SELECT qs.session_date
    FROM public.quiz_attempts qa
    JOIN public.quiz_sessions qs ON qs.id = qa.quiz_session_id
    WHERE qa.user_id = p_user_id
      AND qs.quiz_type = 'saturday'

    UNION ALL

    SELECT sf.applied_to_date
    FROM public.streak_freezers sf
    WHERE sf.user_id = p_user_id
      AND sf.applied_to_date IS NOT NULL
  ) activity;

  IF v_start IS NOT NULL THEN
    FOR v_check IN
      SELECT generate_series(v_start, v_today, interval '1 day')::date
    LOOP
      IF NOT public.is_required_streak_day(v_check) THEN
        CONTINUE;
      END IF;

      IF public.is_streak_day_complete(p_user_id, v_check) THEN
        v_run := v_run + 1;
        v_longest := GREATEST(v_longest, v_run);
      ELSE
        v_run := 0;
      END IF;
    END LOOP;
  END IF;

  SELECT COALESCE(MAX(ss.longest_streak), 0)
  INTO v_snapshot_longest
  FROM public.streakboard_snapshots ss
  WHERE ss.user_id = p_user_id;

  RETURN GREATEST(v_longest, v_snapshot_longest);
END;
$$;

CREATE OR REPLACE FUNCTION public.find_latest_lost_streak_date(p_user_id uuid)
RETURNS date
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_start date;
  v_today date := timezone('Africa/Douala', now())::date;
  v_after_cutoff boolean := timezone('Africa/Douala', now())::time >= time '21:00';
  v_check date;
  v_run integer := 0;
  v_candidate date;
  v_explicit_absence boolean;
BEGIN
  SELECT MIN(activity_date)
  INTO v_start
  FROM (
    SELECT dr.record_date AS activity_date
    FROM public.daily_records dr
    WHERE dr.user_id = p_user_id
      AND (
        COALESCE(dr.streak_valid, false) = true
        OR (
          COALESCE(dr.attendance_status, 'unmarked') = 'present'
          AND COALESCE(dr.meditation_submitted, false) = true
        )
      )

    UNION ALL

    SELECT qs.session_date
    FROM public.quiz_attempts qa
    JOIN public.quiz_sessions qs ON qs.id = qa.quiz_session_id
    WHERE qa.user_id = p_user_id
      AND qs.quiz_type = 'saturday'
      AND qa.status = 'submitted'
  ) completed_activity;

  IF v_start IS NULL THEN
    RETURN NULL;
  END IF;

  FOR v_check IN
    SELECT generate_series(v_start, v_today, interval '1 day')::date
  LOOP
    IF NOT public.is_required_streak_day(v_check) THEN
      CONTINUE;
    END IF;

    IF public.is_streak_day_complete(p_user_id, v_check) THEN
      v_run := v_run + 1;
      CONTINUE;
    END IF;

    SELECT EXISTS (
      SELECT 1
      FROM public.daily_records dr
      WHERE dr.user_id = p_user_id
        AND dr.record_date = v_check
        AND dr.attendance_status = 'absent'
    )
    INTO v_explicit_absence;

    IF v_check = v_today AND NOT v_after_cutoff AND NOT v_explicit_absence THEN
      CONTINUE;
    END IF;

    IF v_run > 0 THEN
      v_candidate := v_check;
    END IF;
    v_run := 0;
  END LOOP;

  RETURN v_candidate;
END;
$$;

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
  v_saturday_revival_available boolean;
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
    v_saturday_revival_available := false;
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

        SELECT EXISTS(
          SELECT 1
          FROM public.streak_freezers sf
          WHERE sf.user_id = p_user_id
            AND sf.applied_to_date = v_check
            AND sf.freezer_type = 'weekly'
            AND sf.source = 'relic'
        ) INTO v_saturday_revival_available;

        IF v_quiz_valid OR v_saturday_revival_available THEN
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
      ELSE
        v_check := v_check - 1;
        CONTINUE;
      END IF;
    END IF;

    SELECT EXISTS(
      SELECT 1
      FROM public.streak_freezers
      WHERE user_id = p_user_id
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
          OR COALESCE(prior.streak_valid, false) = true
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
    IF v_check < v_today - 3650 THEN EXIT; END IF;
    v_check := v_check - 1;
  END LOOP;

  v_longest := GREATEST(v_longest, public.compute_historical_longest_streak(p_user_id));

  RETURN QUERY SELECT v_current, v_longest, v_consec, v_cum;
END;
$function$;

CREATE OR REPLACE FUNCTION public.use_relic(p_user_id uuid, p_relic_slug text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inv RECORD;
  v_relic RECORD;
  v_result jsonb;
  v_days_on_platform integer := 0;
  v_retroactive_denarii integer := 0;
  v_talent_denarii integer := 6000;
  v_first_record_date date;
  v_lost_streak_date date;
  v_saturday_date date;
  v_protected_date date;
  v_inserted_days integer := 0;
  v_today date := timezone('Africa/Douala', now())::date;
BEGIN
  SELECT * INTO v_relic
  FROM public.relic_types
  WHERE slug = p_relic_slug;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Relic not found';
  END IF;

  SELECT * INTO v_inv
  FROM public.relic_inventory
  WHERE user_id = p_user_id
    AND relic_type_id = v_relic.id
    AND quantity > 0
  LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'You do not own this relic';
  END IF;

  UPDATE public.relic_inventory
  SET quantity = quantity - 1
  WHERE id = v_inv.id;

  IF v_relic.effect_type = 'revive_lost_streak' THEN
    SELECT MIN(record_date::date) INTO v_first_record_date
    FROM public.daily_records
    WHERE user_id = p_user_id;

    IF v_first_record_date IS NOT NULL THEN
      v_days_on_platform := v_today - v_first_record_date;
      v_retroactive_denarii := GREATEST(v_days_on_platform, 0) * 650;
    END IF;

    IF v_retroactive_denarii > 0 THEN
      INSERT INTO public.denarii_ledger_entries (user_id, amount, source_type, description)
      VALUES (
        p_user_id,
        v_retroactive_denarii,
        'relic_reward',
        v_relic.name || ': retroactive ' || v_days_on_platform || ' days at perfect score'
      );
    END IF;

    INSERT INTO public.denarii_ledger_entries (user_id, amount, source_type, description)
    VALUES (p_user_id, v_talent_denarii, 'relic_reward', v_relic.name || ': one talent awarded');

    v_lost_streak_date := public.find_latest_lost_streak_date(p_user_id);

    IF v_lost_streak_date IS NOT NULL
      AND NOT EXISTS (
        SELECT 1
        FROM public.streak_freezers sf
        WHERE sf.user_id = p_user_id
          AND sf.applied_to_date = v_lost_streak_date
          AND sf.freezer_type = 'weekly'
          AND sf.source = 'relic'
      )
    THEN
      INSERT INTO public.streak_freezers (user_id, freezer_type, source, applied_to_date)
      VALUES (p_user_id, 'weekly', 'relic', v_lost_streak_date);
    END IF;

    v_result := jsonb_build_object(
      'success', true,
      'effect', 'revive_lost_streak',
      'retroactive_denarii', v_retroactive_denarii,
      'talent_denarii', v_talent_denarii,
      'denarii_awarded', v_retroactive_denarii + v_talent_denarii,
      'days_on_platform', v_days_on_platform,
      'streak_revived', v_lost_streak_date IS NOT NULL,
      'revived_date', v_lost_streak_date,
      'message',
        CASE
          WHEN v_lost_streak_date IS NOT NULL THEN v_relic.name || ' revived the lost streak and awarded one talent.'
          ELSE v_relic.name || ' awarded one talent. No completed streak was available to revive.'
        END
    );

  ELSIF v_relic.effect_type = 'resurrect_lost_streak' THEN
    v_lost_streak_date := public.find_latest_lost_streak_date(p_user_id);

    IF v_lost_streak_date IS NOT NULL
      AND NOT EXISTS (
        SELECT 1
        FROM public.streak_freezers sf
        WHERE sf.user_id = p_user_id
          AND sf.applied_to_date = v_lost_streak_date
          AND sf.freezer_type = 'weekly'
          AND sf.source = 'relic'
      )
    THEN
      INSERT INTO public.streak_freezers (user_id, freezer_type, source, applied_to_date)
      VALUES (p_user_id, 'weekly', 'relic', v_lost_streak_date);
    END IF;

    v_result := jsonb_build_object(
      'success', true,
      'effect', 'resurrect_lost_streak',
      'streak_revived', v_lost_streak_date IS NOT NULL,
      'revived_date', v_lost_streak_date,
      'message',
        CASE
          WHEN v_lost_streak_date IS NOT NULL THEN 'The lost streak was restored.'
          ELSE 'No completed streak was available to restore.'
        END
    );

  ELSIF v_relic.effect_type = 'streak_shield_week' THEN
    v_saturday_date := v_today + ((6 - EXTRACT(DOW FROM v_today)::int + 7) % 7);
    IF v_saturday_date = v_today THEN
      v_saturday_date := v_today + 7;
    END IF;

    v_protected_date := v_today;
    WHILE v_inserted_days < 5 LOOP
      v_protected_date := v_protected_date + 1;
      EXIT WHEN v_protected_date >= v_saturday_date;

      IF EXTRACT(DOW FROM v_protected_date) <> 0 THEN
        IF NOT EXISTS (
          SELECT 1
          FROM public.streak_freezers sf
          WHERE sf.user_id = p_user_id
            AND sf.applied_to_date = v_protected_date
            AND sf.source = 'relic'
        ) THEN
          INSERT INTO public.streak_freezers (user_id, freezer_type, source, applied_to_date, expires_at)
          VALUES (p_user_id, 'daily', 'relic', v_protected_date, v_saturday_date);
        END IF;
        v_inserted_days := v_inserted_days + 1;
      END IF;
    END LOOP;

    v_result := jsonb_build_object(
      'success', true,
      'effect', 'streak_shield_week',
      'protected_days', v_inserted_days,
      'expires_on', v_saturday_date::text,
      'message', 'Simon''s Purse will earn streak protection for up to five absent weekdays, ending before the Saturday quiz.'
    );

  ELSIF v_relic.effect_type = 'grant_one_talent' THEN
    INSERT INTO public.denarii_ledger_entries (user_id, amount, source_type, description)
    VALUES (p_user_id, v_talent_denarii, 'relic_reward', 'Master''s Reward: one talent awarded');

    v_result := jsonb_build_object(
      'success', true,
      'effect', 'grant_one_talent',
      'denarii_awarded', v_talent_denarii,
      'message', 'The Master''s Reward awarded one talent.'
    );

  ELSE
    v_result := jsonb_build_object('success', true, 'effect', v_relic.effect_type);
  END IF;

  RETURN v_result;
END;
$$;

WITH prior_failed_uses AS (
  SELECT DISTINCT dle.user_id
  FROM public.denarii_ledger_entries dle
  WHERE dle.description ILIKE 'The Thief''s Request:%one talent awarded%'
),
repair_candidates AS MATERIALIZED (
  SELECT
    pfu.user_id,
    public.find_latest_lost_streak_date(pfu.user_id) AS lost_date
  FROM prior_failed_uses pfu
)
INSERT INTO public.streak_freezers (user_id, freezer_type, source, applied_to_date)
SELECT rc.user_id, 'weekly', 'relic', rc.lost_date
FROM repair_candidates rc
WHERE rc.lost_date IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM public.streak_freezers sf
    WHERE sf.user_id = rc.user_id
      AND sf.applied_to_date = rc.lost_date
      AND sf.freezer_type = 'weekly'
      AND sf.source = 'relic'
  );

GRANT EXECUTE ON FUNCTION public.is_required_streak_day(date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_streak_day_complete(uuid, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.compute_historical_longest_streak(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.find_latest_lost_streak_date(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.compute_strict_streak(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.use_relic(uuid, text) TO authenticated;
