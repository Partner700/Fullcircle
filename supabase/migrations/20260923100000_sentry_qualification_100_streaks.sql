-- Raise automatic Sentry qualification from 60 to 100 verified streak days.
-- Existing Sentries keep their role and weekly benefits; this only changes the
-- threshold used for future automatic promotions.

CREATE OR REPLACE FUNCTION public.process_automatic_sentry_promotion(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_today date := timezone('Africa/Douala', statement_timestamp())::date;
  v_week_key text;
  v_streak integer := 0;
  v_figs numeric := 0;
  v_relic_id uuid;
  v_is_sentry boolean := false;
  v_was_promoted boolean := false;
  v_weekly_granted boolean := false;
  v_grant_key text;
  v_grant_rows integer;
BEGIN
  IF auth.uid() IS DISTINCT FROM p_user_id
     AND coalesce(auth.role(), '') <> 'service_role'
     AND current_user <> 'postgres' THEN
    RAISE EXCEPTION 'Only the account owner can process automatic promotion';
  END IF;

  v_week_key := to_char(v_today, 'IYYY-IW');

  SELECT coalesce(current_streak, 0) INTO v_streak
  FROM public.compute_strict_streak(p_user_id) LIMIT 1;

  SELECT EXISTS (
    SELECT 1 FROM public.role_assignments
    WHERE user_id = p_user_id AND role = 'sentry' AND status IN ('active', 'approved')
  ) INTO v_is_sentry;

  SELECT coalesce((SELECT sum(score) FROM public.game_attempts WHERE user_id = p_user_id), 0)
       + coalesce((SELECT sum(talents_scored) FROM public.quiz_attempts WHERE user_id = p_user_id), 0)
       + coalesce((SELECT sum(score) FROM public.arena_participants WHERE user_id = p_user_id), 0)
    INTO v_figs;

  IF NOT v_is_sentry AND (v_streak < 100 OR v_figs <= 10000) THEN
    RETURN jsonb_build_object(
      'eligible', false,
      'streak', v_streak,
      'figs', v_figs,
      'required_streak', 100,
      'required_figs', 10001
    );
  END IF;

  IF NOT v_is_sentry THEN
    UPDATE public.role_assignments
    SET status = 'removed'
    WHERE user_id = p_user_id AND role = 'cadet' AND status IN ('active', 'approved');

    INSERT INTO public.role_assignments(user_id, role, status, approver_id, start_date)
    VALUES (p_user_id, 'sentry', 'active', NULL, v_today)
    ON CONFLICT DO NOTHING;

    v_is_sentry := true;
    v_was_promoted := true;
  END IF;

  SELECT id INTO v_relic_id
  FROM public.relic_types
  WHERE slug = 'masters-reward'
  LIMIT 1;

  IF v_relic_id IS NOT NULL THEN
    IF v_was_promoted THEN
      INSERT INTO public.automatic_sentry_grants(user_id, grant_key)
      VALUES (p_user_id, 'promotion-masters-reward')
      ON CONFLICT DO NOTHING;
      GET DIAGNOSTICS v_grant_rows = ROW_COUNT;
      IF v_grant_rows > 0 THEN
        INSERT INTO public.relic_inventory(user_id, relic_type_id, quantity, source_description)
        VALUES (p_user_id, v_relic_id, 5, 'Automatic Sentry promotion reward')
        ON CONFLICT (user_id, relic_type_id) DO UPDATE
          SET quantity = public.relic_inventory.quantity + 5,
              source_description = EXCLUDED.source_description;
      END IF;
    END IF;

    v_grant_key := 'weekly-masters-reward-' || v_week_key;
    INSERT INTO public.automatic_sentry_grants(user_id, grant_key)
    VALUES (p_user_id, v_grant_key)
    ON CONFLICT DO NOTHING;
    GET DIAGNOSTICS v_grant_rows = ROW_COUNT;
    IF v_grant_rows > 0 THEN
      INSERT INTO public.relic_inventory(user_id, relic_type_id, quantity, source_description)
      VALUES (p_user_id, v_relic_id, 3, 'Weekly Sentry Master''s Reward grant')
      ON CONFLICT (user_id, relic_type_id) DO UPDATE
        SET quantity = public.relic_inventory.quantity + 3,
            source_description = EXCLUDED.source_description;
      v_weekly_granted := true;
    END IF;
  END IF;

  v_grant_key := 'weekly-daily-freezers-' || v_week_key;
  INSERT INTO public.automatic_sentry_grants(user_id, grant_key)
  VALUES (p_user_id, v_grant_key)
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS v_grant_rows = ROW_COUNT;
  IF v_grant_rows > 0 THEN
    INSERT INTO public.streak_freezers(user_id, freezer_type, source)
    SELECT p_user_id, 'daily', 'relic'
    FROM generate_series(1, 3);
    v_weekly_granted := true;
  END IF;

  IF v_was_promoted THEN
    PERFORM public.notify_user(
      p_user_id, NULL, 'promotion', 'You are now a Sentry',
      'Your 100-day reading discipline and 10,000+ figs have earned you Sentry status.',
      'dashboard', '{}'::jsonb
    );
  END IF;

  IF v_weekly_granted THEN
    PERFORM public.notify_user(
      p_user_id, NULL, 'relic_reward', 'Your weekly Sentry benefits are ready',
      'Three Daily Freezers and three Master''s Rewards are reserved for your service this week.',
      'store', jsonb_build_object('week', v_week_key, 'daily_freezers', 3, 'masters_rewards', 3)
    );
  END IF;

  RETURN jsonb_build_object(
    'eligible', true,
    'promoted', v_was_promoted,
    'weekly_granted', v_weekly_granted,
    'streak', v_streak,
    'figs', v_figs,
    'required_streak', 100,
    'required_figs', 10001
  );
END;
$$;

REVOKE ALL ON FUNCTION public.process_automatic_sentry_promotion(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.process_automatic_sentry_promotion(uuid) TO authenticated, service_role;
