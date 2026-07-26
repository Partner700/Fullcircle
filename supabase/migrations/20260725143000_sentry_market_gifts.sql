CREATE OR REPLACE FUNCTION public.assert_sentry_can_gift_cadet(p_sentry_id uuid, p_cadet_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tent_id uuid;
BEGIN
  SELECT s.tent_id INTO v_tent_id
  FROM public.tent_members s
  JOIN public.tent_members c ON c.tent_id = s.tent_id
  WHERE s.user_id = p_sentry_id
    AND s.role = 'sentry'
    AND c.user_id = p_cadet_id
    AND c.role = 'cadet'
  LIMIT 1;

  IF v_tent_id IS NULL THEN
    RAISE EXCEPTION 'You can only buy gifts for cadets assigned to your tent.';
  END IF;

  RETURN v_tent_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.purchase_relic_for_cadet(
  p_sentry_id uuid,
  p_cadet_id uuid,
  p_relic_slug text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_relic public.relic_types%ROWTYPE;
  v_balance numeric;
  v_existing public.relic_inventory%ROWTYPE;
  v_cadet_name text;
BEGIN
  PERFORM public.assert_sentry_can_gift_cadet(p_sentry_id, p_cadet_id);

  SELECT * INTO v_relic
  FROM public.relic_types
  WHERE slug = p_relic_slug;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Relic not found';
  END IF;

  IF v_relic.denarii_cost IS NULL OR v_relic.denarii_cost <= 0 THEN
    RAISE EXCEPTION '% cannot be bought with denarii.', v_relic.name;
  END IF;

  SELECT COALESCE(SUM(amount), 0) INTO v_balance
  FROM public.denarii_ledger_entries
  WHERE user_id = p_sentry_id;

  IF v_balance < v_relic.denarii_cost THEN
    RAISE EXCEPTION 'Insufficient denarii. You need % but have %.', v_relic.denarii_cost, v_balance;
  END IF;

  SELECT display_name INTO v_cadet_name
  FROM public.profiles
  WHERE id = p_cadet_id;

  INSERT INTO public.denarii_ledger_entries (user_id, amount, source_type, description)
  VALUES (
    p_sentry_id,
    -v_relic.denarii_cost,
    'relic_purchase',
    'Gifted ' || v_relic.name || ' to ' || COALESCE(v_cadet_name, 'cadet')
  );

  SELECT * INTO v_existing
  FROM public.relic_inventory
  WHERE user_id = p_cadet_id
    AND relic_type_id = v_relic.id
  LIMIT 1;

  IF FOUND THEN
    UPDATE public.relic_inventory
    SET quantity = quantity + 1
    WHERE id = v_existing.id;
  ELSE
    INSERT INTO public.relic_inventory (user_id, relic_type_id, quantity, source_description)
    VALUES (p_cadet_id, v_relic.id, 1, 'Gifted by sentry');
  END IF;

  PERFORM public.notify_user(
    p_cadet_id,
    p_sentry_id,
    'relic',
    'Gift received',
    'Your sentry gifted you ' || v_relic.name || '.',
    'store',
    jsonb_build_object('relic_slug', p_relic_slug, 'gifted_by', p_sentry_id)
  );

  RETURN jsonb_build_object('success', true, 'recipient_id', p_cadet_id, 'relic_slug', p_relic_slug);
END;
$$;

CREATE OR REPLACE FUNCTION public.purchase_daily_freezer_for_cadet(
  p_sentry_id uuid,
  p_cadet_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_balance numeric;
  v_cost integer := 500;
  v_cadet_name text;
BEGIN
  PERFORM public.assert_sentry_can_gift_cadet(p_sentry_id, p_cadet_id);

  SELECT COALESCE(SUM(amount), 0) INTO v_balance
  FROM public.denarii_ledger_entries
  WHERE user_id = p_sentry_id;

  IF v_balance < v_cost THEN
    RAISE EXCEPTION 'Insufficient denarii. You need % but have %.', v_cost, v_balance;
  END IF;

  SELECT display_name INTO v_cadet_name
  FROM public.profiles
  WHERE id = p_cadet_id;

  INSERT INTO public.denarii_ledger_entries (user_id, amount, source_type, description)
  VALUES (
    p_sentry_id,
    -v_cost,
    'freezer_daily',
    'Gifted a daily freezer to ' || COALESCE(v_cadet_name, 'cadet')
  );

  INSERT INTO public.streak_freezers (user_id, freezer_type, source)
  VALUES (p_cadet_id, 'daily', 'denarii');

  INSERT INTO public.denarii_purchases (user_id, purchase_type, amount)
  VALUES (p_sentry_id, 'freezer_daily', v_cost);

  PERFORM public.notify_user(
    p_cadet_id,
    p_sentry_id,
    'streak',
    'Freezer gift received',
    'Your sentry gifted you a daily streak freezer.',
    'streak',
    jsonb_build_object('gifted_by', p_sentry_id)
  );

  RETURN jsonb_build_object('success', true, 'recipient_id', p_cadet_id, 'freezer_type', 'daily');
END;
$$;

GRANT EXECUTE ON FUNCTION public.assert_sentry_can_gift_cadet(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.purchase_relic_for_cadet(uuid, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.purchase_daily_freezer_for_cadet(uuid, uuid) TO authenticated;
