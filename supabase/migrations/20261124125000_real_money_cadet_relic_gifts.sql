-- Full Circle: pay for a relic as another cadet's gift. The buyer remains
-- the authenticated payer; delivery is redirected only after provider verification.
-- Preserve client compatibility: the new last parameter is optional.
DROP FUNCTION IF EXISTS public.reserve_fapshi_cart(uuid,text,text,text,numeric,jsonb,uuid,integer,numeric);
CREATE OR REPLACE FUNCTION public.assert_cash_gift_recipient(p_buyer uuid, p_recipient uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  IF p_buyer IS NULL OR p_recipient IS NULL OR p_buyer=p_recipient
     OR NOT EXISTS (SELECT 1 FROM public.role_assignments r WHERE r.user_id=p_recipient AND r.role='cadet' AND r.status='active')
  THEN RAISE EXCEPTION 'Select an active cadet to receive this gift.'; END IF;
  IF EXISTS (SELECT 1 FROM public.role_assignments r WHERE r.user_id=p_buyer AND r.role='cadet' AND r.status='active')
  THEN RETURN; END IF;
  IF EXISTS (
    SELECT 1 FROM public.role_assignments r
    JOIN public.tent_members sm ON sm.user_id=p_buyer AND sm.role='sentry'
    JOIN public.tent_members cm ON cm.tent_id=sm.tent_id AND cm.user_id=p_recipient AND cm.role='cadet'
    WHERE r.user_id=p_buyer AND r.role='sentry' AND r.status='active'
  ) THEN RETURN; END IF;
  RAISE EXCEPTION 'Only active cadets may gift other cadets, and sentries may gift cadets in their tents.';
END $function$;
REVOKE ALL ON FUNCTION public.assert_cash_gift_recipient(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.assert_cash_gift_recipient(uuid,uuid) TO service_role;
CREATE OR REPLACE FUNCTION public.cash_gift_recipients()
 RETURNS TABLE(id uuid, display_name text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 SELECT p.id,p.display_name
 FROM public.profiles p 
 JOIN public.role_assignments r ON r.user_id=p.id AND r.role='cadet' AND r.status='active'
 WHERE p.id<>auth.uid() AND (
   EXISTS (SELECT 1 FROM public.role_assignments buyer WHERE buyer.user_id=auth.uid() AND buyer.role='cadet' AND buyer.status='active')
   OR EXISTS (SELECT 1 FROM public.role_assignments buyer 
              JOIN public.tent_members sm ON sm.user_id=auth.uid() AND sm.role='sentry'
              JOIN public.tent_members cm ON cm.tent_id=sm.tent_id AND cm.user_id=p.id AND cm.role='cadet'
              WHERE buyer.user_id=auth.uid() AND buyer.role='sentry' AND buyer.status='active')
 )
 ORDER BY p.display_name,p.id LIMIT 150;
$function$;
REVOKE ALL ON FUNCTION public.cash_gift_recipients() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.cash_gift_recipients() TO authenticated,service_role;
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
  IF distinct_count <> line_count THEN
    RAISE EXCEPTION 'One or more relic offers are no longer available. Review your cart.';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_to_recordset(lines) AS line(quantity bigint) WHERE quantity > 2147483647) THEN
    RAISE EXCEPTION 'Reduce the quantity of relics and try again.';
  END IF;

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
    jsonb_build_object('relics', lines, 'event_id', p_event_id, 'ticket_quantity', p_ticket_quantity, 'gift_recipient_id', CASE WHEN p_gift_recipient_id <> p_user_id THEN p_gift_recipient_id ELSE NULL END),
    round(total / p_xaf_per_usd, 2), total, 'XAF', 'Fapshi', p_phone, 'pending', p_reference, p_reference, p_method)
  RETURNING * INTO payment;
  RETURN jsonb_build_object('id', payment.id, 'amount', payment.amount_local);
END;
$function$;
REVOKE ALL ON FUNCTION public.reserve_fapshi_cart(uuid,text,text,text,numeric,jsonb,uuid,integer,numeric,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_fapshi_cart(uuid,text,text,text,numeric,jsonb,uuid,integer,numeric,uuid) TO service_role;
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
$function$;
CREATE OR REPLACE FUNCTION public.finalize_campay_payment(p_payment_id uuid, p_provider_reference text, p_verified_amount numeric, p_verified_currency text, p_verification jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_payment public.mobile_money_payments%ROWTYPE;
  v_relic public.relic_types%ROWTYPE;
  v_delivery_inserted boolean := false;
  v_inventory_repaired boolean := false;
  v_recipient uuid;
  v_currency text := upper(trim(coalesce(p_verified_currency, '')));
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'CamPay confirmation is service-only.'; END IF;
  IF p_verified_amount IS NULL OR p_verified_amount <= 0 THEN RAISE EXCEPTION 'CamPay did not provide a valid verified amount.'; END IF;
  IF v_currency <> 'XAF' THEN RAISE EXCEPTION 'Unexpected CamPay currency: %', coalesce(nullif(v_currency, ''), 'missing'); END IF;

  SELECT * INTO v_payment FROM public.mobile_money_payments WHERE id = p_payment_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Payment not found.'; END IF;
  IF lower(v_payment.status) IN ('failed', 'cancelled', 'canceled', 'expired') THEN RAISE EXCEPTION 'A failed payment cannot be confirmed.'; END IF;
  IF lower(v_payment.status) = 'rejected' AND coalesce(v_payment.rejection_reason, '') <> 'Payment was not confirmed within 35 seconds.' THEN
    RAISE EXCEPTION 'A rejected payment cannot be confirmed.';
  END IF;
  IF upper(coalesce(v_payment.currency_code, '')) <> v_currency THEN RAISE EXCEPTION 'Verified currency does not match the checkout.'; END IF;
  IF round(v_payment.amount_local, 2) <> round(p_verified_amount, 2) THEN RAISE EXCEPTION 'Verified amount does not match the checkout.'; END IF;
  IF v_payment.provider_reference IS NOT NULL AND p_provider_reference IS NOT NULL AND v_payment.provider_reference <> p_provider_reference THEN
    RAISE EXCEPTION 'Verified provider reference does not match the checkout.';
  END IF;

  v_recipient := coalesce((v_payment.purchase_metadata->>'gift_recipient_id')::uuid, v_payment.user_id);
  SELECT * INTO v_relic FROM public.relic_types WHERE slug = v_payment.relic_slug;
  IF NOT FOUND THEN RAISE EXCEPTION 'Relic not found.'; END IF;

  INSERT INTO public.relic_payment_deliveries(payment_id, user_id, relic_type_id)
  VALUES (v_payment.id, v_recipient, v_relic.id)
  ON CONFLICT (payment_id) DO NOTHING;
  v_delivery_inserted := FOUND;

  /* A delivery ledger row without its inventory row is an incomplete delivery,
     not a successful purchase. Repair that exact missing row, but never add a
     second item when an existing inventory quantity is zero from valid use. */
  IF v_delivery_inserted OR NOT EXISTS (
    SELECT 1 FROM public.relic_inventory inventory
    WHERE inventory.user_id = v_recipient AND inventory.relic_type_id = v_relic.id
  ) THEN
    INSERT INTO public.relic_inventory(user_id, relic_type_id, quantity, source_description)
    VALUES (v_recipient, v_relic.id, 1, 'Confirmed CamPay purchase ' || v_payment.id::text)
    ON CONFLICT (user_id, relic_type_id) DO UPDATE
      SET quantity = CASE WHEN public.relic_inventory.quantity > 0 THEN public.relic_inventory.quantity + EXCLUDED.quantity ELSE EXCLUDED.quantity END,
          source_description = EXCLUDED.source_description;
    v_inventory_repaired := true;
  END IF;

  UPDATE public.mobile_money_payments
  SET status = 'confirmed', confirmed_by = NULL, confirmed_at = coalesce(confirmed_at, now()), relic_granted_at = coalesce(relic_granted_at, now()),
      provider_reference = coalesce(provider_reference, nullif(trim(p_provider_reference), '')), verified_amount_local = p_verified_amount,
      verified_currency_code = v_currency, provider_verification = coalesce(p_verification, '{}'::jsonb), rejection_reason = NULL
  WHERE id = p_payment_id;
  RETURN jsonb_build_object('payment_id', p_payment_id, 'status', 'confirmed', 'newly_granted', v_delivery_inserted OR v_inventory_repaired);
END;
$function$;
