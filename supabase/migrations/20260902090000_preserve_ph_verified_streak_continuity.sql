/*
  Preserve verified streak continuity.

  A historical manual restoration was taking precedence over every later
  positive snapshot. Replaying every day after that old anchor could erase a
  genuinely earned current chain when old evidence had been corrected or a
  past quiz session was created later. A recent positive published value is a
  stronger anchor for the days that follow it; actual later misses are still
  replayed and may reset a streak normally.

  PH's 1 September completion is also repaired from the instructor's report:
  the recorded meditation and morning-call evidence are made canonical, then
  the published streak is refreshed from the repaired lifecycle.
*/

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
  v_manual_baseline_date date;
  v_manual_baseline_current integer := 0;
  v_manual_baseline_longest integer := 0;
  v_snapshot_baseline_date date;
  v_snapshot_baseline_current integer := 0;
  v_snapshot_baseline_longest integer := 0;
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

  SELECT
    adjustment.effective_date,
    adjustment.current_streak,
    greatest(adjustment.longest_streak, adjustment.current_streak)
  INTO
    v_manual_baseline_date,
    v_manual_baseline_current,
    v_manual_baseline_longest
  FROM public.streak_manual_adjustments adjustment
  WHERE adjustment.user_id = p_user_id
    AND adjustment.effective_date <= v_today
  ORDER BY adjustment.effective_date DESC, adjustment.created_at DESC
  LIMIT 1;

  /* A later positive snapshot contains a later verified state than an old
     manual repair. Replaying starts after it, so a real later miss still
     resets the chain while stale historical gaps cannot erase it. */
  SELECT
    snapshot.snapshot_date,
    coalesce(snapshot.current_streak, 0),
    greatest(coalesce(snapshot.longest_streak, 0), coalesce(snapshot.current_streak, 0))
  INTO
    v_snapshot_baseline_date,
    v_snapshot_baseline_current,
    v_snapshot_baseline_longest
  FROM public.streakboard_snapshots snapshot
  WHERE snapshot.user_id = p_user_id
    AND snapshot.snapshot_date < v_today
    AND coalesce(snapshot.current_streak, 0) > 0
    AND (
      v_manual_baseline_date IS NULL
      OR snapshot.snapshot_date > v_manual_baseline_date
    )
  ORDER BY snapshot.snapshot_date DESC, snapshot.created_at DESC NULLS LAST, snapshot.id DESC
  LIMIT 1;

  IF v_snapshot_baseline_date IS NOT NULL THEN
    v_baseline_date := v_snapshot_baseline_date;
    v_baseline_current := v_snapshot_baseline_current;
    v_baseline_longest := v_snapshot_baseline_longest;
  ELSE
    v_baseline_date := v_manual_baseline_date;
    v_baseline_current := v_manual_baseline_current;
    v_baseline_longest := v_manual_baseline_longest;
  END IF;

  SELECT greatest(
    coalesce(max(greatest(
      coalesce(snapshot.current_streak, 0),
      coalesce(snapshot.longest_streak, 0)
    )), 0),
    coalesce(v_baseline_longest, 0)
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
GRANT EXECUTE ON FUNCTION public.compute_strict_streak(uuid) TO authenticated, service_role;

DO $$
DECLARE
  v_affected_date date := date '2026-09-01';
  v_ph_user_id uuid;
  v_ph_count integer;
  v_anchor_date date;
  v_anchor_current integer := 0;
  v_anchor_longest integer := 0;
  v_earned_since_anchor integer := 0;
  v_expected_current integer := 0;
  v_live_current integer := 0;
BEGIN
  SELECT count(*)::integer
  INTO v_ph_count
  FROM public.profiles profile
  WHERE regexp_replace(lower(trim(profile.display_name)), '[^a-z0-9]+', '', 'g') = 'ph';

  IF v_ph_count <> 1 THEN
    RAISE EXCEPTION
      'PH streak repair stopped: expected exactly one PH profile, found %.',
      v_ph_count;
  END IF;

  SELECT profile.id
  INTO v_ph_user_id
  FROM public.profiles profile
  WHERE regexp_replace(lower(trim(profile.display_name)), '[^a-z0-9]+', '', 'g') = 'ph'
  LIMIT 1;

  /* The instructor verified that PH met both weekday requirements. Restore a
     late or stale morning-call record without changing any other member. */
  UPDATE public.daily_records record
  SET attendance_status = 'present',
      attendance_marked_at = timestamp '2026-09-01 11:59:59' AT TIME ZONE 'Africa/Douala',
      attendance_late = false,
      streak_valid = true
  WHERE record.user_id = v_ph_user_id
    AND record.record_date = v_affected_date
    AND coalesce(record.meditation_submitted, false)
    AND record.meditation_submitted_at IS NOT NULL
    AND (record.meditation_submitted_at AT TIME ZONE 'Africa/Douala')::time < time '21:00';

  PERFORM public.synchronize_daily_record_streak_valid(v_ph_user_id, v_affected_date);
  PERFORM public.refresh_user_streak_snapshot(v_ph_user_id);

  /* If a previous erroneous reset still leaves the live result below the last
     known positive chain plus verified days, establish a one-time audited
     baseline at the affected date. It never lowers an existing streak. */
  SELECT
    snapshot.snapshot_date,
    snapshot.current_streak,
    greatest(coalesce(snapshot.longest_streak, 0), coalesce(snapshot.current_streak, 0))
  INTO v_anchor_date, v_anchor_current, v_anchor_longest
  FROM public.streakboard_snapshots snapshot
  WHERE snapshot.user_id = v_ph_user_id
    AND snapshot.snapshot_date < v_affected_date
    AND coalesce(snapshot.current_streak, 0) > 0
  ORDER BY snapshot.snapshot_date DESC, snapshot.created_at DESC NULLS LAST, snapshot.id DESC
  LIMIT 1;

  IF v_anchor_date IS NULL THEN
    SELECT
      adjustment.effective_date,
      adjustment.current_streak,
      greatest(adjustment.longest_streak, adjustment.current_streak)
    INTO v_anchor_date, v_anchor_current, v_anchor_longest
    FROM public.streak_manual_adjustments adjustment
    WHERE adjustment.user_id = v_ph_user_id
      AND adjustment.effective_date < v_affected_date
    ORDER BY adjustment.effective_date DESC, adjustment.created_at DESC
    LIMIT 1;
  END IF;

  IF v_anchor_date IS NOT NULL THEN
    SELECT count(*)::integer
    INTO v_earned_since_anchor
    FROM generate_series(
      v_anchor_date + 1,
      v_affected_date,
      interval '1 day'
    ) AS day(record_date)
    WHERE public.streak_requirement_met(v_ph_user_id, day.record_date::date)
      OR public.streak_day_is_restored(v_ph_user_id, day.record_date::date)
      OR public.streak_day_is_purchased(v_ph_user_id, day.record_date::date);

    v_expected_current := v_anchor_current + coalesce(v_earned_since_anchor, 0);

    SELECT coalesce(streak.current_streak, 0)
    INTO v_live_current
    FROM public.get_authoritative_streak(v_ph_user_id) streak
    LIMIT 1;

    IF v_expected_current > v_live_current THEN
      INSERT INTO public.streak_manual_adjustments AS adjustment (
        user_id,
        effective_date,
        current_streak,
        longest_streak,
        reason,
        created_at
      ) VALUES (
        v_ph_user_id,
        v_affected_date,
        v_expected_current,
        greatest(v_anchor_longest, v_expected_current),
        'Restored PH continuity after verified 1 September weekday completion',
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
            WHEN EXCLUDED.current_streak > adjustment.current_streak THEN EXCLUDED.reason
            ELSE adjustment.reason
          END,
          created_at = now();
    END IF;
  END IF;

  PERFORM public.refresh_user_streak_snapshot(v_ph_user_id);
END;
$$;
