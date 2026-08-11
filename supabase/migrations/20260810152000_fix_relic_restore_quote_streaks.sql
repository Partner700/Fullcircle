-- Fix relic restoration logic and enrich quote feed with streak data.

DROP FUNCTION IF EXISTS public.get_daily_quote_feed(integer);

CREATE OR REPLACE FUNCTION public.get_daily_quote_feed(p_limit integer DEFAULT 12)
RETURNS TABLE (
  record_date date,
  daily_quote text,
  user_id uuid,
  display_name text,
  avatar_url text,
  current_streak integer
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    dr.record_date,
    dr.daily_quote,
    dr.user_id,
    p.display_name,
    p.avatar_url,
    COALESCE((SELECT current_streak FROM public.compute_strict_streak(dr.user_id) LIMIT 1), 0) AS current_streak
  FROM public.daily_records dr
  JOIN public.profiles p ON p.id = dr.user_id
  WHERE dr.meditation_submitted = true
    AND NULLIF(btrim(dr.daily_quote), '') IS NOT NULL
  ORDER BY dr.record_date DESC, dr.meditation_submitted_at DESC NULLS LAST
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 12), 1), 30);
$$;

GRANT EXECUTE ON FUNCTION public.get_daily_quote_feed(integer) TO authenticated;

CREATE OR REPLACE FUNCTION public.find_latest_recoverable_streak_gap(
  p_user_id uuid,
  p_cutoff_date date
)
RETURNS date
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_start date;
  v_check date;
  v_complete boolean;
  v_current integer := 0;
  v_latest_gap date;
BEGIN
  SELECT (profile.created_at AT TIME ZONE 'Africa/Douala')::date
  INTO v_start
  FROM public.profiles profile
  WHERE profile.id = p_user_id;

  IF v_start IS NULL OR p_cutoff_date < v_start THEN RETURN NULL; END IF;

  v_check := v_start;
  WHILE v_check <= p_cutoff_date LOOP
    IF extract(dow FROM v_check) = 0 THEN
      IF v_check < date '2026-08-02' THEN
        v_check := v_check + 1;
        CONTINUE;
      END IF;
    ELSIF extract(dow FROM v_check) = 6
      AND NOT EXISTS (
        SELECT 1 FROM public.quiz_sessions session
        WHERE session.session_date = v_check AND session.quiz_type = 'saturday'
      )
    THEN
      v_check := v_check + 1;
      CONTINUE;
    END IF;

    v_complete := public.streak_requirement_met(p_user_id, v_check);
    IF NOT v_complete
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
              extract(dow FROM v_check) IN (0, 6)
              AND protection.freezer_type = 'weekly'
              AND protection.source IN ('relic', 'redemption')
            )
          )
      ) INTO v_complete;
    END IF;

    IF v_complete THEN
      v_current := v_current + 1;
    ELSE
      IF v_current > 0 THEN v_latest_gap := v_check; END IF;
      v_current := 0;
    END IF;
    v_check := v_check + 1;
  END LOOP;

  RETURN v_latest_gap;
END;
$$;

REVOKE ALL ON FUNCTION public.find_latest_recoverable_streak_gap(uuid, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.find_latest_recoverable_streak_gap(uuid, date) TO authenticated;

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
    v_complete := false;

    IF extract(dow FROM v_check) = 0 THEN
      IF v_check < date '2026-08-02' THEN
        v_check := v_check + 1;
        CONTINUE;
      END IF;

      SELECT EXISTS (
        SELECT 1
        FROM public.daily_records sunday_record
        WHERE sunday_record.user_id = p_user_id
          AND sunday_record.record_date = v_check
          AND sunday_record.sunday_reading_opened_at IS NOT NULL
          AND (sunday_record.sunday_reading_opened_at AT TIME ZONE 'Africa/Douala')::time < time '21:00'
      ) INTO v_complete;

      IF v_check = v_today AND NOT v_complete AND v_local_time < time '21:00' THEN
        v_check := v_check + 1;
        CONTINUE;
      END IF;
    ELSIF extract(dow FROM v_check) = 6 THEN
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

      SELECT EXISTS (
        SELECT 1
        FROM public.quiz_attempts attempt
        JOIN public.quiz_sessions session ON session.id = attempt.quiz_session_id
        WHERE attempt.user_id = p_user_id
          AND session.session_date = v_check
          AND session.quiz_type = 'saturday'
          AND attempt.status IN ('submitted', 'timed_out')
      ) INTO v_complete;

      IF v_check = v_today AND NOT v_complete AND v_local_time < time '21:00' THEN
        v_check := v_check + 1;
        CONTINUE;
      END IF;
    ELSE
      SELECT EXISTS (
        SELECT 1
        FROM public.daily_records record
        WHERE record.user_id = p_user_id
          AND record.record_date = v_check
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
              WHERE marked.record_date = v_check
                AND marked.attendance_marked_by = p_user_id
                AND marked.attendance_marked_at IS NOT NULL
                AND (marked.attendance_marked_at AT TIME ZONE 'Africa/Douala')::time < time '12:00'
                AND (tent.sentry_id = p_user_id OR sentry_member.id IS NOT NULL)
            )
          )
      ) INTO v_complete;

      IF v_check = v_today AND NOT v_complete AND v_local_time < time '21:00' THEN
        v_check := v_check + 1;
        CONTINUE;
      END IF;
    END IF;

    IF NOT v_complete
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
              extract(dow FROM v_check) IN (0, 6)
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

CREATE OR REPLACE FUNCTION public.use_relic(p_user_id uuid, p_relic_slug text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inventory public.relic_inventory%ROWTYPE;
  v_relic public.relic_types%ROWTYPE;
  v_today date := timezone('Africa/Douala', now())::date;
  v_join_date date;
  v_last_recoverable_date date;
  v_lost_streak_date date;
  v_recover_date date;
  v_restored_days integer := 0;
  v_days_on_platform integer := 0;
  v_retroactive_denarii integer := 0;
  v_talent_denarii integer := 6000;
  v_saturday_date date;
  v_protected_date date;
  v_inserted_days integer := 0;
  v_row_count integer := 0;
BEGIN
  IF auth.uid() IS NULL OR auth.uid() IS DISTINCT FROM p_user_id THEN
    RAISE EXCEPTION 'You can only use your own relics.';
  END IF;

  SELECT * INTO v_relic
  FROM public.relic_types
  WHERE slug = p_relic_slug;
  IF NOT FOUND THEN RAISE EXCEPTION 'Relic not found.'; END IF;

  IF v_relic.effect_type NOT IN (
    'revive_lost_streak',
    'resurrect_lost_streak',
    'restore_join_streak',
    'streak_shield_week',
    'grant_one_talent'
  ) THEN
    RAISE EXCEPTION 'This relic is used inside a game or quiz, not from the Market.';
  END IF;

  SELECT * INTO v_inventory
  FROM public.relic_inventory
  WHERE user_id = p_user_id
    AND relic_type_id = v_relic.id
    AND quantity > 0
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'You do not own this relic.'; END IF;

  SELECT (profile.created_at AT TIME ZONE 'Africa/Douala')::date
  INTO v_join_date
  FROM public.profiles profile
  WHERE profile.id = p_user_id;
  v_join_date := COALESCE(v_join_date, v_today);
  v_last_recoverable_date := v_today
    - CASE WHEN timezone('Africa/Douala', now())::time >= time '21:00' THEN 0 ELSE 1 END;

  IF v_relic.effect_type IN ('revive_lost_streak', 'resurrect_lost_streak') THEN
    v_lost_streak_date := public.find_latest_recoverable_streak_gap(
      p_user_id,
      v_last_recoverable_date
    );

    IF v_lost_streak_date IS NULL THEN
      RETURN jsonb_build_object(
        'success', false,
        'effect', v_relic.effect_type,
        'streak_revived', false,
        'message', 'No unrepaired streak-breaking day was found. Your relic was not used.'
      );
    END IF;

    UPDATE public.relic_inventory
    SET quantity = quantity - 1
    WHERE id = v_inventory.id;

    INSERT INTO public.streak_freezers (user_id, freezer_type, source, applied_to_date)
    VALUES (p_user_id, 'weekly', 'relic', v_lost_streak_date);

    IF v_relic.effect_type = 'revive_lost_streak' THEN
      v_days_on_platform := greatest(v_last_recoverable_date - v_join_date, 0);
      v_retroactive_denarii := v_days_on_platform * 650;
      IF v_retroactive_denarii > 0 THEN
        INSERT INTO public.denarii_ledger_entries (user_id, amount, source_type, description)
        VALUES (p_user_id, v_retroactive_denarii, 'relic_reward', v_relic.name || ': retroactive reward');
      END IF;
      INSERT INTO public.denarii_ledger_entries (user_id, amount, source_type, description)
      VALUES (p_user_id, v_talent_denarii, 'relic_reward', v_relic.name || ': one talent awarded');
    END IF;

    INSERT INTO public.relic_usage_log (user_id, relic_type_id, effect_applied)
    VALUES (p_user_id, v_relic.id, v_relic.effect_type || ':' || v_lost_streak_date::text);

    RETURN jsonb_build_object(
      'success', true,
      'effect', v_relic.effect_type,
      'streak_revived', true,
      'revived_date', v_lost_streak_date,
      'denarii_awarded', CASE
        WHEN v_relic.effect_type = 'revive_lost_streak' THEN v_retroactive_denarii + v_talent_denarii
        ELSE 0
      END,
      'message', v_relic.name || ' repaired the streak-breaking day of '
        || to_char(v_lost_streak_date, 'DD Mon YYYY') || '.'
    );
  END IF;

  IF v_relic.effect_type = 'restore_join_streak' THEN
    FOR v_recover_date IN
      SELECT day::date
      FROM generate_series(v_join_date, v_last_recoverable_date, interval '1 day') AS day
      WHERE (
        extract(dow FROM day) BETWEEN 1 AND 5
        OR extract(dow FROM day) = 6
        OR (extract(dow FROM day) = 0 AND day >= date '2026-08-02')
      )
      AND NOT public.streak_requirement_met(p_user_id, day::date)
      AND NOT EXISTS (
        SELECT 1 FROM public.streak_freezers saved
        WHERE saved.user_id = p_user_id
          AND saved.used_at IS NULL
          AND saved.applied_to_date = day::date
      )
    LOOP
      INSERT INTO public.streak_freezers (user_id, freezer_type, source, applied_to_date)
      VALUES (p_user_id, 'weekly', 'redemption', v_recover_date);
      v_restored_days := v_restored_days + 1;
    END LOOP;

    IF v_restored_days = 0 THEN
      RETURN jsonb_build_object(
        'success', false,
        'effect', 'restore_join_streak',
        'restored_days', 0,
        'message', 'There are no eligible missed streak days to restore. Your coin was not used.'
      );
    END IF;

    UPDATE public.relic_inventory
    SET quantity = quantity - 1
    WHERE id = v_inventory.id;
    INSERT INTO public.relic_usage_log (user_id, relic_type_id, effect_applied)
    VALUES (p_user_id, v_relic.id, 'restore_join_streak:' || v_restored_days::text);

    RETURN jsonb_build_object(
      'success', true,
      'effect', 'restore_join_streak',
      'restored_days', v_restored_days,
      'message', 'Redemption Coin restored ' || v_restored_days
        || ' eligible streak day(s) from your Full Circle history.'
    );
  END IF;

  IF v_relic.effect_type = 'streak_shield_week' THEN
    v_saturday_date := v_today + ((6 - extract(dow FROM v_today)::integer + 7) % 7);
    IF v_saturday_date = v_today THEN v_saturday_date := v_today + 7; END IF;
    v_protected_date := v_today;
    WHILE v_inserted_days < 5 LOOP
      v_protected_date := v_protected_date + 1;
      EXIT WHEN v_protected_date >= v_saturday_date;
      IF extract(dow FROM v_protected_date) BETWEEN 1 AND 5 THEN
        INSERT INTO public.streak_freezers (
          user_id, freezer_type, source, applied_to_date, expires_at
        )
        SELECT
          p_user_id, 'daily', 'relic', v_protected_date, v_saturday_date
        WHERE NOT EXISTS (
          SELECT 1 FROM public.streak_freezers existing
          WHERE existing.user_id = p_user_id
            AND existing.used_at IS NULL
            AND existing.applied_to_date = v_protected_date
        );
        GET DIAGNOSTICS v_row_count = ROW_COUNT;
        v_inserted_days := v_inserted_days + v_row_count;
      END IF;
    END LOOP;

    IF v_inserted_days = 0 THEN
      RETURN jsonb_build_object(
        'success', false,
        'effect', 'streak_shield_week',
        'protected_days', 0,
        'message', 'There are no unprotected weekdays before Saturday. Your relic was not used.'
      );
    END IF;

    UPDATE public.relic_inventory
    SET quantity = quantity - 1
    WHERE id = v_inventory.id;
    INSERT INTO public.relic_usage_log (user_id, relic_type_id, effect_applied)
    VALUES (p_user_id, v_relic.id, 'streak_shield_week:' || v_inserted_days::text);

    RETURN jsonb_build_object(
      'success', true,
      'effect', 'streak_shield_week',
      'protected_days', v_inserted_days,
      'message', 'Simon''s Purse protected up to five upcoming weekdays.'
    );
  END IF;

  UPDATE public.relic_inventory
  SET quantity = quantity - 1
  WHERE id = v_inventory.id;
  INSERT INTO public.denarii_ledger_entries (user_id, amount, source_type, description)
  VALUES (p_user_id, v_talent_denarii, 'relic_reward', 'Master''s Reward: one talent awarded');
  INSERT INTO public.relic_usage_log (user_id, relic_type_id, effect_applied)
  VALUES (p_user_id, v_relic.id, 'grant_one_talent');

  RETURN jsonb_build_object(
    'success', true,
    'effect', 'grant_one_talent',
    'denarii_awarded', v_talent_denarii,
    'message', 'The Master''s Reward awarded one talent.'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.use_relic(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.use_relic(uuid, text) TO authenticated;
