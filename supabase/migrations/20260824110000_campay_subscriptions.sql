/* Connect subscriptions to the same verified CamPay flow used by the Market.

   The checkout amount is always read on the server. A confirmed payment is
   delivered once, and repeated webhooks or browser polling cannot extend the
   subscription more than once. */

CREATE TABLE IF NOT EXISTS public.subscription_plans (
  id text PRIMARY KEY,
  name text NOT NULL,
  amount_xaf integer NOT NULL CHECK (amount_xaf > 0),
  duration_days integer NOT NULL CHECK (duration_days BETWEEN 1 AND 366),
  is_active boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS subscription_plans_one_active_idx
  ON public.subscription_plans ((is_active))
  WHERE is_active = true;

INSERT INTO public.subscription_plans(id, name, amount_xaf, duration_days, is_active)
VALUES ('monthly', 'Full Circle Monthly', 1000, 31, true)
ON CONFLICT (id) DO UPDATE
SET name = EXCLUDED.name,
    is_active = true,
    updated_at = now();

ALTER TABLE public.subscription_plans ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "authenticated_read_subscription_plans" ON public.subscription_plans;
CREATE POLICY "authenticated_read_subscription_plans"
  ON public.subscription_plans FOR SELECT TO authenticated USING (is_active = true);
REVOKE INSERT, UPDATE, DELETE ON public.subscription_plans FROM anon, authenticated;
GRANT SELECT ON public.subscription_plans TO authenticated, service_role;

ALTER TABLE public.mobile_money_payments
  ADD COLUMN IF NOT EXISTS purchase_kind text NOT NULL DEFAULT 'relic',
  ADD COLUMN IF NOT EXISTS purchase_metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.mobile_money_payments
  DROP CONSTRAINT IF EXISTS mobile_money_payments_purchase_kind_check;
ALTER TABLE public.mobile_money_payments
  ADD CONSTRAINT mobile_money_payments_purchase_kind_check
  CHECK (purchase_kind IN ('relic', 'subscription'));

CREATE TABLE IF NOT EXISTS public.subscription_payment_deliveries (
  payment_id uuid PRIMARY KEY REFERENCES public.mobile_money_payments(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  plan_id text NOT NULL REFERENCES public.subscription_plans(id),
  period_start timestamptz NOT NULL,
  period_end timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (period_end > period_start)
);

CREATE INDEX IF NOT EXISTS subscription_payment_deliveries_user_idx
  ON public.subscription_payment_deliveries(user_id, period_end DESC);

ALTER TABLE public.subscription_payment_deliveries ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "read_own_subscription_deliveries" ON public.subscription_payment_deliveries;
CREATE POLICY "read_own_subscription_deliveries"
  ON public.subscription_payment_deliveries FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR public.is_instructor(auth.uid()));
REVOKE INSERT, UPDATE, DELETE ON public.subscription_payment_deliveries FROM anon, authenticated;
GRANT SELECT ON public.subscription_payment_deliveries TO authenticated, service_role;

/* A subscription can only be activated by the service-role payment finalizer. */
DROP POLICY IF EXISTS "insert_own_subscription" ON public.subscriptions;
DROP POLICY IF EXISTS "update_own_subscription" ON public.subscriptions;
REVOKE INSERT, UPDATE, DELETE ON public.subscriptions FROM anon, authenticated;
GRANT SELECT ON public.subscriptions TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_subscription_status(p_user_id uuid)
RETURNS TABLE (
  status text,
  trial_ends_at timestamptz,
  current_period_end timestamptz,
  is_paid boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sub public.subscriptions%ROWTYPE;
  v_joined_at timestamptz;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role'
     AND auth.uid() IS DISTINCT FROM p_user_id
     AND NOT public.is_instructor(auth.uid()) THEN
    RAISE EXCEPTION 'You may only view your own subscription.';
  END IF;

  SELECT * INTO v_sub
  FROM public.subscriptions
  WHERE user_id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    SELECT coalesce(created_at, now()) INTO v_joined_at
    FROM public.profiles WHERE id = p_user_id;
    IF v_joined_at IS NULL THEN RAISE EXCEPTION 'Profile not found.'; END IF;

    INSERT INTO public.subscriptions(user_id, status, trial_started_at, trial_ends_at)
    VALUES (p_user_id, 'trial', v_joined_at, v_joined_at + interval '31 days')
    RETURNING * INTO v_sub;
  END IF;

  IF v_sub.status = 'active'
     AND v_sub.current_period_end IS NOT NULL
     AND v_sub.current_period_end <= now() THEN
    UPDATE public.subscriptions
    SET status = 'expired', updated_at = now()
    WHERE user_id = p_user_id
    RETURNING * INTO v_sub;
  ELSIF v_sub.status = 'trial' AND v_sub.trial_ends_at <= now() THEN
    UPDATE public.subscriptions
    SET status = 'expired', updated_at = now()
    WHERE user_id = p_user_id
    RETURNING * INTO v_sub;
  END IF;

  RETURN QUERY SELECT
    v_sub.status,
    v_sub.trial_ends_at,
    v_sub.current_period_end,
    v_sub.status = 'active';
END;
$$;

REVOKE ALL ON FUNCTION public.get_subscription_status(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_subscription_status(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.finalize_subscription_payment(
  p_payment_id uuid,
  p_provider_reference text,
  p_verified_amount numeric,
  p_verified_currency text,
  p_verification jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_payment public.mobile_money_payments%ROWTYPE;
  v_plan public.subscription_plans%ROWTYPE;
  v_delivery public.subscription_payment_deliveries%ROWTYPE;
  v_existing_end timestamptz;
  v_period_start timestamptz;
  v_period_end timestamptz;
  v_delivery_inserted boolean := false;
  v_subscription_repaired boolean := false;
  v_currency text := upper(trim(coalesce(p_verified_currency, '')));
  v_plan_id text;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'CamPay confirmation is service-only.';
  END IF;
  IF p_verified_amount IS NULL OR p_verified_amount <= 0 THEN
    RAISE EXCEPTION 'CamPay did not provide a valid verified amount.';
  END IF;
  IF v_currency <> 'XAF' THEN
    RAISE EXCEPTION 'Unexpected CamPay currency: %', coalesce(nullif(v_currency, ''), 'missing');
  END IF;

  SELECT * INTO v_payment
  FROM public.mobile_money_payments
  WHERE id = p_payment_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Payment not found.'; END IF;
  IF v_payment.purchase_kind <> 'subscription' THEN
    RAISE EXCEPTION 'Payment is not a subscription checkout.';
  END IF;

  /* Serialize subscription deliveries per account so simultaneous confirmed
     payments extend one after another instead of sharing the same end date. */
  PERFORM pg_advisory_xact_lock(hashtextextended(v_payment.user_id::text, 0));

  IF lower(v_payment.status) IN ('failed', 'cancelled', 'canceled', 'expired') THEN
    RAISE EXCEPTION 'A failed payment cannot be confirmed.';
  END IF;
  IF lower(v_payment.status) = 'rejected'
     AND coalesce(v_payment.rejection_reason, '') <> 'Payment was not confirmed within 35 seconds.' THEN
    RAISE EXCEPTION 'A rejected payment cannot be confirmed.';
  END IF;
  IF upper(coalesce(v_payment.currency_code, '')) <> v_currency THEN
    RAISE EXCEPTION 'Verified currency does not match the checkout.';
  END IF;
  IF round(v_payment.amount_local, 2) <> round(p_verified_amount, 2) THEN
    RAISE EXCEPTION 'Verified amount does not match the checkout.';
  END IF;
  IF v_payment.provider_reference IS NOT NULL
     AND p_provider_reference IS NOT NULL
     AND v_payment.provider_reference <> p_provider_reference THEN
    RAISE EXCEPTION 'Verified provider reference does not match the checkout.';
  END IF;

  v_plan_id := coalesce(nullif(v_payment.purchase_metadata->>'plan_id', ''), 'monthly');
  SELECT * INTO v_plan FROM public.subscription_plans WHERE id = v_plan_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Subscription plan not found.'; END IF;

  SELECT current_period_end INTO v_existing_end
  FROM public.subscriptions
  WHERE user_id = v_payment.user_id
  FOR UPDATE;
  v_period_start := greatest(now(), coalesce(v_existing_end, now()));
  v_period_end := v_period_start + make_interval(days => v_plan.duration_days);

  INSERT INTO public.subscription_payment_deliveries(
    payment_id, user_id, plan_id, period_start, period_end
  ) VALUES (
    v_payment.id, v_payment.user_id, v_plan.id, v_period_start, v_period_end
  )
  ON CONFLICT (payment_id) DO NOTHING
  RETURNING * INTO v_delivery;
  v_delivery_inserted := FOUND;

  IF NOT v_delivery_inserted THEN
    SELECT * INTO v_delivery
    FROM public.subscription_payment_deliveries
    WHERE payment_id = v_payment.id;
  END IF;

  IF v_delivery_inserted OR NOT EXISTS (
    SELECT 1 FROM public.subscriptions subscription
    WHERE subscription.user_id = v_payment.user_id
      AND subscription.status = 'active'
      AND subscription.current_period_end >= v_delivery.period_end
  ) THEN
    INSERT INTO public.subscriptions(
      user_id, status, trial_started_at, trial_ends_at, current_period_end,
      payment_method, payment_reference, amount, currency
    ) VALUES (
      v_payment.user_id, 'active', now(), now(), v_delivery.period_end,
      v_payment.payment_method, v_payment.reference, v_payment.amount_local, v_currency
    )
    ON CONFLICT (user_id) DO UPDATE
    SET status = 'active',
        current_period_end = greatest(
          coalesce(public.subscriptions.current_period_end, EXCLUDED.current_period_end),
          EXCLUDED.current_period_end
        ),
        payment_method = EXCLUDED.payment_method,
        payment_reference = EXCLUDED.payment_reference,
        amount = EXCLUDED.amount,
        currency = EXCLUDED.currency,
        updated_at = now();
    v_subscription_repaired := true;
  END IF;

  UPDATE public.mobile_money_payments
  SET status = 'confirmed',
      confirmed_by = NULL,
      confirmed_at = coalesce(confirmed_at, now()),
      relic_granted_at = coalesce(relic_granted_at, now()),
      provider_reference = coalesce(provider_reference, nullif(trim(p_provider_reference), '')),
      verified_amount_local = p_verified_amount,
      verified_currency_code = v_currency,
      provider_verification = coalesce(p_verification, '{}'::jsonb),
      rejection_reason = NULL
  WHERE id = p_payment_id;

  IF v_delivery_inserted THEN
    PERFORM public.notify_user(
      v_payment.user_id,
      NULL,
      'payment',
      'Subscription active',
      'Your Full Circle subscription is active through '
        || to_char(v_delivery.period_end AT TIME ZONE 'Africa/Douala', 'Mon DD, YYYY') || '.',
      'subscribe',
      jsonb_build_object(
        'status', 'confirmed',
        'payment_id', v_payment.id,
        'period_end', v_delivery.period_end
      )
    );
  END IF;

  RETURN jsonb_build_object(
    'payment_id', p_payment_id,
    'status', 'confirmed',
    'newly_granted', v_delivery_inserted OR v_subscription_repaired,
    'period_end', v_delivery.period_end
  );
END;
$$;

REVOKE ALL ON FUNCTION public.finalize_subscription_payment(uuid, text, numeric, text, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_subscription_payment(uuid, text, numeric, text, jsonb)
  TO service_role;
