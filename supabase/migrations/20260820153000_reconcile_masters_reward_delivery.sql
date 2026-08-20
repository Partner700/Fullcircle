/* Reconcile paid Master's Reward purchases that were recorded without inventory.

   The delivery ledger is the source of truth for exactly-once recovery. A
   payment may be marked successful by the provider before the old purchase
   path finishes writing relic_inventory, so recovery must not depend on
   relic_granted_at being populated already.
*/

DO $$
DECLARE
  v_payment record;
  v_relic_id uuid;
  v_delivery_inserted boolean;
  v_repaired_count integer := 0;
BEGIN
  FOR v_payment IN
    SELECT
      payment.id,
      payment.user_id,
      payment.relic_slug,
      payment.relic_name,
      payment.status,
      payment.confirmed_at,
      payment.relic_granted_at,
      relic.id AS relic_type_id
    FROM public.mobile_money_payments payment
    JOIN public.profiles profile ON profile.id = payment.user_id
    JOIN LATERAL (
      SELECT candidate.id
      FROM public.relic_types candidate
      WHERE candidate.slug = payment.relic_slug
         OR lower(candidate.name) = lower(coalesce(payment.relic_name, ''))
         OR lower(candidate.name) LIKE '%master%reward%'
      ORDER BY (candidate.slug = 'masters-reward') DESC
      LIMIT 1
    ) relic ON true
    WHERE lower(trim(profile.display_name)) IN ('vedette', 'sentinel vedette')
      AND (
        payment.relic_slug = 'masters-reward'
        OR lower(coalesce(payment.relic_name, '')) LIKE '%master%reward%'
      )
      AND lower(coalesce(payment.status, '')) NOT IN ('rejected', 'failed', 'cancelled', 'canceled', 'expired')
      AND (
        lower(coalesce(payment.status, '')) IN ('confirmed', 'successful', 'success', 'completed', 'paid', 'approved', 'settled')
        OR payment.confirmed_at IS NOT NULL
        OR payment.relic_granted_at IS NOT NULL
      )
    ORDER BY payment.created_at, payment.id
  LOOP
    v_relic_id := v_payment.relic_type_id;

    INSERT INTO public.relic_payment_deliveries(payment_id, user_id, relic_type_id)
    VALUES (v_payment.id, v_payment.user_id, v_relic_id)
    ON CONFLICT (payment_id) DO NOTHING;
    v_delivery_inserted := FOUND;

    /* If inventory is absent, restore exactly one item. If it already exists,
       the purchase was delivered through the older path and must not be
       duplicated merely because its ledger row was missing. */
    IF NOT EXISTS (
      SELECT 1
      FROM public.relic_inventory inventory
      WHERE inventory.user_id = v_payment.user_id
        AND inventory.relic_type_id = v_relic_id
    ) THEN
      INSERT INTO public.relic_inventory(user_id, relic_type_id, quantity, source_description)
      VALUES (
        v_payment.user_id,
        v_relic_id,
        1,
        'Recovered confirmed Master''s Reward purchase ' || v_payment.id::text
      );
      v_repaired_count := v_repaired_count + 1;
    END IF;

    UPDATE public.mobile_money_payments
    SET status = 'confirmed',
        confirmed_at = coalesce(confirmed_at, now()),
        relic_granted_at = coalesce(relic_granted_at, confirmed_at, now()),
        rejection_reason = NULL
    WHERE id = v_payment.id;
  END LOOP;

  IF v_repaired_count > 0 THEN
    RAISE NOTICE 'Recovered % Master''s Reward item(s) for Vedette account(s).', v_repaired_count;
  END IF;
END;
$$;

/* Keep the instructor payment list truthful for any successfully settled
   Master's Reward payment that was waiting on a delayed provider callback. */
UPDATE public.mobile_money_payments
SET status = 'confirmed',
    confirmed_at = coalesce(confirmed_at, now()),
    relic_granted_at = coalesce(relic_granted_at, confirmed_at, now()),
    rejection_reason = NULL
WHERE relic_slug = 'masters-reward'
  AND lower(coalesce(status, '')) IN ('paid', 'approved', 'settled', 'successful', 'success', 'completed')
  AND lower(coalesce(status, '')) NOT IN ('rejected', 'failed', 'cancelled', 'canceled', 'expired');
