/*
  Include the 27 August earned day in the three instructor-verified repairs.

  The first restoration reinstated each pre-loss chain. The instructor has
  now confirmed that today's qualifying day must also be counted, producing
  Linda Karen 30, Geraldine 5, and Sentinel Vedette 30. These are minimum
  verified values: a stronger value already in production is never lowered.
*/

DO $$
DECLARE
  v_today date := timezone('Africa/Douala', now())::date;
  v_target record;
  v_target_count integer;
  v_updated_count integer := 0;
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
      'Streak advancement stopped: expected exactly Linda Karen, Geraldine, and Sentinel Vedette; found % account(s).',
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
        WHEN 'opondelindakarenb' THEN 30
        WHEN 'geraldine' THEN 5
        WHEN 'sentinelvedette' THEN 30
      END::integer AS verified_streak
    FROM public.profiles profile
    WHERE regexp_replace(
      lower(trim(profile.display_name)),
      '[^a-z0-9]+',
      '',
      'g'
    ) IN ('opondelindakarenb', 'geraldine', 'sentinelvedette')
    ORDER BY profile.id
  LOOP
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
      v_target.verified_streak,
      v_target.verified_streak,
      'Instructor-verified 27 August earned day added after unjust streak reset',
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
          adjustment.current_streak,
          EXCLUDED.longest_streak,
          EXCLUDED.current_streak
        ),
        reason = EXCLUDED.reason,
        created_at = now();

    PERFORM public.record_verified_streak_restoration(
      v_target.user_id,
      v_today,
      'Instructor confirmed the qualifying 27 August activity after an unjust lifecycle reset',
      NULL
    );
    PERFORM public.refresh_user_streak_snapshot(v_target.user_id);
    v_updated_count := v_updated_count + 1;
  END LOOP;

  IF v_updated_count <> 3 THEN
    RAISE EXCEPTION
      'Streak advancement rolled back: expected 3 refreshed accounts, refreshed %.',
      v_updated_count;
  END IF;
END;
$$;
