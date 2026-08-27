/*
  Restore three streaks verified from the live public board on 27 August 2026.

  Linda Karen, Geraldine, and Sentinel Vedette all had a positive published
  chain before the lifecycle replay replaced the current value with zero. The
  verified floors below are their last visible earned totals. Any stronger
  value already present in an adjustment or snapshot wins, so this repair can
  never lower an account and remains safe to re-run.

  Dating the adjustment today restores continuity immediately. Tomorrow and
  every later day return to the ordinary evidence-based lifecycle: an earned
  day adds one, a freezer holds, and a genuine miss resets the chain.
*/

DO $$
DECLARE
  v_today date := timezone('Africa/Douala', now())::date;
  v_target record;
  v_target_count integer;
  v_restored_count integer := 0;
  v_restored_streak integer;
  v_restored_longest integer;
BEGIN
  SELECT count(*)::integer
  INTO v_target_count
  FROM public.profiles profile
  WHERE regexp_replace(
    lower(trim(profile.display_name)),
    '[^a-z0-9]+',
    '',
    'g'
  ) IN ('opondelindakarenb', 'geraldine', 'sentinelvedette');

  IF v_target_count <> 3 THEN
    RAISE EXCEPTION
      'Streak restoration stopped: expected exactly Linda Karen, Geraldine, and Sentinel Vedette; found % account(s).',
      v_target_count;
  END IF;

  FOR v_target IN
    SELECT
      profile.id AS user_id,
      profile.display_name,
      CASE regexp_replace(
        lower(trim(profile.display_name)),
        '[^a-z0-9]+',
        '',
        'g'
      )
        WHEN 'opondelindakarenb' THEN 29
        WHEN 'geraldine' THEN 4
        WHEN 'sentinelvedette' THEN 29
      END::integer AS verified_floor
    FROM public.profiles profile
    WHERE regexp_replace(
      lower(trim(profile.display_name)),
      '[^a-z0-9]+',
      '',
      'g'
    ) IN ('opondelindakarenb', 'geraldine', 'sentinelvedette')
    ORDER BY profile.id
  LOOP
    SELECT greatest(
      v_target.verified_floor,
      coalesce((
        SELECT max(greatest(
          coalesce(snapshot.current_streak, 0),
          coalesce(snapshot.longest_streak, 0)
        ))::integer
        FROM public.streakboard_snapshots snapshot
        WHERE snapshot.user_id = v_target.user_id
          AND snapshot.snapshot_date <= v_today
      ), 0),
      coalesce((
        SELECT greatest(
          adjustment.current_streak,
          adjustment.longest_streak
        )
        FROM public.streak_manual_adjustments adjustment
        WHERE adjustment.user_id = v_target.user_id
      ), 0)
    )::integer
    INTO v_restored_streak;

    SELECT greatest(
      v_restored_streak,
      coalesce((
        SELECT max(coalesce(snapshot.longest_streak, 0))::integer
        FROM public.streakboard_snapshots snapshot
        WHERE snapshot.user_id = v_target.user_id
      ), 0),
      coalesce((
        SELECT adjustment.longest_streak
        FROM public.streak_manual_adjustments adjustment
        WHERE adjustment.user_id = v_target.user_id
      ), 0)
    )::integer
    INTO v_restored_longest;

    INSERT INTO public.streak_manual_adjustments AS adjustment (
      user_id,
      effective_date,
      current_streak,
      longest_streak,
      reason,
      created_at
    ) VALUES (
      v_target.user_id,
      v_today,
      v_restored_streak,
      v_restored_longest,
      'Instructor-verified restoration after an unjust lifecycle reset on 2026-08-27',
      now()
    )
    ON CONFLICT (user_id) DO UPDATE
    SET effective_date = EXCLUDED.effective_date,
        current_streak = greatest(
          adjustment.current_streak,
          EXCLUDED.current_streak
        ),
        longest_streak = greatest(
          adjustment.longest_streak,
          EXCLUDED.longest_streak,
          adjustment.current_streak,
          EXCLUDED.current_streak
        ),
        reason = EXCLUDED.reason,
        created_at = now();

    PERFORM public.refresh_user_streak_snapshot(v_target.user_id);
    v_restored_count := v_restored_count + 1;
  END LOOP;

  IF v_restored_count <> 3 THEN
    RAISE EXCEPTION
      'Streak restoration rolled back: expected 3 refreshed accounts, refreshed %.',
      v_restored_count;
  END IF;
END;
$$;
