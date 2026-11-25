-- Server-authoritative cash purchase options: Daily Freezer 300 XAF; Weekly Freezer 500 XAF.
-- Fapshi cart keeps its own price validation. Deliver only after verified payment.
-- Idempotent finalization is guarded by the locked payment status.
CREATE OR REPLACE FUNCTION public.reserve_fapshi_cart(p_user_id uuid, p_reference text, p_phone text, p_method text, p_displayed_amount numeric, p_relics jsonb, p_event_id uuid, p_ticket_quantity integer, p_xaf_per_usd numeric, p_gift_recipient_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  event public.fcx_events%ROWTYPE;
  payment public.mobile_money_payments%ROWTYPE;
  lines jsonb;
  total numeric;
  line_count integer;
  distinct_count integer;
  v_daily_freezers integer := 0;
  v_weekly_freezers integer := 0;
BEGIN
  IF p_method IS NULL OR p_method NOT IN ('mtn_momo', 'orange_money')
    OR p_ticket_quantity IS NULL OR p_ticket_quantity < 0
    OR (p_event_id IS NULL) <> (p_ticket_quantity = 0)
    OR jsonb_typeof(p_relics) IS DISTINCT FROM 'array'
    OR p_xaf_per_usd IS NULL OR p_xaf_per_usd <= 0 THEN
    RAISE EXCEPTION 'Review your cart and try again.';
  END IF;
  SELECT count(*), count(DISTINCT (slug, coalesce(pack_size, 1))) INTO line_count, distinct_count
  FROM jsonb_to_recordset(p_relics) AS item(slug text, quantity integer, pack_size integer);
  IF line_count <> distinct_count OR EXISTS (
    SELECT 1 FROM jsonb_to_recordset(p_relics) AS item(slug text, quantity integer, pack_size integer)
    WHERE quantity IS NULL OR quantity < 1 OR coalesce(pack_size, 1) < 1
  ) THEN RAISE EXCEPTION 'Review the quantities in your cart.'; END IF;

  -- Fixed-price streak protection is a separate catalogue item, not a
  -- relic: it is delivered to streak_freezers after payment confirmation.
  IF EXISTS (
    SELECT 1 FROM jsonb_to_recordset(p_relics) AS item(slug text,quantity integer,pack_size integer)
    WHERE item.slug IN ('streak-freezer-daily','streak-freezer-weekly')
      AND coalesce(item.pack_size,1) <> 1
  ) THEN RAISE EXCEPTION 'Freezers are sold individually in this offer.'; END IF;
  SELECT coalesce(sum(item.quantity) FILTER (WHERE item.slug='streak-freezer-daily'),0),
         coalesce(sum(item.quantity) FILTER (WHERE item.slug='streak-freezer-weekly'),0)
  INTO v_daily_freezers,v_weekly_freezers
  FROM jsonb_to_recordset(p_relics) AS item(slug text,quantity integer,pack_size integer);
  IF v_daily_freezers > 50 OR v_weekly_freezers > 50 THEN
    RAISE EXCEPTION 'Reduce the quantity of freezers and try again.';
  END IF;
  IF (v_daily_freezers > 0 OR v_weekly_freezers > 0)
     AND p_gift_recipient_id IS NOT NULL AND p_gift_recipient_id <> p_user_id THEN
    RAISE EXCEPTION 'Cash Freezers are currently available for your own account.';
  END IF;

  WITH priced AS MATERIALIZED (
    SELECT relic.id AS relic_id, item.quantity, coalesce(item.pack_size, 1) AS pack_size,
      CASE
        WHEN coalesce(item.pack_size, 1) = 1 AND relic.money_price_xaf > 0 THEN round(relic.money_price_xaf)
        WHEN coalesce(item.pack_size, 1) = 1 AND relic.money_price_usd > 0 THEN round(relic.money_price_usd * p_xaf_per_usd)
        ELSE (relic.cash_bundles->>item.pack_size::text)::numeric
      END AS pack_xaf
    FROM jsonb_to_recordset(p_relics) AS item(slug text, quantity integer, pack_size integer)
    JOIN public.relic_types relic ON relic.slug = item.slug AND relic.is_active
    FOR KEY SHARE OF relic
  ), grouped AS (
    SELECT relic_id, sum(quantity::bigint * pack_size) AS quantity,
      sum(pack_xaf * quantity) AS subtotal, count(*) AS matching_lines
    FROM priced WHERE pack_xaf > 0 GROUP BY relic_id
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object('relic_id', relic_id, 'quantity', quantity,
      'subtotal_xaf', subtotal) ORDER BY relic_id), '[]'::jsonb),
    coalesce(sum(subtotal), 0), coalesce(sum(matching_lines), 0)
  INTO lines, total, distinct_count FROM grouped;
  IF distinct_count + (v_daily_freezers > 0)::integer + (v_weekly_freezers > 0)::integer <> line_count THEN
    RAISE EXCEPTION 'One or more relic offers are no longer available. Review your cart.';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_to_recordset(lines) AS line(quantity bigint) WHERE quantity > 2147483647) THEN
    RAISE EXCEPTION 'Reduce the quantity of relics and try again.';
  END IF;

  total := total + v_daily_freezers * 300 + v_weekly_freezers * 500;

  IF p_event_id IS NOT NULL THEN
    SELECT * INTO event FROM public.fcx_events WHERE id = p_event_id AND is_active FOR UPDATE;
    IF NOT FOUND OR event.event_date IS NULL OR event.event_date < timezone('Africa/Douala', now())::date
       OR event.ticket_price_xaf IS NULL OR event.ticket_price_xaf < 300 THEN
      RAISE EXCEPTION 'This FCX edition is no longer open for mobile money purchases.';
    END IF;
    IF (SELECT count(*) FROM public.fcx_registrations WHERE event_id = event.id)
      + public.fcx_pending_paid_spots(event.id) + p_ticket_quantity > event.capacity THEN
      RAISE EXCEPTION 'There are fewer FCX spots available than requested.';
    END IF;
    total := total + event.ticket_price_xaf * p_ticket_quantity;
  END IF;
  IF total < 100 OR total <> trunc(total) OR total IS DISTINCT FROM p_displayed_amount THEN
    RAISE EXCEPTION 'The cart total changed or is below 100 FCFA. Review your cart and try again.';
  END IF;

  IF p_gift_recipient_id IS NOT NULL AND p_gift_recipient_id <> p_user_id THEN
    PERFORM public.assert_cash_gift_recipient(p_user_id, p_gift_recipient_id);
  END IF;

  INSERT INTO public.mobile_money_payments(user_id, relic_slug, relic_name, purchase_kind, purchase_metadata,
    amount_usd, amount_local, currency_code, provider, sender_phone, status, reference, external_reference, payment_method)
  VALUES(p_user_id, p_reference, 'Market cart', 'cart',
    jsonb_build_object('relics', lines, 'freezer_daily_quantity', v_daily_freezers, 'freezer_weekly_quantity', v_weekly_freezers,
      'event_id', p_event_id, 'ticket_quantity', p_ticket_quantity, 'gift_recipient_id', CASE WHEN p_gift_recipient_id <> p_user_id THEN p_gift_recipient_id ELSE NULL END),
    round(total / p_xaf_per_usd, 2), total, 'XAF', 'Fapshi', p_phone, 'pending', p_reference, p_reference, p_method)
  RETURNING * INTO payment;
  RETURN jsonb_build_object('id', payment.id, 'amount', payment.amount_local);
END;
$function$
;
CREATE OR REPLACE FUNCTION public.finalize_fapshi_cart(p_payment_id uuid, p_provider_reference text, p_verified_amount numeric, p_verified_currency text, p_verification jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  payment public.mobile_money_payments%ROWTYPE;
  cart_event uuid;
  ticket_quantity integer;
  guest_quantity integer;
  attendee uuid;
BEGIN
  SELECT * INTO payment FROM public.mobile_money_payments WHERE id = p_payment_id AND purchase_kind = 'cart' FOR UPDATE;
  IF NOT FOUND OR p_verified_amount IS DISTINCT FROM payment.amount_local
    OR p_verified_currency IS DISTINCT FROM payment.currency_code OR p_verified_currency IS DISTINCT FROM 'XAF'
    OR nullif(p_provider_reference, '') IS NULL
    OR (payment.provider_reference IS NOT NULL AND payment.provider_reference <> p_provider_reference)
    OR p_verification->>'provider' IS DISTINCT FROM 'fapshi'
    OR p_verification->>'externalId' IS DISTINCT FROM payment.reference
    OR p_verification->>'status' IS DISTINCT FROM 'SUCCESSFUL' THEN
    RAISE EXCEPTION 'Verified Fapshi payment does not match this cart.';
  END IF;
  IF payment.status = 'confirmed' THEN RETURN jsonb_build_object('status', 'confirmed'); END IF;
  IF payment.status <> 'pending' THEN RAISE EXCEPTION 'This cart payment is no longer pending.'; END IF;

  cart_event := (payment.purchase_metadata->>'event_id')::uuid;
  ticket_quantity := (payment.purchase_metadata->>'ticket_quantity')::integer;
  guest_quantity := ticket_quantity;
  IF cart_event IS NOT NULL THEN
    PERFORM 1 FROM public.fcx_events WHERE id = cart_event FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'FCX event not found.'; END IF;
  END IF;

  UPDATE public.mobile_money_payments SET status = 'confirmed', confirmed_at = now(),
    provider_reference = p_provider_reference, verified_amount_local = p_verified_amount,
    verified_currency_code = p_verified_currency, provider_verification = p_verification
  WHERE id = p_payment_id;

  INSERT INTO public.relic_inventory(user_id, relic_type_id, quantity, source_description)
  SELECT coalesce((payment.purchase_metadata->>'gift_recipient_id')::uuid, payment.user_id), item.relic_id, item.quantity, 'Confirmed Fapshi cart'
  FROM jsonb_to_recordset(payment.purchase_metadata->'relics') AS item(relic_id uuid, quantity integer)
  ORDER BY item.relic_id
  ON CONFLICT (user_id, relic_type_id) DO UPDATE
    SET quantity = public.relic_inventory.quantity + EXCLUDED.quantity;

  -- The parent payment row is locked, status is marked confirmed, and
  -- all item delivery is transactional. Repeated webhook events cannot
  -- deliver the same Freezers twice.
  INSERT INTO public.streak_freezers(user_id,freezer_type,source)
  SELECT payment.user_id,'daily','payment'
  FROM generate_series(1,coalesce((payment.purchase_metadata->>'freezer_daily_quantity')::integer,0));
  INSERT INTO public.streak_freezers(user_id,freezer_type,source)
  SELECT payment.user_id,'weekly','payment'
  FROM generate_series(1,coalesce((payment.purchase_metadata->>'freezer_weekly_quantity')::integer,0));

  IF cart_event IS NOT NULL AND payment.purchase_metadata ? 'attendee_kind' THEN
    attendee := (payment.purchase_metadata->>'attendee_id')::uuid;
    IF attendee IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.fcx_registrations WHERE event_id = cart_event AND user_id = attendee
    ) THEN
      INSERT INTO public.fcx_registrations(event_id, user_id, payment_source, added_by)
      VALUES(cart_event, attendee, 'app', payment.user_id);
    ELSE
      INSERT INTO public.fcx_registrations(event_id, guest_name, payment_source, added_by)
      VALUES(cart_event, 'Paid FCX spot ' || payment.id || ' / 1', 'app', payment.user_id);
    END IF;
  ELSIF cart_event IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM public.fcx_registrations WHERE event_id = cart_event AND user_id = payment.user_id)
       AND NOT EXISTS (SELECT 1 FROM public.mobile_money_payments WHERE purchase_kind = 'fcx_ticket'
         AND status = 'pending' AND user_id = payment.user_id AND purchase_metadata->>'event_id' = cart_event::text) THEN
      INSERT INTO public.fcx_registrations(event_id, user_id, payment_source, added_by)
      VALUES(cart_event, payment.user_id, 'app', payment.user_id);
      guest_quantity := guest_quantity - 1;
    END IF;
    INSERT INTO public.fcx_registrations(event_id, guest_name, payment_source, added_by)
    SELECT cart_event, 'Paid FCX spot ' || payment.id || ' / ' || spot, 'app', payment.user_id
    FROM generate_series(1, guest_quantity) AS spot;
  END IF;
  RETURN jsonb_build_object('status', 'confirmed');
END;
$function$
;
