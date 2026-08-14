-- Simon's Purse should count a protected weekday immediately, but it must not
-- create an extra streak unit for a day the user has already earned normally.

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
  v_protected_days integer := 0;
  v_row_id uuid;
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

  WHILE v_protected_date < v_saturday AND v_protected_days < 5 LOOP
    IF extract(dow FROM v_protected_date) BETWEEN 1 AND 5
      AND NOT public.streak_requirement_met(p_user_id, v_protected_date) THEN
      SELECT id INTO v_row_id
      FROM public.streak_freezers
      WHERE user_id = p_user_id
        AND applied_to_date = v_protected_date
        AND used_at IS NULL
      ORDER BY CASE WHEN source = 'simons_purse' THEN 0 ELSE 1 END, purchased_at DESC
      LIMIT 1
      FOR UPDATE;

      IF FOUND THEN
        UPDATE public.streak_freezers
        SET source = 'simons_purse',
            freezer_type = 'daily',
            expires_at = v_saturday
        WHERE id = v_row_id;
      ELSE
        INSERT INTO public.streak_freezers (user_id, freezer_type, source, applied_to_date, expires_at)
        VALUES (p_user_id, 'daily', 'simons_purse', v_protected_date, v_saturday);
      END IF;

      v_protected_days := v_protected_days + 1;
    END IF;
    v_protected_date := v_protected_date + 1;
  END LOOP;

  IF v_protected_days = 0 THEN
    RETURN jsonb_build_object(
      'success', false,
      'effect', 'streak_shield_week',
      'protected_days', 0,
      'message', 'No unearned weekday before Saturday needs Simon''s Purse right now. Your relic was not used.'
    );
  END IF;

  UPDATE public.relic_inventory
  SET quantity = quantity - 1
  WHERE id = v_inventory.id;

  INSERT INTO public.relic_usage_log (user_id, relic_type_id, effect_applied)
  VALUES (p_user_id, v_relic.id, 'streak_shield_week:' || v_protected_days::text || ':no_double_day');

  RETURN jsonb_build_object(
    'success', true,
    'effect', 'streak_shield_week',
    'protected_days', v_protected_days,
    'message', 'Simon''s Purse protected ' || v_protected_days || ' unearned weekday(s) before Saturday.'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.activate_simons_purse(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.activate_simons_purse(uuid) TO authenticated;
