ALTER TABLE public.mobile_money_payments DROP CONSTRAINT mobile_money_payments_purchase_kind_check;
ALTER TABLE public.mobile_money_payments ADD CONSTRAINT mobile_money_payments_purchase_kind_check
  CHECK (purchase_kind IN ('relic','subscription','fcx_ticket'));

CREATE INDEX mobile_money_payments_pending_fcx_event
ON public.mobile_money_payments ((purchase_metadata->>'event_id'))
WHERE purchase_kind='fcx_ticket' AND status='pending';

CREATE FUNCTION public.reserve_fcx_fapshi_checkout(
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
     + (SELECT count(*) FROM public.mobile_money_payments WHERE purchase_kind='fcx_ticket'
          AND status='pending' AND purchase_metadata->>'event_id'=event.id::text) >= event.capacity THEN
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

-- All ways of adding a place share the same event row lock, including manual and Denarii registrations.
CREATE FUNCTION public.check_fcx_registration_capacity()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE event_capacity integer;
BEGIN
  SELECT capacity INTO event_capacity FROM public.fcx_events WHERE id=NEW.event_id FOR UPDATE;
  IF EXISTS (SELECT 1 FROM public.mobile_money_payments WHERE purchase_kind='fcx_ticket'
    AND status='pending' AND purchase_metadata->>'event_id'=NEW.event_id::text AND user_id=NEW.user_id) THEN
    RAISE EXCEPTION 'This Resident already has an FCX checkout pending.';
  END IF;
  IF (SELECT count(*) FROM public.fcx_registrations WHERE event_id=NEW.event_id)
    + (SELECT count(*) FROM public.mobile_money_payments WHERE purchase_kind='fcx_ticket'
         AND status='pending' AND purchase_metadata->>'event_id'=NEW.event_id::text) >= event_capacity THEN
    RAISE EXCEPTION 'All FCX places are booked or held by pending payments.';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER fcx_registration_capacity_before_insert BEFORE INSERT ON public.fcx_registrations
FOR EACH ROW EXECUTE FUNCTION public.check_fcx_registration_capacity();

CREATE FUNCTION public.protect_pending_fcx_checkout()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.mobile_money_payments WHERE purchase_kind='fcx_ticket'
      AND status='pending' AND purchase_metadata->>'event_id'=OLD.id::text) THEN
    IF NOT NEW.is_active OR NEW.capacity<OLD.capacity OR NEW.ticket_price_xaf IS DISTINCT FROM OLD.ticket_price_xaf THEN
      RAISE EXCEPTION 'Wait for pending FCX payments to settle before changing capacity, price, or active edition.';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER protect_pending_fcx_checkout BEFORE UPDATE OF is_active,capacity,ticket_price_xaf ON public.fcx_events
FOR EACH ROW EXECUTE FUNCTION public.protect_pending_fcx_checkout();

CREATE FUNCTION public.finalize_fcx_fapshi_payment(
  p_payment_id uuid,p_provider_reference text,p_verified_amount numeric,p_verified_currency text,p_verification jsonb
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  payment public.mobile_money_payments%ROWTYPE;
  event_id uuid;
BEGIN
  SELECT * INTO payment FROM public.mobile_money_payments WHERE id=p_payment_id AND purchase_kind='fcx_ticket' FOR UPDATE;
  IF NOT FOUND OR p_verified_amount IS DISTINCT FROM payment.amount_local OR p_verified_currency IS DISTINCT FROM 'XAF'
     OR payment.currency_code IS DISTINCT FROM 'XAF' OR nullif(p_provider_reference,'') IS NULL
     OR (payment.provider_reference IS NOT NULL AND payment.provider_reference<>p_provider_reference)
     OR p_verification->>'provider' IS DISTINCT FROM 'fapshi'
     OR p_verification->>'externalId' IS DISTINCT FROM payment.reference
     OR p_verification->>'status' IS DISTINCT FROM 'SUCCESSFUL' THEN
    RAISE EXCEPTION 'Verified Fapshi payment does not match this FCX checkout.';
  END IF;
  IF payment.status='confirmed' THEN RETURN jsonb_build_object('status','confirmed'); END IF;
  IF payment.status<>'pending' THEN RAISE EXCEPTION 'FCX checkout is no longer pending.'; END IF;
  event_id := (payment.purchase_metadata->>'event_id')::uuid;
  PERFORM 1 FROM public.fcx_events WHERE id=event_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'FCX event not found.'; END IF;
  UPDATE public.mobile_money_payments SET status='confirmed',confirmed_at=now(),
    provider_reference=p_provider_reference,verified_amount_local=p_verified_amount,
    verified_currency_code=p_verified_currency,provider_verification=p_verification
  WHERE id=p_payment_id;
  INSERT INTO public.fcx_registrations(event_id,user_id,payment_source,added_by)
  VALUES(event_id,payment.user_id,'app',payment.user_id);
  RETURN jsonb_build_object('status','confirmed');
END;
$$;

REVOKE ALL ON FUNCTION public.reserve_fcx_fapshi_checkout(uuid,uuid,text,numeric),
  public.finalize_fcx_fapshi_payment(uuid,text,numeric,text,jsonb),
  public.check_fcx_registration_capacity(),public.protect_pending_fcx_checkout()
FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_fcx_fapshi_checkout(uuid,uuid,text,numeric),
  public.finalize_fcx_fapshi_payment(uuid,text,numeric,text,jsonb) TO service_role;
