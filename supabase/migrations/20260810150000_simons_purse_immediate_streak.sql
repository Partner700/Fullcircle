/*
  Simon's Purse grants its first weekday immediately and makes each remaining
  protected weekday count from the beginning of that day. Saturday's quiz and
  Sunday remain outside the relic's effect.
*/

ALTER TABLE public.streak_freezers
  DROP CONSTRAINT IF EXISTS streak_freezers_source_check;

ALTER TABLE public.streak_freezers
  ADD CONSTRAINT streak_freezers_source_check
  CHECK (source IN ('denarii', 'payment', 'relic', 'redemption', 'simons_purse'));

UPDATE public.relic_types
SET description = 'Grants today''s streak immediately, then grants the streak at the beginning of each protected weekday until Saturday, for up to five weekdays. It does not cover Saturday or Sunday.'
WHERE slug = 'simons-purse';

CREATE OR REPLACE FUNCTION public.activate_simons_purse(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inventory public.relic_inventory%ROWTYPE;
  v_relic public.relic_types%ROWTYPE;
  v_today date := timezone('Africa/Douala', now())::date;
  v_saturday date;
  v_protected_date date;
  v_inserted_days integer := 0;
  v_row_count integer := 0;
BEGIN
  IF auth.uid() IS NULL OR auth.uid() IS DISTINCT FROM p_user_id THEN
    RAISE EXCEPTION 'You can only use your own relics.';
  END IF;

  SELECT * INTO v_relic
  FROM public.relic_types
  WHERE slug = 'simons-purse';
  IF NOT FOUND THEN RAISE EXCEPTION 'Simon''s Purse was not found.'; END IF;

  SELECT * INTO v_inventory
  FROM public.relic_inventory
  WHERE user_id = p_user_id
    AND relic_type_id = v_relic.id
    AND quantity > 0
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'You do not own Simon''s Purse.'; END IF;

  v_saturday := v_today + ((6 - extract(dow FROM v_today)::integer + 7) % 7);
  IF v_saturday = v_today THEN v_saturday := v_today + 7; END IF;
  v_protected_date := v_today;

  WHILE v_protected_date < v_saturday AND v_inserted_days < 5 LOOP
    IF extract(dow FROM v_protected_date) BETWEEN 1 AND 5 THEN
      INSERT INTO public.streak_freezers (
        user_id,
        freezer_type,
        source,
        applied_to_date,
        expires_at
      )
      SELECT
        p_user_id,
        'daily',
        'simons_purse',
        v_protected_date,
        v_saturday
      WHERE NOT EXISTS (
        SELECT 1
        FROM public.streak_freezers existing
        WHERE existing.user_id = p_user_id
          AND existing.source = 'simons_purse'
          AND existing.used_at IS NULL
          AND existing.applied_to_date = v_protected_date
      );
      GET DIAGNOSTICS v_row_count = ROW_COUNT;
      v_inserted_days := v_inserted_days + v_row_count;
    END IF;
    v_protected_date := v_protected_date + 1;
  END LOOP;

  IF v_inserted_days = 0 THEN
    RETURN jsonb_build_object(
      'success', false,
      'effect', 'streak_shield_week',
      'protected_days', 0,
      'message', 'This week is already protected. Your relic was not used.'
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
    'message', 'Simon''s Purse granted today''s streak immediately and protects each remaining weekday from the beginning of the day.'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.activate_simons_purse(uuid) FROM PUBLIC, anon, authenticated;

DO $$
DECLARE
  v_definition text;
  v_auth_guard text := $guard$IF auth.uid() IS NULL OR auth.uid() IS DISTINCT FROM p_user_id THEN
    RAISE EXCEPTION 'You can only use your own relics.';
  END IF;$guard$;
BEGIN
  SELECT pg_get_functiondef('public.use_relic(uuid,text)'::regprocedure)
  INTO v_definition;

  IF position(v_auth_guard IN v_definition) = 0 THEN
    RAISE EXCEPTION 'Relic activation function has an unexpected definition.';
  END IF;

  v_definition := replace(
    v_definition,
    v_auth_guard,
    v_auth_guard || E'\n\n  IF p_relic_slug = ''simons-purse'' THEN\n    RETURN public.activate_simons_purse(p_user_id);\n  END IF;'
  );
  EXECUTE v_definition;
END;
$$;

DO $$
DECLARE
  v_definition text;
  v_old_skip text := 'IF v_check = v_today AND NOT v_complete AND v_local_time < time ''21:00'' THEN';
  v_new_skip text := $replacement$IF v_check = v_today
        AND NOT v_complete
        AND v_local_time < time '21:00'
        AND NOT EXISTS (
          SELECT 1
          FROM public.streak_freezers simons_day
          WHERE simons_day.user_id = p_user_id
            AND simons_day.source = 'simons_purse'
            AND simons_day.used_at IS NULL
            AND simons_day.applied_to_date = v_check
            AND (simons_day.expires_at IS NULL OR simons_day.expires_at::date >= v_check)
        ) THEN$replacement$;
BEGIN
  SELECT pg_get_functiondef('public.compute_strict_streak(uuid)'::regprocedure)
  INTO v_definition;

  IF position(v_old_skip IN v_definition) = 0
    OR position('redemption.source = ''redemption''' IN v_definition) = 0
  THEN
    RAISE EXCEPTION 'Strict streak calculator has an unexpected definition.';
  END IF;

  v_definition := replace(v_definition, v_old_skip, v_new_skip);
  v_definition := replace(
    v_definition,
    'redemption.source = ''redemption''',
    'redemption.source IN (''redemption'', ''simons_purse'')'
  );
  EXECUTE v_definition;
END;
$$;

DO $$
DECLARE
  v_definition text;
BEGIN
  SELECT pg_get_functiondef('public.find_latest_recoverable_streak_gap(uuid,date)'::regprocedure)
  INTO v_definition;

  IF position('redemption.source = ''redemption''' IN v_definition) = 0 THEN
    RAISE EXCEPTION 'Recoverable streak-gap calculator has an unexpected definition.';
  END IF;

  v_definition := replace(
    v_definition,
    'redemption.source = ''redemption''',
    'redemption.source IN (''redemption'', ''simons_purse'')'
  );
  EXECUTE v_definition;
END;
$$;
