
CREATE FUNCTION public.reserve_fcx_attendee_cart(
  p_user_id uuid, p_reference text, p_phone text, p_method text, p_displayed_amount numeric,
  p_relics jsonb, p_event_id uuid, p_ticket_quantity integer, p_xaf_per_usd numeric,
  p_attendee_kind text, p_attendee_id uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  attendee uuid;
  reservation jsonb;
BEGIN
  IF p_event_id IS NULL OR p_ticket_quantity IS DISTINCT FROM 1
    OR p_attendee_kind IS NULL OR p_attendee_kind NOT IN ('self', 'member', 'guest') THEN
    RAISE EXCEPTION 'Choose who the FCX ticket is for.';
  END IF;
  attendee := CASE p_attendee_kind WHEN 'self' THEN p_user_id WHEN 'member' THEN p_attendee_id END;
  IF p_attendee_kind <> 'guest' AND (attendee IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.profiles WHERE id = attendee
  )) THEN RAISE EXCEPTION 'Select an app user.'; END IF;
  PERFORM 1 FROM public.fcx_events WHERE id = p_event_id FOR UPDATE;
  IF attendee IS NOT NULL AND (
    EXISTS (SELECT 1 FROM public.fcx_registrations WHERE event_id = p_event_id AND user_id = attendee)
    OR EXISTS (
      SELECT 1 FROM public.mobile_money_payments
      WHERE status = 'pending' AND purchase_metadata->>'event_id' = p_event_id::text
        AND coalesce(purchase_metadata->>'attendee_id',
          CASE WHEN NOT (purchase_metadata ? 'attendee_kind') THEN user_id::text END) = attendee::text
    )
  ) THEN RAISE EXCEPTION 'This attendee already has a ticket or a payment in progress.'; END IF;
  reservation := public.reserve_fapshi_cart(p_user_id, p_reference, p_phone, p_method,
    p_displayed_amount, p_relics, p_event_id, p_ticket_quantity, p_xaf_per_usd);
  UPDATE public.mobile_money_payments
  SET purchase_metadata = purchase_metadata || jsonb_build_object('attendee_kind', p_attendee_kind, 'attendee_id', attendee)
  WHERE id = (reservation->>'id')::uuid;
  RETURN reservation;
END;
$$;
REVOKE ALL ON FUNCTION public.reserve_fcx_attendee_cart(uuid,text,text,text,numeric,jsonb,uuid,integer,numeric,text,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_fcx_attendee_cart(uuid,text,text,text,numeric,jsonb,uuid,integer,numeric,text,uuid) TO service_role;

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
  SELECT payment.user_id, item.relic_id, item.quantity, 'Confirmed Fapshi cart'
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
$function$
 ;

CREATE FUNCTION public.get_fcx_guest_details_pending(p_event_id uuid)
RETURNS TABLE(payment_id uuid) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT payment.id FROM public.mobile_money_payments payment
  JOIN public.fcx_registrations registration ON registration.event_id = p_event_id
    AND registration.added_by = payment.user_id
    AND registration.guest_name = 'Paid FCX spot ' || payment.id || ' / 1'
  WHERE payment.user_id = auth.uid() AND payment.status = 'confirmed'
    AND payment.purchase_kind = 'cart' AND payment.purchase_metadata->>'event_id' = p_event_id::text
    AND payment.purchase_metadata ? 'attendee_kind'
  ORDER BY payment.created_at;
$$;

CREATE FUNCTION public.complete_fcx_guest_details(p_payment_id uuid, p_name text, p_photo text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  ticket_event_id uuid;
BEGIN
  IF auth.uid() IS NULL OR coalesce(length(btrim(p_name)), 0) NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'Enter the participant name.';
  END IF;
  SELECT (purchase_metadata->>'event_id')::uuid INTO ticket_event_id
  FROM public.mobile_money_payments WHERE id = p_payment_id AND user_id = auth.uid()
    AND status = 'confirmed' AND purchase_kind = 'cart' AND purchase_metadata ? 'attendee_kind'
  FOR UPDATE;
  IF ticket_event_id IS NULL OR p_photo IS NULL OR p_photo !~ (
    '^https://ovusyeqbmtvfcrlflrbf[.]supabase[.]co/storage/v1/object/public/avatars/' ||
    auth.uid() || '/fcx/' || ticket_event_id || '/guest-[0-9]+[.](jpg|jpeg|png|webp)([?]v=[0-9]+)?$'
  ) THEN RAISE EXCEPTION 'Upload a participant photo for this ticket.'; END IF;
  UPDATE public.fcx_registrations registration SET guest_name = btrim(p_name), guest_avatar_url = p_photo
  WHERE registration.event_id = ticket_event_id AND registration.added_by = auth.uid()
    AND registration.guest_name = 'Paid FCX spot ' || p_payment_id || ' / 1';
  IF NOT FOUND THEN RAISE EXCEPTION 'This ticket no longer needs participant details.'; END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.get_fcx_guest_details_pending(uuid), public.complete_fcx_guest_details(uuid,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_fcx_guest_details_pending(uuid), public.complete_fcx_guest_details(uuid,text,text) TO authenticated;

