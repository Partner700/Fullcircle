/*
  Streak recovery and award-cycle corrections.

  - Thief's Request now scans calendar gaps, including days with no daily record.
  - Redemption Coin restores every eligible historical gap from the join date.
  - Weekly awards use their Monday cycle key, allowing the same recipient next week.
*/

ALTER TABLE public.streak_freezers
  DROP CONSTRAINT IF EXISTS streak_freezers_source_check;

ALTER TABLE public.streak_freezers
  ADD CONSTRAINT streak_freezers_source_check
  CHECK (source IN ('denarii', 'payment', 'relic', 'redemption'));

INSERT INTO public.relic_types (
  slug,
  name,
  description,
  effect,
  effect_type,
  rarity,
  denarii_cost,
  money_price_usd,
  money_price_xaf,
  effect_scope,
  icon
)
VALUES (
  'redemption-coin',
  'Redemption Coin',
  'A denarii-only relic that restores every eligible missed streak day from the day you joined Full Circle. It cannot be bought with real money.',
  'restore_join_streak',
  'restore_join_streak',
  'legendary',
  60000,
  NULL,
  NULL,
  'single_use',
  'coin'
)
ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  effect = EXCLUDED.effect,
  effect_type = EXCLUDED.effect_type,
  rarity = EXCLUDED.rarity,
  denarii_cost = EXCLUDED.denarii_cost,
  money_price_usd = EXCLUDED.money_price_usd,
  money_price_xaf = EXCLUDED.money_price_xaf,
  effect_scope = EXCLUDED.effect_scope,
  icon = EXCLUDED.icon;

CREATE OR REPLACE FUNCTION public.give_award(
  p_user_id uuid,
  p_title text,
  p_description text DEFAULT NULL,
  p_award_type text DEFAULT 'individual',
  p_award_month text DEFAULT NULL,
  p_metric_value numeric DEFAULT NULL,
  p_target_type text DEFAULT 'cadet',
  p_target_id uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
  v_cycle text := COALESCE(NULLIF(p_award_month, ''), to_char(CURRENT_DATE, 'YYYY-MM'));
BEGIN
  IF NOT public.is_instructor(auth.uid()) THEN
    RAISE EXCEPTION 'Only instructors can give awards';
  END IF;

  IF p_title IN (
    'Rhetoric Award (Orator)', 'Messenger Award (Nuncio)', 'Rumor Award',
    'Scribe Award', 'The Sprout', 'Reputation Award', 'Tutorix',
    'Valley Champion', 'The Lord''s Secret'
  ) AND v_cycle !~ '^week-[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN
    v_cycle := 'week-' || to_char(CURRENT_DATE - (extract(isodow FROM CURRENT_DATE)::integer - 1), 'YYYY-MM-DD');
  END IF;

  INSERT INTO public.awards (
    user_id, title, description, award_type, award_month,
    metric_value, award_target_type, award_target_id
  ) VALUES (
    p_user_id, p_title, p_description, p_award_type, v_cycle,
    p_metric_value, p_target_type, COALESCE(p_target_id, p_user_id)
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.award_tent(
  p_tent_id uuid,
  p_title text,
  p_description text DEFAULT NULL,
  p_award_month text DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sentry_id uuid;
  v_cycle text := COALESCE(NULLIF(p_award_month, ''), to_char(CURRENT_DATE, 'YYYY-MM'));
BEGIN
  IF NOT public.is_instructor(auth.uid()) THEN
    RAISE EXCEPTION 'Only instructors can award a tent';
  END IF;

  IF p_title = 'The Lord''s Secret' AND v_cycle !~ '^week-[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN
    v_cycle := 'week-' || to_char(CURRENT_DATE - (extract(isodow FROM CURRENT_DATE)::integer - 1), 'YYYY-MM-DD');
  END IF;

  SELECT sentry_id INTO v_sentry_id
  FROM public.tents
  WHERE id = p_tent_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Tent not found';
  END IF;
  IF v_sentry_id IS NULL THEN
    RAISE EXCEPTION 'Assign a sentry to this tent before giving it an award';
  END IF;

  INSERT INTO public.awards (
    user_id, title, description, award_type, award_month,
    award_target_type, award_target_id
  ) VALUES (
    v_sentry_id, p_title, p_description, 'tent', v_cycle,
    'tent', p_tent_id
  )
  ON CONFLICT (award_month, (COALESCE(award_target_type, 'cadet')), (COALESCE(award_target_id, user_id)), title)
  DO UPDATE SET
    user_id = EXCLUDED.user_id,
    description = EXCLUDED.description,
    award_type = 'tent';

  RETURN 1;
END;
$$;

CREATE OR REPLACE FUNCTION public.use_relic(p_user_id uuid, p_relic_slug text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inv public.relic_inventory%ROWTYPE;
  v_relic public.relic_types%ROWTYPE;
  v_result jsonb;
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
BEGIN
  IF auth.uid() IS DISTINCT FROM p_user_id THEN
    RAISE EXCEPTION 'You can only use your own relics';
  END IF;

  SELECT * INTO v_relic
  FROM public.relic_types
  WHERE slug = p_relic_slug;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Relic not found';
  END IF;

  SELECT * INTO v_inv
  FROM public.relic_inventory
  WHERE user_id = p_user_id AND relic_type_id = v_relic.id AND quantity > 0
  LIMIT 1
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'You do not own this relic';
  END IF;

  SELECT (created_at AT TIME ZONE 'Africa/Douala')::date
  INTO v_join_date
  FROM public.profiles
  WHERE id = p_user_id;
  v_join_date := COALESCE(v_join_date, timezone('Africa/Douala', now())::date);
  v_last_recoverable_date := timezone('Africa/Douala', now())::date
    - CASE WHEN timezone('Africa/Douala', now())::time >= time '21:00' THEN 0 ELSE 1 END;

  IF v_relic.effect_type IN ('revive_lost_streak', 'resurrect_lost_streak') THEN
    WITH eligible_dates AS (
      SELECT day::date AS record_date
      FROM generate_series(v_join_date, v_last_recoverable_date, interval '1 day') AS day
      WHERE extract(dow FROM day) <> 0
    )
    SELECT max(candidate.record_date)
    INTO v_lost_streak_date
    FROM eligible_dates candidate
    WHERE NOT EXISTS (
      SELECT 1 FROM public.streak_freezers saved
      WHERE saved.user_id = p_user_id
        AND saved.used_at IS NULL
        AND saved.applied_to_date = candidate.record_date
    )
      AND EXISTS (
        SELECT 1 FROM public.daily_records prior
        WHERE prior.user_id = p_user_id
          AND prior.record_date < candidate.record_date
          AND (
            COALESCE(prior.streak_valid, false)
            OR (
              COALESCE(prior.meditation_submitted, false)
              AND COALESCE(prior.attendance_status, 'unmarked') = 'present'
            )
          )
      )
      AND (
        (
          extract(dow FROM candidate.record_date) = 6
          AND EXISTS (
            SELECT 1 FROM public.quiz_sessions session
            WHERE session.session_date = candidate.record_date
              AND session.quiz_type = 'saturday'
          )
          AND NOT EXISTS (
            SELECT 1
            FROM public.quiz_attempts attempt
            JOIN public.quiz_sessions session ON session.id = attempt.quiz_session_id
            WHERE attempt.user_id = p_user_id
              AND session.session_date = candidate.record_date
              AND session.quiz_type = 'saturday'
              AND attempt.status IN ('submitted', 'timed_out')
          )
        )
        OR (
          extract(dow FROM candidate.record_date) BETWEEN 1 AND 5
          AND NOT EXISTS (
            SELECT 1 FROM public.daily_records record
            WHERE record.user_id = p_user_id
              AND record.record_date = candidate.record_date
              AND COALESCE(record.meditation_submitted, false)
              AND COALESCE(record.attendance_status, 'unmarked') = 'present'
          )
        )
      );

    IF v_lost_streak_date IS NULL THEN
      RETURN jsonb_build_object(
        'success', false,
        'effect', v_relic.effect_type,
        'streak_revived', false,
        'message', 'No unrepaired lost streak day was found. Your relic was not used.'
      );
    END IF;

    UPDATE public.relic_inventory
    SET quantity = quantity - 1
    WHERE id = v_inv.id;

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

    RETURN jsonb_build_object(
      'success', true,
      'effect', v_relic.effect_type,
      'streak_revived', true,
      'revived_date', v_lost_streak_date,
      'denarii_awarded', CASE WHEN v_relic.effect_type = 'revive_lost_streak' THEN v_retroactive_denarii + v_talent_denarii ELSE 0 END,
      'message', v_relic.name || ' revived the lost streak day of ' || to_char(v_lost_streak_date, 'DD Mon YYYY') || '.'
    );
  END IF;

  IF v_relic.effect_type = 'restore_join_streak' THEN
    FOR v_recover_date IN
      SELECT day::date
      FROM generate_series(v_join_date, v_last_recoverable_date, interval '1 day') AS day
      WHERE extract(dow FROM day) <> 0
        AND NOT EXISTS (
          SELECT 1 FROM public.streak_freezers saved
          WHERE saved.user_id = p_user_id
            AND saved.used_at IS NULL
            AND saved.applied_to_date = day::date
        )
        AND (
          (
            extract(dow FROM day) = 6
            AND EXISTS (
              SELECT 1 FROM public.quiz_sessions session
              WHERE session.session_date = day::date
                AND session.quiz_type = 'saturday'
            )
            AND NOT EXISTS (
              SELECT 1
              FROM public.quiz_attempts attempt
              JOIN public.quiz_sessions session ON session.id = attempt.quiz_session_id
              WHERE attempt.user_id = p_user_id
                AND session.session_date = day::date
                AND session.quiz_type = 'saturday'
                AND attempt.status IN ('submitted', 'timed_out')
            )
          )
          OR (
            extract(dow FROM day) BETWEEN 1 AND 5
            AND NOT EXISTS (
              SELECT 1 FROM public.daily_records record
              WHERE record.user_id = p_user_id
                AND record.record_date = day::date
                AND COALESCE(record.meditation_submitted, false)
                AND COALESCE(record.attendance_status, 'unmarked') = 'present'
            )
          )
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
    WHERE id = v_inv.id;

    RETURN jsonb_build_object(
      'success', true,
      'effect', 'restore_join_streak',
      'restored_days', v_restored_days,
      'message', 'Redemption Coin restored ' || v_restored_days || ' eligible streak day(s) from your Full Circle history.'
    );
  END IF;

  UPDATE public.relic_inventory
  SET quantity = quantity - 1
  WHERE id = v_inv.id;

  IF v_relic.effect_type = 'streak_shield_week' THEN
    v_saturday_date := CURRENT_DATE + ((6 - extract(dow FROM CURRENT_DATE)::integer + 7) % 7);
    IF v_saturday_date = CURRENT_DATE THEN v_saturday_date := CURRENT_DATE + 7; END IF;
    v_protected_date := CURRENT_DATE;
    WHILE v_inserted_days < 5 LOOP
      v_protected_date := v_protected_date + 1;
      EXIT WHEN v_protected_date >= v_saturday_date;
      IF extract(dow FROM v_protected_date) <> 0 THEN
        INSERT INTO public.streak_freezers (user_id, freezer_type, source, applied_to_date, expires_at)
        VALUES (p_user_id, 'daily', 'relic', v_protected_date, v_saturday_date)
        ON CONFLICT DO NOTHING;
        v_inserted_days := v_inserted_days + 1;
      END IF;
    END LOOP;
    RETURN jsonb_build_object('success', true, 'effect', 'streak_shield_week', 'protected_days', v_inserted_days, 'message', 'Simon''s Purse protected up to five upcoming weekdays.');
  END IF;

  IF v_relic.effect_type = 'grant_one_talent' THEN
    INSERT INTO public.denarii_ledger_entries (user_id, amount, source_type, description)
    VALUES (p_user_id, v_talent_denarii, 'relic_reward', 'Master''s Reward: one talent awarded');
    RETURN jsonb_build_object('success', true, 'effect', 'grant_one_talent', 'denarii_awarded', v_talent_denarii, 'message', 'The Master''s Reward awarded one talent.');
  END IF;

  RETURN jsonb_build_object('success', true, 'effect', v_relic.effect_type);
END;
$$;

/* A Redemption Coin may start the restored chain at the join-date gap. */
DO $$
DECLARE
  v_definition text;
  v_original text;
BEGIN
  SELECT pg_get_functiondef('public.compute_strict_streak(uuid)'::regprocedure)
  INTO v_definition;
  v_original := v_definition;
  v_definition := replace(
    v_definition,
    'IF NOT v_complete AND v_current > 0 THEN',
    E'IF NOT v_complete AND (\n      v_current > 0\n      OR EXISTS (\n        SELECT 1 FROM public.streak_freezers redemption\n        WHERE redemption.user_id = p_user_id\n          AND redemption.source = ''redemption''\n          AND redemption.used_at IS NULL\n          AND redemption.applied_to_date = v_check\n      )\n    ) THEN'
  );
  IF v_definition IS DISTINCT FROM v_original THEN
    EXECUTE v_definition;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.give_award(uuid, text, text, text, text, numeric, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.award_tent(uuid, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.use_relic(uuid, text) TO authenticated;
