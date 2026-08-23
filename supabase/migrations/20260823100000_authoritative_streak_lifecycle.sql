/*
  One authoritative streak lifecycle.

  Earned days and purchased Simon days add exactly one. Ordinary freezers hold
  the existing value without increasing it. Thief's Request and Redemption
  restore dated days. A real eligible miss resets the current streak to zero;
  the streak is never gradually reduced.
*/

CREATE OR REPLACE FUNCTION public.streak_day_is_restored(
  p_user_id uuid,
  p_record_date date
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.streak_freezers restoration
    WHERE restoration.user_id = p_user_id
      AND restoration.applied_to_date IS NOT NULL
      AND p_record_date BETWEEN restoration.applied_to_date
        AND coalesce(restoration.protected_through_date, restoration.applied_to_date)
      AND (
        restoration.source IN ('thiefs_request', 'redemption')
        OR (
          -- Early Thief's Request clients recorded one undated weekly relic
          -- row before the dedicated source value was introduced.
          restoration.source = 'relic'
          AND restoration.freezer_type = 'weekly'
          AND restoration.used_at IS NULL
          AND restoration.expires_at IS NULL
          AND restoration.protection_ends_at IS NULL
        )
      )
  );
$$;

CREATE OR REPLACE FUNCTION public.streak_day_is_purchased(
  p_user_id uuid,
  p_record_date date
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.streak_freezers purchased_day
    WHERE purchased_day.user_id = p_user_id
      AND purchased_day.source IN ('simons_purse', 'simons_coin')
      AND purchased_day.applied_to_date IS NOT NULL
      AND p_record_date BETWEEN purchased_day.applied_to_date
        AND coalesce(purchased_day.protected_through_date, purchased_day.applied_to_date)
  );
$$;

CREATE OR REPLACE FUNCTION public.streak_day_is_protected(
  p_user_id uuid,
  p_record_date date
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.streak_freezers protection
    WHERE protection.user_id = p_user_id
      AND protection.applied_to_date IS NOT NULL
      AND protection.source NOT IN (
        'thiefs_request', 'redemption', 'simons_purse', 'simons_coin'
      )
      AND NOT (
        protection.source = 'relic'
        AND protection.freezer_type = 'weekly'
        AND protection.used_at IS NULL
        AND protection.expires_at IS NULL
        AND protection.protection_ends_at IS NULL
      )
      AND p_record_date BETWEEN protection.applied_to_date
        AND CASE
          WHEN protection.freezer_type = 'weekly' THEN greatest(
            coalesce(protection.protected_through_date, protection.applied_to_date),
            protection.applied_to_date + 6
          )
          ELSE coalesce(protection.protected_through_date, protection.applied_to_date)
        END
  );
$$;

REVOKE ALL ON FUNCTION public.streak_day_is_restored(uuid, date)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.streak_day_is_purchased(uuid, date)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.streak_day_is_protected(uuid, date)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.streak_day_is_restored(uuid, date) TO service_role;
GRANT EXECUTE ON FUNCTION public.streak_day_is_purchased(uuid, date) TO service_role;
GRANT EXECUTE ON FUNCTION public.streak_day_is_protected(uuid, date) TO service_role;

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
  -- Preserve days confirmed before timestamp-based validation was released.
  IF p_record_date < date '2026-08-10' AND EXISTS (
    SELECT 1
    FROM public.daily_records historical
    WHERE historical.user_id = p_user_id
      AND historical.record_date = p_record_date
      AND historical.streak_valid IS TRUE
  ) THEN
    RETURN true;
  END IF;

  -- Sunday is an optional bonus day. Opening before 21:00 adds one day;
  -- leaving it unopened is neutral and never breaks the chain.
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

  -- Saturday is eligible only when a Saturday quiz exists and the user
  -- submits or reaches the server-authoritative timeout.
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
        (
          coalesce(record.attendance_status, 'unmarked') = 'present'
          AND (
            (
              record.attendance_marked_at IS NOT NULL
              AND (record.attendance_marked_at AT TIME ZONE 'Africa/Douala')::time < time '12:00'
            )
            OR (
              p_record_date < date '2026-08-10'
              AND record.attendance_marked_at IS NULL
            )
          )
        )
        OR EXISTS (
          -- This immutable marker is the sentry's earned attendance duty.
          -- Current tent membership must never rewrite historical credit.
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

UPDATE public.relic_types
SET description = CASE slug
      WHEN 'simons-coin' THEN
        'Use one coin to add one purchased streak day on an uncompleted weekday. It cannot double-count a normally earned day.'
      ELSE
        'Adds one purchased streak day for each uncompleted weekday before Saturday. A normally earned day is never counted twice.'
    END,
    denarii_cost = CASE WHEN slug = 'simons-coin' THEN 1000 ELSE denarii_cost END
WHERE slug IN ('simons-coin', 'simons-purse');

CREATE OR REPLACE FUNCTION public.use_simons_coin(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_relic_id uuid;
  v_inventory_id uuid;
  v_today date := timezone('Africa/Douala', now())::date;
BEGIN
  IF auth.uid() IS NULL OR auth.uid() IS DISTINCT FROM p_user_id THEN
    RAISE EXCEPTION 'You can only use your own relics.';
  END IF;

  IF extract(dow FROM v_today) NOT BETWEEN 1 AND 5 THEN
    RETURN jsonb_build_object(
      'success', false,
      'effect', 'streak_coin_day',
      'protected_date', v_today,
      'message', 'Simon''s Coin is used only for an uncompleted weekday.'
    );
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended('full-circle-simons-coin:' || p_user_id::text || ':' || v_today::text, 0)
  );

  IF public.streak_requirement_met(p_user_id, v_today) THEN
    RETURN jsonb_build_object(
      'success', false,
      'effect', 'streak_coin_day',
      'protected_date', v_today,
      'message', 'Today is already earned. Simon''s Coin was not used.'
    );
  END IF;

  IF public.streak_day_is_purchased(p_user_id, v_today) THEN
    RETURN jsonb_build_object(
      'success', false,
      'effect', 'streak_coin_day',
      'protected_date', v_today,
      'message', 'A Simon streak day is already active today. Your coin was not used.'
    );
  END IF;

  SELECT relic.id INTO v_relic_id
  FROM public.relic_types relic
  WHERE relic.slug = 'simons-coin';
  IF v_relic_id IS NULL THEN RAISE EXCEPTION 'Simon''s Coin was not found.'; END IF;

  SELECT inventory.id INTO v_inventory_id
  FROM public.relic_inventory inventory
  WHERE inventory.user_id = p_user_id
    AND inventory.relic_type_id = v_relic_id
    AND inventory.quantity > 0
  FOR UPDATE;
  IF v_inventory_id IS NULL THEN RAISE EXCEPTION 'You do not own Simon''s Coin.'; END IF;

  INSERT INTO public.streak_freezers(
    user_id,
    freezer_type,
    source,
    applied_to_date,
    activated_at,
    protection_ends_at,
    protected_through_date,
    expires_at
  ) VALUES (
    p_user_id,
    'daily',
    'simons_coin',
    v_today,
    now(),
    now() + interval '24 hours',
    v_today,
    v_today + 1
  );

  UPDATE public.relic_inventory inventory
  SET quantity = inventory.quantity - 1
  WHERE inventory.id = v_inventory_id;

  INSERT INTO public.relic_usage_log(user_id, relic_type_id, effect_applied)
  VALUES (p_user_id, v_relic_id, 'streak_coin_day:' || v_today::text);

  RETURN jsonb_build_object(
    'success', true,
    'effect', 'streak_coin_day',
    'protected_date', v_today,
    'message', 'Simon''s Coin added one streak day for today.'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.use_simons_coin(uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.use_simons_coin(uuid) TO authenticated;

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
  v_start date;
  v_check date;
  v_baseline_date date;
  v_baseline_current integer := 0;
  v_baseline_longest integer := 0;
  v_requirement_met boolean := false;
  v_restored boolean := false;
  v_purchased boolean := false;
  v_protected boolean := false;
  v_credited boolean := false;
  v_eligible boolean := false;
  v_current integer := 0;
  v_longest integer := 0;
  v_consecutive integer := 0;
  v_cumulative integer := 0;
BEGIN
  IF p_user_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.profiles profile WHERE profile.id = p_user_id
  ) THEN
    RETURN QUERY SELECT 0, 0, 0, 0;
    RETURN;
  END IF;

  -- A reviewed correction is an explicit value at its effective date. All
  -- later dates are still evaluated, so a true later miss can reset it.
  SELECT
    adjustment.effective_date,
    adjustment.current_streak,
    greatest(adjustment.longest_streak, adjustment.current_streak)
  INTO
    v_baseline_date,
    v_baseline_current,
    v_baseline_longest
  FROM public.streak_manual_adjustments adjustment
  WHERE adjustment.user_id = p_user_id
    AND adjustment.effective_date <= v_today
  ORDER BY adjustment.effective_date DESC
  LIMIT 1;

  IF NOT FOUND THEN
    -- Published positive values are trusted compatibility anchors. Select the
    -- strongest value and its earliest occurrence, then replay every later
    -- day. Real evidence, rather than an unreliable zero snapshot, decides
    -- whether the chain was actually lost.
    SELECT
      snapshot.snapshot_date,
      coalesce(snapshot.current_streak, 0),
      greatest(coalesce(snapshot.longest_streak, 0), coalesce(snapshot.current_streak, 0))
    INTO
      v_baseline_date,
      v_baseline_current,
      v_baseline_longest
    FROM public.streakboard_snapshots snapshot
    WHERE snapshot.user_id = p_user_id
      AND snapshot.snapshot_date < v_today
      AND coalesce(snapshot.current_streak, 0) > 0
    ORDER BY
      coalesce(snapshot.current_streak, 0) DESC,
      snapshot.snapshot_date ASC,
      snapshot.created_at ASC
    LIMIT 1;
  END IF;

  SELECT greatest(
    coalesce(max(greatest(
      coalesce(snapshot.current_streak, 0),
      coalesce(snapshot.longest_streak, 0)
    )), 0),
    v_baseline_longest
  )::integer
  INTO v_longest
  FROM public.streakboard_snapshots snapshot
  WHERE snapshot.user_id = p_user_id;

  SELECT least(
    coalesce((profile.created_at AT TIME ZONE 'Africa/Douala')::date, v_today),
    coalesce((
      SELECT min(record.record_date)
      FROM public.daily_records record
      WHERE record.user_id = p_user_id
    ), v_today),
    coalesce((
      SELECT min(protection.applied_to_date)
      FROM public.streak_freezers protection
      WHERE protection.user_id = p_user_id
        AND protection.applied_to_date IS NOT NULL
    ), v_today),
    coalesce(v_baseline_date, v_today)
  )
  INTO v_start
  FROM public.profiles profile
  WHERE profile.id = p_user_id;

  v_check := coalesce(v_start, v_today);
  WHILE v_check <= v_today LOOP
    IF v_baseline_date IS NOT NULL AND v_check = v_baseline_date THEN
      v_current := v_baseline_current;
      v_longest := greatest(v_longest, v_baseline_longest, v_current);
      v_consecutive := 0;
      v_check := v_check + 1;
      CONTINUE;
    END IF;

    v_requirement_met := public.streak_requirement_met(p_user_id, v_check);
    v_restored := public.streak_day_is_restored(p_user_id, v_check);
    v_purchased := public.streak_day_is_purchased(p_user_id, v_check);
    v_protected := public.streak_day_is_protected(p_user_id, v_check);
    v_credited := v_requirement_met OR v_restored OR v_purchased;

    IF NOT v_credited
      AND NOT v_protected
      AND v_current > 0
      AND extract(dow FROM v_check) BETWEEN 1 AND 5
      AND (v_check < v_today OR v_local_time >= time '21:00')
      AND (v_baseline_date IS NULL OR v_check > v_baseline_date)
    THEN
      v_protected := public.activate_streak_freezer_for_date(p_user_id, v_check);
    END IF;

    v_eligible := CASE
      WHEN extract(dow FROM v_check) = 0 THEN v_credited
      WHEN extract(dow FROM v_check) = 6 THEN EXISTS (
        SELECT 1
        FROM public.quiz_sessions session
        WHERE session.session_date = v_check
          AND session.quiz_type = 'saturday'
      )
      ELSE true
    END;

    IF NOT v_eligible THEN
      v_check := v_check + 1;
      CONTINUE;
    END IF;

    IF v_check = v_today
      AND NOT v_credited
      AND NOT v_protected
      AND v_local_time < time '21:00'
    THEN
      v_check := v_check + 1;
      CONTINUE;
    END IF;

    IF v_credited THEN
      v_current := v_current + 1;
      v_longest := greatest(v_longest, v_current);
      v_consecutive := 0;
    ELSIF v_protected THEN
      -- A freezer holds the number exactly where it was.
      v_consecutive := 0;
    ELSE
      -- Streaks do not count down. A genuine miss resets the current chain.
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
GRANT EXECUTE ON FUNCTION public.compute_strict_streak(uuid)
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_authoritative_streak(p_user_id uuid)
RETURNS TABLE(
  current_streak integer,
  longest_streak integer,
  consecutive_inactive integer,
  cumulative_inactive integer
)
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    streak.current_streak,
    streak.longest_streak,
    streak.consecutive_inactive,
    streak.cumulative_inactive
  FROM public.compute_strict_streak(p_user_id) streak
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.get_authoritative_streak(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_authoritative_streak(uuid)
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_public_quote_streak(p_user_id uuid)
RETURNS TABLE(current_streak integer)
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT coalesce(streak.current_streak, 0)::integer
  FROM public.get_authoritative_streak(p_user_id) streak
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.get_public_streaks(p_user_ids uuid[])
RETURNS TABLE(user_id uuid, current_streak integer)
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    requested.user_id,
    coalesce(streak.current_streak, 0)::integer
  FROM unnest(coalesce(p_user_ids, ARRAY[]::uuid[])) AS requested(user_id)
  LEFT JOIN LATERAL public.get_authoritative_streak(requested.user_id) streak ON true;
$$;

REVOKE ALL ON FUNCTION public.get_public_quote_streak(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_public_streaks(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_public_quote_streak(uuid)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_public_streaks(uuid[])
  TO authenticated, service_role;

-- These wrappers call the live lifecycle and therefore must not advertise a
-- transaction-stable result while evidence or freezer activation can change.
ALTER FUNCTION public.get_my_toolbar_stats_v6() VOLATILE;
ALTER FUNCTION public.get_user_live_stats(uuid) VOLATILE;

CREATE OR REPLACE FUNCTION public.refresh_user_streak_snapshot(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_today date := timezone('Africa/Douala', now())::date;
  v_snapshot_id uuid;
  v_tent_id uuid;
  v_tent_house_id text;
  v_streak record;
BEGIN
  IF p_user_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.profiles profile WHERE profile.id = p_user_id
  ) THEN
    RETURN jsonb_build_object('refreshed', false, 'reason', 'profile_not_found');
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended('full-circle-streak-snapshot:' || p_user_id::text, 0)
  );

  SELECT * INTO v_streak
  FROM public.get_authoritative_streak(p_user_id)
  LIMIT 1;

  SELECT member.tent_id, tent.tent_house_id
  INTO v_tent_id, v_tent_house_id
  FROM public.tent_members member
  LEFT JOIN public.tents tent ON tent.id = member.tent_id
  WHERE member.user_id = p_user_id
  ORDER BY member.joined_at DESC NULLS LAST
  LIMIT 1;

  SELECT snapshot.id INTO v_snapshot_id
  FROM public.streakboard_snapshots snapshot
  WHERE snapshot.user_id = p_user_id
    AND snapshot.snapshot_date = v_today
  ORDER BY snapshot.created_at DESC, snapshot.id DESC
  LIMIT 1
  FOR UPDATE;

  IF v_snapshot_id IS NULL THEN
    INSERT INTO public.streakboard_snapshots(
      snapshot_date,
      user_id,
      tent_id,
      tent_house_id,
      current_streak,
      longest_streak
    ) VALUES (
      v_today,
      p_user_id,
      v_tent_id,
      v_tent_house_id,
      coalesce(v_streak.current_streak, 0),
      coalesce(v_streak.longest_streak, 0)
    )
    RETURNING id INTO v_snapshot_id;
  ELSE
    UPDATE public.streakboard_snapshots snapshot
    SET tent_id = coalesce(v_tent_id, snapshot.tent_id),
        tent_house_id = coalesce(v_tent_house_id, snapshot.tent_house_id),
        current_streak = coalesce(v_streak.current_streak, 0),
        longest_streak = greatest(
          coalesce(snapshot.longest_streak, 0),
          coalesce(v_streak.longest_streak, 0)
        )
    WHERE snapshot.id = v_snapshot_id;
  END IF;

  DELETE FROM public.streakboard_snapshots duplicate
  WHERE duplicate.user_id = p_user_id
    AND duplicate.snapshot_date = v_today
    AND duplicate.id <> v_snapshot_id;

  RETURN jsonb_build_object(
    'refreshed', true,
    'user_id', p_user_id,
    'snapshot_date', v_today,
    'current_streak', coalesce(v_streak.current_streak, 0),
    'longest_streak', coalesce(v_streak.longest_streak, 0)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.refresh_all_streak_snapshots()
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_profile record;
  v_refreshed integer := 0;
BEGIN
  FOR v_profile IN
    SELECT profile.id
    FROM public.profiles profile
    ORDER BY profile.created_at, profile.id
  LOOP
    PERFORM public.refresh_user_streak_snapshot(v_profile.id);
    v_refreshed := v_refreshed + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'refreshed', v_refreshed,
    'snapshot_date', timezone('Africa/Douala', now())::date
  );
END;
$$;

REVOKE ALL ON FUNCTION public.refresh_user_streak_snapshot(uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.refresh_all_streak_snapshots()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_user_streak_snapshot(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.refresh_all_streak_snapshots() TO service_role;

-- The verified values supplied for this repair are the current totals. Anchor
-- them at yesterday's close so a Sunday bonus completed today is counted once
-- and a later completion today can still advance the streak.
WITH target_profiles AS (
  SELECT
    profile.id AS user_id,
    CASE
      WHEN regexp_replace(lower(trim(profile.display_name)), '[^a-z0-9]+', '', 'g') LIKE '%victoire%'
        THEN 27
      WHEN regexp_replace(lower(trim(profile.display_name)), '[^a-z0-9]+', '', 'g') LIKE '%courage%'
        AND regexp_replace(lower(trim(profile.display_name)), '[^a-z0-9]+', '', 'g') LIKE '%webnjoh%'
        THEN 26
      ELSE NULL
    END AS verified_streak
  FROM public.profiles profile
), repaired AS (
  SELECT
    target.user_id,
    timezone('Africa/Douala', now())::date - 1 AS effective_date,
    greatest(
      target.verified_streak - CASE
        WHEN public.streak_requirement_met(target.user_id, timezone('Africa/Douala', now())::date)
          OR public.streak_day_is_restored(target.user_id, timezone('Africa/Douala', now())::date)
          OR public.streak_day_is_purchased(target.user_id, timezone('Africa/Douala', now())::date)
        THEN 1 ELSE 0
      END,
      0
    )::integer AS anchor_streak,
    target.verified_streak
  FROM target_profiles target
  WHERE target.verified_streak IS NOT NULL
)
INSERT INTO public.streak_manual_adjustments(
  user_id,
  effective_date,
  current_streak,
  longest_streak,
  reason
)
SELECT
  repaired.user_id,
  repaired.effective_date,
  repaired.anchor_streak,
  greatest(
    repaired.verified_streak,
    coalesce(existing.longest_streak, 0)
  ),
  CASE repaired.verified_streak
    WHEN 27 THEN 'Restored verified Victoire 27-day streak before canonical lifecycle replay'
    ELSE 'Restored verified Courage Webnjoh 26-day streak before canonical lifecycle replay'
  END
FROM repaired
LEFT JOIN public.streak_manual_adjustments existing
  ON existing.user_id = repaired.user_id
ON CONFLICT (user_id) DO UPDATE
SET effective_date = EXCLUDED.effective_date,
    current_streak = EXCLUDED.current_streak,
    longest_streak = greatest(
      public.streak_manual_adjustments.longest_streak,
      EXCLUDED.longest_streak
    ),
    reason = EXCLUDED.reason,
    created_at = now();

-- Publish the repaired lifecycle for every profile, including Delivette and
-- any other sentry whose duty had been omitted by the regressed rule.
SELECT public.refresh_all_streak_snapshots();

CREATE OR REPLACE FUNCTION public.synchronize_daily_record_streak_valid(
  p_user_id uuid,
  p_record_date date
)
RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_valid boolean;
BEGIN
  IF p_user_id IS NULL OR p_record_date IS NULL THEN RETURN; END IF;

  v_valid := public.streak_requirement_met(p_user_id, p_record_date)
    OR public.streak_day_is_restored(p_user_id, p_record_date)
    OR public.streak_day_is_purchased(p_user_id, p_record_date);

  UPDATE public.daily_records record
  SET streak_valid = v_valid
  WHERE record.user_id = p_user_id
    AND record.record_date = p_record_date
    AND record.streak_valid IS DISTINCT FROM v_valid;
END;
$$;

REVOKE ALL ON FUNCTION public.synchronize_daily_record_streak_valid(uuid, date)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.synchronize_daily_record_streak_valid(uuid, date)
  TO service_role;

-- Bring persisted day badges and instructor completion counts into the same
-- lifecycle. This especially repairs sentry days earned by marking cadets.
UPDATE public.daily_records record
SET streak_valid = (
  public.streak_requirement_met(record.user_id, record.record_date)
  OR public.streak_day_is_restored(record.user_id, record.record_date)
  OR public.streak_day_is_purchased(record.user_id, record.record_date)
)
WHERE record.record_date >= date '2026-08-10'
  AND record.streak_valid IS DISTINCT FROM (
    public.streak_requirement_met(record.user_id, record.record_date)
    OR public.streak_day_is_restored(record.user_id, record.record_date)
    OR public.streak_day_is_purchased(record.user_id, record.record_date)
  );

CREATE OR REPLACE FUNCTION public.refresh_streak_after_daily_record_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid;
  v_marker_id uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_user_id := OLD.user_id;
    v_marker_id := OLD.attendance_marked_by;
  ELSE
    v_user_id := NEW.user_id;
    v_marker_id := NEW.attendance_marked_by;
  END IF;

  -- synchronize_daily_record_streak_valid performs a narrow update on this
  -- table. The nested trigger must stop here to avoid a refresh loop.
  IF pg_trigger_depth() > 1 THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;

  IF TG_OP <> 'DELETE' THEN
    PERFORM public.synchronize_daily_record_streak_valid(
      v_user_id,
      NEW.record_date
    );
    IF v_marker_id IS NOT NULL AND v_marker_id IS DISTINCT FROM v_user_id THEN
      PERFORM public.synchronize_daily_record_streak_valid(
        v_marker_id,
        NEW.record_date
      );
    END IF;
  ELSE
    IF v_marker_id IS NOT NULL AND v_marker_id IS DISTINCT FROM v_user_id THEN
      PERFORM public.synchronize_daily_record_streak_valid(
        v_marker_id,
        OLD.record_date
      );
    END IF;
  END IF;

  PERFORM public.refresh_user_streak_snapshot(v_user_id);
  IF v_marker_id IS NOT NULL AND v_marker_id IS DISTINCT FROM v_user_id THEN
    PERFORM public.refresh_user_streak_snapshot(v_marker_id);
  END IF;

  IF TG_OP = 'UPDATE'
    AND OLD.attendance_marked_by IS NOT NULL
    AND OLD.attendance_marked_by IS DISTINCT FROM NEW.attendance_marked_by
    AND OLD.attendance_marked_by IS DISTINCT FROM v_user_id
  THEN
    PERFORM public.synchronize_daily_record_streak_valid(
      OLD.attendance_marked_by,
      OLD.record_date
    );
    PERFORM public.refresh_user_streak_snapshot(OLD.attendance_marked_by);
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.refresh_streak_after_user_evidence_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_user_id := OLD.user_id;
  ELSE
    v_user_id := NEW.user_id;
  END IF;
  PERFORM public.refresh_user_streak_snapshot(v_user_id);
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.refresh_streak_after_daily_record_change()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.refresh_streak_after_user_evidence_change()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS refresh_streak_after_daily_record_change
  ON public.daily_records;
CREATE TRIGGER refresh_streak_after_daily_record_change
AFTER INSERT OR UPDATE OR DELETE ON public.daily_records
FOR EACH ROW EXECUTE FUNCTION public.refresh_streak_after_daily_record_change();

DROP TRIGGER IF EXISTS refresh_streak_after_quiz_attempt_change
  ON public.quiz_attempts;
CREATE TRIGGER refresh_streak_after_quiz_attempt_change
AFTER INSERT OR UPDATE OR DELETE ON public.quiz_attempts
FOR EACH ROW EXECUTE FUNCTION public.refresh_streak_after_user_evidence_change();

DROP TRIGGER IF EXISTS refresh_streak_after_freezer_change
  ON public.streak_freezers;
CREATE TRIGGER refresh_streak_after_freezer_change
AFTER INSERT OR UPDATE OR DELETE ON public.streak_freezers
FOR EACH ROW EXECUTE FUNCTION public.refresh_streak_after_user_evidence_change();

DROP TRIGGER IF EXISTS refresh_streak_after_manual_adjustment_change
  ON public.streak_manual_adjustments;
CREATE TRIGGER refresh_streak_after_manual_adjustment_change
AFTER INSERT OR UPDATE OR DELETE ON public.streak_manual_adjustments
FOR EACH ROW EXECUTE FUNCTION public.refresh_streak_after_user_evidence_change();

-- Close the day and activate due freezers even when nobody opens the app.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    BEGIN
      PERFORM cron.unschedule('full-circle-streak-snapshots');
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
    PERFORM cron.schedule(
      'full-circle-streak-snapshots',
      '5 20 * * *',
      'SELECT public.refresh_all_streak_snapshots();'
    );
  END IF;
END;
$$;
