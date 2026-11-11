ALTER TABLE public.mobile_money_payments DROP CONSTRAINT mobile_money_payments_purchase_kind_check;
ALTER TABLE public.mobile_money_payments ADD CONSTRAINT mobile_money_payments_purchase_kind_check
  CHECK (purchase_kind IN ('relic', 'subscription', 'fcx_ticket', 'cart'));

CREATE INDEX mobile_money_payments_pending_cart_event
ON public.mobile_money_payments ((purchase_metadata->>'event_id'))
WHERE purchase_kind = 'cart' AND status = 'pending';

CREATE FUNCTION public.fcx_pending_paid_spots(p_event_id uuid)
RETURNS bigint LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT coalesce(sum(coalesce((purchase_metadata->>'ticket_quantity')::integer, 1)), 0)
  FROM public.mobile_money_payments
  WHERE status = 'pending' AND purchase_kind IN ('fcx_ticket', 'cart')
    AND purchase_metadata->>'event_id' = p_event_id::text;
$$;

CREATE OR REPLACE FUNCTION public.reserve_fcx_fapshi_checkout(
  p_user_id uuid, p_event_id uuid, p_reference text, p_displayed_amount numeric
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  event public.fcx_events%ROWTYPE;
  payment public.mobile_money_payments%ROWTYPE;
BEGIN
  SELECT * INTO event FROM public.fcx_events WHERE id=p_event_id AND is_active FOR UPDATE;
  IF NOT FOUND OR event.event_date IS NULL OR event.event_date<timezone('Africa/Douala',now())::date THEN
    RAISE EXCEPTION 'This FCX edition is no longer open.';
  END IF;
  IF event.ticket_price_xaf IS NULL OR event.ticket_price_xaf<300 OR event.ticket_price_xaf IS DISTINCT FROM p_displayed_amount THEN
    RAISE EXCEPTION 'The FCX price has changed. Refresh the event and try again.';
  END IF;
  IF EXISTS(SELECT 1 FROM public.fcx_registrations WHERE event_id=event.id AND user_id=p_user_id)
     OR EXISTS(SELECT 1 FROM public.mobile_money_payments WHERE user_id=p_user_id
       AND relic_slug='fcx-'||event.id AND status='confirmed' AND purchase_kind='fcx_ticket') THEN
    RAISE EXCEPTION 'Your place at this FCX is already confirmed.';
  END IF;
  SELECT * INTO payment FROM public.mobile_money_payments
  WHERE user_id=p_user_id AND relic_slug='fcx-'||event.id AND status='pending' AND purchase_kind='fcx_ticket';
  IF FOUND THEN
    RETURN jsonb_build_object('id',payment.id,'reference',payment.reference,'amount',payment.amount_local,
      'title',payment.relic_name,'checkout_url',payment.fapshi_checkout_url,'created',false);
  END IF;
  IF (SELECT count(*) FROM public.fcx_registrations WHERE event_id=event.id)
     + public.fcx_pending_paid_spots(event.id) >= event.capacity THEN
    RAISE EXCEPTION 'All FCX places are booked or held by pending payments.';
  END IF;
  INSERT INTO public.mobile_money_payments(user_id,relic_slug,relic_name,purchase_kind,purchase_metadata,
    amount_usd,amount_local,currency_code,provider,sender_phone,status,reference,external_reference,payment_method)
  VALUES(p_user_id,'fcx-'||event.id,event.title,'fcx_ticket',jsonb_build_object('event_id',event.id),
    round(event.ticket_price_xaf::numeric/575,2),event.ticket_price_xaf,'XAF','Fapshi','','pending',
    p_reference,p_reference,'fapshi_hosted') RETURNING * INTO payment;
  RETURN jsonb_build_object('id',payment.id,'reference',payment.reference,'amount',payment.amount_local,
    'title',payment.relic_name,'created',true);
END;
$$;

CREATE OR REPLACE FUNCTION public.check_fcx_registration_capacity()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE event_capacity integer;
BEGIN
  SELECT capacity INTO event_capacity FROM public.fcx_events WHERE id = NEW.event_id FOR UPDATE;
  IF EXISTS (SELECT 1 FROM public.mobile_money_payments WHERE purchase_kind = 'fcx_ticket'
    AND status = 'pending' AND purchase_metadata->>'event_id' = NEW.event_id::text AND user_id = NEW.user_id) THEN
    RAISE EXCEPTION 'This Resident already has an FCX checkout pending.';
  END IF;
  IF (SELECT count(*) FROM public.fcx_registrations WHERE event_id = NEW.event_id)
    + public.fcx_pending_paid_spots(NEW.event_id) >= event_capacity THEN
    RAISE EXCEPTION 'All FCX places are booked or held by pending payments.';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.protect_pending_fcx_checkout()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF public.fcx_pending_paid_spots(OLD.id) > 0 AND
    (TG_OP = 'DELETE' OR NOT NEW.is_active OR NEW.capacity < OLD.capacity OR NEW.ticket_price_xaf IS DISTINCT FROM OLD.ticket_price_xaf) THEN
    RAISE EXCEPTION 'Wait for pending FCX payments to settle before changing capacity, price, or active edition.';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

CREATE TRIGGER protect_pending_fcx_checkout_before_delete BEFORE DELETE ON public.fcx_events
FOR EACH ROW EXECUTE FUNCTION public.protect_pending_fcx_checkout();

CREATE FUNCTION public.protect_pending_cart_relic()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.mobile_money_payments
    WHERE purchase_kind = 'cart' AND status = 'pending'
      AND purchase_metadata->'relics' @> jsonb_build_array(jsonb_build_object('relic_id', OLD.id))) THEN
    RAISE EXCEPTION 'Wait for pending cart payments to settle before deleting this relic.';
  END IF;
  RETURN OLD;
END;
$$;
CREATE TRIGGER protect_pending_cart_relic_before_delete BEFORE DELETE ON public.relic_types
FOR EACH ROW EXECUTE FUNCTION public.protect_pending_cart_relic();

CREATE FUNCTION public.reserve_fapshi_cart(
  p_user_id uuid, p_reference text, p_phone text, p_method text, p_displayed_amount numeric,
  p_relics jsonb, p_event_id uuid, p_ticket_quantity integer, p_xaf_per_usd numeric
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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
  SELECT count(*), count(DISTINCT slug) INTO line_count, distinct_count
  FROM jsonb_to_recordset(p_relics) AS item(slug text, quantity integer);
  IF line_count <> distinct_count OR EXISTS (
    SELECT 1 FROM jsonb_to_recordset(p_relics) AS item(slug text, quantity integer)
    WHERE quantity IS NULL OR quantity < 1
  ) THEN RAISE EXCEPTION 'Review the quantities in your cart.'; END IF;

  SELECT coalesce(jsonb_agg(jsonb_build_object('relic_id', relic_id, 'quantity', quantity,
      'unit_xaf', unit_xaf) ORDER BY relic_id), '[]'::jsonb),
    coalesce(sum(unit_xaf * quantity), 0)
  INTO lines, total
  FROM (
    SELECT relic.id AS relic_id, item.quantity,
      CASE WHEN relic.money_price_xaf > 0 THEN round(relic.money_price_xaf)
           WHEN relic.money_price_usd > 0 THEN round(relic.money_price_usd * p_xaf_per_usd) END AS unit_xaf
    FROM jsonb_to_recordset(p_relics) AS item(slug text, quantity integer)
    JOIN public.relic_types relic ON relic.slug = item.slug AND relic.is_active
    FOR KEY SHARE OF relic
  ) priced WHERE unit_xaf > 0;
  IF jsonb_array_length(lines) <> line_count THEN
    RAISE EXCEPTION 'One or more relics are no longer available for mobile money.';
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
  IF total < 300 OR total <> trunc(total) OR total IS DISTINCT FROM p_displayed_amount THEN
    RAISE EXCEPTION 'The cart total changed or is below 300 FCFA. Review your cart and try again.';
  END IF;

  INSERT INTO public.mobile_money_payments(user_id, relic_slug, relic_name, purchase_kind, purchase_metadata,
    amount_usd, amount_local, currency_code, provider, sender_phone, status, reference, external_reference, payment_method)
  VALUES(p_user_id, p_reference, 'Market cart', 'cart',
    jsonb_build_object('relics', lines, 'event_id', p_event_id, 'ticket_quantity', p_ticket_quantity),
    round(total / p_xaf_per_usd, 2), total, 'XAF', 'Fapshi', p_phone, 'pending', p_reference, p_reference, p_method)
  RETURNING * INTO payment;
  RETURN jsonb_build_object('id', payment.id, 'amount', payment.amount_local);
END;
$$;

CREATE FUNCTION public.finalize_fapshi_cart(
  p_payment_id uuid, p_provider_reference text, p_verified_amount numeric,
  p_verified_currency text, p_verification jsonb
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  payment public.mobile_money_payments%ROWTYPE;
  cart_event uuid;
  ticket_quantity integer;
  guest_quantity integer;
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
  SELECT payment.user_id, item.relic_id, item.quantity, 'Confirmed Fapshi cart'
  FROM jsonb_to_recordset(payment.purchase_metadata->'relics') AS item(relic_id uuid, quantity integer)
  ORDER BY item.relic_id
  ON CONFLICT (user_id, relic_type_id) DO UPDATE
    SET quantity = public.relic_inventory.quantity + EXCLUDED.quantity;

  IF cart_event IS NOT NULL THEN
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
$$;

REVOKE ALL ON FUNCTION public.protect_pending_cart_relic(), public.fcx_pending_paid_spots(uuid),
  public.reserve_fapshi_cart(uuid,text,text,text,numeric,jsonb,uuid,integer,numeric),
  public.finalize_fapshi_cart(uuid,text,numeric,text,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_fapshi_cart(uuid,text,text,text,numeric,jsonb,uuid,integer,numeric),
  public.finalize_fapshi_cart(uuid,text,numeric,text,jsonb) TO service_role;
