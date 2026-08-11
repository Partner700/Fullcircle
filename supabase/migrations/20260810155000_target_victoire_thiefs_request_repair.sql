/*
  Targeted Thief's Request repair for Victoire Ebo.

  The broad historical repair covered the normal ledger/log shapes. Victoire's
  account still needs the same restoration, so this migration finds her profile
  by name and restores every eligible missed streak day up to her latest
  Thief's Request use. It intentionally does nothing if no matching profile or
  relic-use evidence exists.
*/

DO $$
DECLARE
  v_user_id uuid;
  v_join_date date;
  v_cutoff_date date;
  v_restore_date date;
BEGIN
  SELECT profile.id
  INTO v_user_id
  FROM public.profiles profile
  WHERE profile.display_name ILIKE '%victoire%'
    AND profile.display_name ILIKE '%ebo%'
  ORDER BY profile.created_at DESC
  LIMIT 1;

  IF v_user_id IS NULL THEN
    RETURN;
  END IF;

  SELECT (profile.created_at AT TIME ZONE 'Africa/Douala')::date
  INTO v_join_date
  FROM public.profiles profile
  WHERE profile.id = v_user_id;

  SELECT max(use_time)::date
  INTO v_cutoff_date
  FROM (
    SELECT ledger.created_at AT TIME ZONE 'Africa/Douala' AS use_time
    FROM public.denarii_ledger_entries ledger
    WHERE ledger.user_id = v_user_id
      AND ledger.source_type = 'relic_reward'
      AND ledger.description ILIKE '%Thief''s Request%'

    UNION ALL

    SELECT log.created_at AT TIME ZONE 'Africa/Douala' AS use_time
    FROM public.relic_usage_log log
    JOIN public.relic_types relic ON relic.id = log.relic_type_id
    WHERE log.user_id = v_user_id
      AND (
        relic.slug = 'thieves-request'
        OR log.effect_applied ILIKE '%revive_lost_streak%'
        OR log.effect_applied ILIKE '%resurrect_lost_streak%'
      )
  ) uses;

  IF v_join_date IS NULL OR v_cutoff_date IS NULL OR v_cutoff_date < v_join_date THEN
    RETURN;
  END IF;

  FOR v_restore_date IN
    SELECT day::date
    FROM generate_series(v_join_date, v_cutoff_date, interval '1 day') AS day
    WHERE (
      extract(dow FROM day) BETWEEN 1 AND 5
      OR (
        extract(dow FROM day) = 6
        AND EXISTS (
          SELECT 1
          FROM public.quiz_sessions session
          WHERE session.session_date = day::date
            AND session.quiz_type = 'saturday'
        )
      )
    )
    AND NOT public.streak_requirement_met(v_user_id, day::date)
    AND NOT EXISTS (
      SELECT 1
      FROM public.streak_freezers protected
      WHERE protected.user_id = v_user_id
        AND protected.used_at IS NULL
        AND protected.applied_to_date = day::date
    )
    ORDER BY day::date
  LOOP
    INSERT INTO public.streak_freezers (user_id, freezer_type, source, applied_to_date)
    VALUES (v_user_id, 'weekly', 'relic', v_restore_date);
  END LOOP;
END;
$$;
