/* Preserve uninterrupted streak highs, repair missing paid relic inventory,
   refund only the actual Arena stake, and keep question decks distinct. */

CREATE OR REPLACE FUNCTION public.compute_strict_streak(p_user_id uuid)
RETURNS TABLE(current_streak integer, longest_streak integer, consecutive_inactive integer, cumulative_inactive integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_today date := timezone('Africa/Douala', now())::date;
  v_local_time time := timezone('Africa/Douala', now())::time;
  v_start date; v_check date; v_baseline_date date;
  v_baseline_current integer := 0; v_baseline_longest integer := 0;
  v_current integer := 0; v_longest integer := 0; v_consecutive integer := 0; v_cumulative integer := 0;
  v_requirement_met boolean; v_protected boolean; v_eligible boolean;
BEGIN
  SELECT least(coalesce((profile.created_at AT TIME ZONE 'Africa/Douala')::date, v_today),
    coalesce((SELECT min(record.record_date) FROM public.daily_records record WHERE record.user_id = p_user_id), v_today))
  INTO v_start FROM public.profiles profile WHERE profile.id = p_user_id;
  IF v_start IS NULL THEN RETURN QUERY SELECT 0, 0, 0, 0; RETURN; END IF;

  /* A streak may grow from its strongest uninterrupted snapshot, never from a
     lower snapshot merely because that row was written more recently. A zero
     snapshot is a real loss boundary; nothing before it may be resurrected. */
  SELECT snapshot.snapshot_date, coalesce(snapshot.current_streak, 0),
    greatest(coalesce(snapshot.longest_streak, 0), coalesce(snapshot.current_streak, 0))
  INTO v_baseline_date, v_baseline_current, v_baseline_longest
  FROM public.streakboard_snapshots snapshot
  WHERE snapshot.user_id = p_user_id
    AND coalesce(snapshot.current_streak, 0) > 0
    AND snapshot.snapshot_date < v_today
    AND snapshot.snapshot_date > coalesce((
      SELECT max(lost.snapshot_date)
      FROM public.streakboard_snapshots lost
      WHERE lost.user_id = p_user_id
        AND lost.snapshot_date < v_today
        AND coalesce(lost.current_streak, 0) = 0
    ), date '0001-01-01')
  ORDER BY coalesce(snapshot.current_streak, 0) DESC, snapshot.snapshot_date DESC, snapshot.created_at DESC
  LIMIT 1;

  v_check := v_start;
  WHILE v_check <= v_today LOOP
    IF v_baseline_date IS NOT NULL AND v_check = v_baseline_date THEN
      v_current := greatest(v_current, v_baseline_current);
      v_longest := greatest(v_longest, v_baseline_longest, v_current);
      v_consecutive := 0; v_check := v_check + 1; CONTINUE;
    END IF;

    v_requirement_met := public.streak_requirement_met(p_user_id, v_check);
    v_protected := false;
    IF NOT v_requirement_met THEN
      v_protected := public.streak_day_is_protected(p_user_id, v_check);
      IF NOT v_protected AND v_current > 0
         AND extract(dow FROM v_check) BETWEEN 1 AND 5
         AND (v_check < v_today OR v_local_time >= time '21:00') THEN
        v_protected := public.activate_streak_freezer_for_date(p_user_id, v_check);
      END IF;
    END IF;

    v_eligible := CASE
      WHEN extract(dow FROM v_check) = 0 THEN v_requirement_met OR v_protected
      WHEN extract(dow FROM v_check) = 6 THEN EXISTS (
        SELECT 1 FROM public.quiz_sessions session
        WHERE session.session_date = v_check AND session.quiz_type = 'saturday'
      ) OR v_requirement_met OR v_protected
      ELSE true
    END;
    IF NOT v_eligible OR (v_check = v_today AND NOT v_requirement_met AND NOT v_protected AND v_local_time < time '21:00') THEN
      v_check := v_check + 1; CONTINUE;
    END IF;

    IF v_protected AND NOT v_requirement_met THEN
      v_consecutive := 0;
    ELSIF v_requirement_met THEN
      v_current := v_current + 1;
      v_longest := greatest(v_longest, v_current);
      v_consecutive := 0;
    ELSE
      v_current := 0;
      v_consecutive := v_consecutive + 1;
      v_cumulative := v_cumulative + 1;
    END IF;
    v_check := v_check + 1;
  END LOOP;
  RETURN QUERY SELECT v_current, v_longest, v_consecutive, v_cumulative;
END;
$$;

REVOKE ALL ON FUNCTION public.compute_strict_streak(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.compute_strict_streak(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.finalize_campay_payment(
  p_payment_id uuid,
  p_provider_reference text,
  p_verified_amount numeric,
  p_verified_currency text,
  p_verification jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_payment public.mobile_money_payments%ROWTYPE;
  v_relic public.relic_types%ROWTYPE;
  v_delivery_inserted boolean := false;
  v_inventory_repaired boolean := false;
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

  SELECT * INTO v_relic FROM public.relic_types WHERE slug = v_payment.relic_slug;
  IF NOT FOUND THEN RAISE EXCEPTION 'Relic not found.'; END IF;

  INSERT INTO public.relic_payment_deliveries(payment_id, user_id, relic_type_id)
  VALUES (v_payment.id, v_payment.user_id, v_relic.id)
  ON CONFLICT (payment_id) DO NOTHING;
  v_delivery_inserted := FOUND;

  /* A delivery ledger row without its inventory row is an incomplete delivery,
     not a successful purchase. Repair that exact missing row, but never add a
     second item when an existing inventory quantity is zero from valid use. */
  IF v_delivery_inserted OR NOT EXISTS (
    SELECT 1 FROM public.relic_inventory inventory
    WHERE inventory.user_id = v_payment.user_id AND inventory.relic_type_id = v_relic.id
  ) THEN
    INSERT INTO public.relic_inventory(user_id, relic_type_id, quantity, source_description)
    VALUES (v_payment.user_id, v_relic.id, 1, 'Confirmed CamPay purchase ' || v_payment.id::text)
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
$$;

REVOKE ALL ON FUNCTION public.finalize_campay_payment(uuid, text, numeric, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_campay_payment(uuid, text, numeric, text, jsonb) TO service_role;

/* Repair confirmed purchases where an earlier delivery row was written but the
   inventory row never committed. This is deliberately idempotent. */
DO $$
BEGIN
  INSERT INTO public.relic_payment_deliveries(payment_id, user_id, relic_type_id)
  SELECT payment.id, payment.user_id, relic.id
  FROM public.mobile_money_payments payment
  JOIN public.relic_types relic ON relic.slug = payment.relic_slug
  WHERE lower(payment.status) IN ('confirmed', 'successful', 'success', 'completed')
    AND payment.relic_granted_at IS NOT NULL
  ON CONFLICT (payment_id) DO NOTHING;

  /* If an earlier run recorded deliveries but never created inventory, restore
     the full count of those paid deliveries in one grouped upsert. */
  INSERT INTO public.relic_inventory(user_id, relic_type_id, quantity, source_description)
  SELECT delivery.user_id, delivery.relic_type_id, count(*)::integer,
    'Recovered confirmed CamPay purchase deliveries'
  FROM public.relic_payment_deliveries delivery
  JOIN public.mobile_money_payments payment ON payment.id = delivery.payment_id
  WHERE lower(payment.status) IN ('confirmed', 'successful', 'success', 'completed')
    AND payment.relic_granted_at IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.relic_inventory inventory
      WHERE inventory.user_id = delivery.user_id AND inventory.relic_type_id = delivery.relic_type_id
    )
  GROUP BY delivery.user_id, delivery.relic_type_id
  ON CONFLICT (user_id, relic_type_id) DO UPDATE
    SET quantity = GREATEST(public.relic_inventory.quantity, EXCLUDED.quantity),
        source_description = EXCLUDED.source_description;
END;
$$;

CREATE OR REPLACE FUNCTION public.close_arena_room(p_room_id uuid, p_user_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_room public.arena_rooms%ROWTYPE;
  v_participant record;
  v_refund integer;
BEGIN
  IF auth.uid() IS NOT NULL AND auth.uid() <> p_user_id THEN RAISE EXCEPTION 'You can only close arena rooms as yourself.'; END IF;
  SELECT * INTO v_room FROM public.arena_rooms WHERE id = p_room_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Room not found.'; END IF;
  IF v_room.creator_id <> p_user_id THEN RAISE EXCEPTION 'Only the host can close this room.'; END IF;
  IF v_room.status <> 'waiting' THEN RAISE EXCEPTION 'Only waiting rooms can be closed.'; END IF;
  UPDATE public.arena_rooms SET status = 'cancelled', closed_by = p_user_id, closed_at = now(), completed_at = now() WHERE id = p_room_id;
  UPDATE public.arena_room_invites SET status = 'cancelled', responded_at = now() WHERE room_id = p_room_id AND status = 'pending';
  FOR v_participant IN SELECT user_id FROM public.arena_participants WHERE room_id = p_room_id LOOP
    /* The game-call fee is a service charge and is never refunded as stake. */
    v_refund := coalesce(v_room.stake_amount, 0);
    IF v_refund > 0 AND NOT EXISTS (
      SELECT 1 FROM public.denarii_ledger_entries WHERE user_id = v_participant.user_id AND source_type = 'arena_reward'
        AND source_reference = p_room_id::text AND description LIKE 'Arena room cancelled refund%'
    ) THEN
      INSERT INTO public.denarii_ledger_entries(user_id, amount, source_type, source_reference, description)
      VALUES (v_participant.user_id, v_refund, 'arena_reward', p_room_id::text, 'Arena room cancelled refund for ' || v_room.room_name);
    END IF;
    PERFORM public.notify_user(v_participant.user_id, p_user_id, 'arena', 'Arena room closed',
      '"' || v_room.room_name || '" was closed by the host.', 'arena', jsonb_build_object('room_id', p_room_id, 'status', 'cancelled'));
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.close_arena_room(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.close_arena_room(uuid, uuid) TO authenticated, service_role;
