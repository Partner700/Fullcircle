-- Make CamPay confirmation and relic delivery one idempotent transaction.
ALTER TABLE public.mobile_money_payments
  ADD COLUMN IF NOT EXISTS relic_granted_at timestamptz,
  ADD COLUMN IF NOT EXISTS verified_amount_local numeric,
  ADD COLUMN IF NOT EXISTS verified_currency_code text,
  ADD COLUMN IF NOT EXISTS provider_verification jsonb;

-- Existing confirmed rows were handled by the legacy flow. Mark them as processed so
-- a delayed webhook cannot grant the same relic a second time.
UPDATE public.mobile_money_payments
SET relic_granted_at = COALESCE(relic_granted_at, confirmed_at, created_at, now())
WHERE lower(status) IN ('confirmed', 'successful', 'success', 'completed')
  AND relic_granted_at IS NULL;

CREATE OR REPLACE FUNCTION public.finalize_campay_payment(
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
  v_relic public.relic_types%ROWTYPE;
  v_newly_granted boolean := false;
  v_currency text := upper(trim(COALESCE(p_verified_currency, '')));
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'CamPay confirmation is service-only.';
  END IF;

  IF p_verified_amount IS NULL OR p_verified_amount <= 0 THEN
    RAISE EXCEPTION 'CamPay did not provide a valid verified amount.';
  END IF;
  IF v_currency <> 'XAF' THEN
    RAISE EXCEPTION 'Unexpected CamPay currency: %', COALESCE(NULLIF(v_currency, ''), 'missing');
  END IF;

  SELECT * INTO v_payment
  FROM public.mobile_money_payments
  WHERE id = p_payment_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payment not found.';
  END IF;
  IF lower(v_payment.status) IN ('rejected', 'failed', 'cancelled', 'canceled', 'expired') THEN
    RAISE EXCEPTION 'A rejected payment cannot be confirmed.';
  END IF;
  IF upper(COALESCE(v_payment.currency_code, '')) <> v_currency THEN
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

  IF v_payment.relic_granted_at IS NULL THEN
    SELECT * INTO v_relic
    FROM public.relic_types
    WHERE slug = v_payment.relic_slug;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Relic not found.';
    END IF;

    INSERT INTO public.relic_inventory (user_id, relic_type_id, quantity, source_description)
    VALUES (v_payment.user_id, v_relic.id, 1, 'Confirmed CamPay purchase ' || v_payment.id::text)
    ON CONFLICT (user_id, relic_type_id) DO UPDATE
      SET quantity = public.relic_inventory.quantity + 1;

    v_newly_granted := true;
  END IF;

  UPDATE public.mobile_money_payments
  SET status = 'confirmed',
      confirmed_by = NULL,
      confirmed_at = COALESCE(confirmed_at, now()),
      relic_granted_at = COALESCE(relic_granted_at, now()),
      provider_reference = COALESCE(provider_reference, NULLIF(trim(p_provider_reference), '')),
      verified_amount_local = p_verified_amount,
      verified_currency_code = v_currency,
      provider_verification = COALESCE(p_verification, '{}'::jsonb),
      rejection_reason = NULL
  WHERE id = p_payment_id;

  RETURN jsonb_build_object(
    'payment_id', p_payment_id,
    'status', 'confirmed',
    'newly_granted', v_newly_granted
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.reject_campay_payment(
  p_payment_id uuid,
  p_provider_reference text,
  p_reason text,
  p_verification jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_payment public.mobile_money_payments%ROWTYPE;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'CamPay rejection is service-only.';
  END IF;

  SELECT * INTO v_payment
  FROM public.mobile_money_payments
  WHERE id = p_payment_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payment not found.';
  END IF;

  IF v_payment.relic_granted_at IS NOT NULL OR lower(v_payment.status) = 'confirmed' THEN
    RETURN jsonb_build_object('payment_id', p_payment_id, 'status', 'confirmed');
  END IF;

  UPDATE public.mobile_money_payments
  SET status = 'rejected',
      confirmed_by = NULL,
      confirmed_at = now(),
      provider_reference = COALESCE(provider_reference, NULLIF(trim(p_provider_reference), '')),
      rejection_reason = NULLIF(trim(COALESCE(p_reason, 'Payment was not completed.')), ''),
      provider_verification = COALESCE(p_verification, '{}'::jsonb)
  WHERE id = p_payment_id;

  RETURN jsonb_build_object('payment_id', p_payment_id, 'status', 'rejected');
END;
$$;

-- The instructor dashboard is intentionally observational. Only the verified
-- CamPay service path may settle a transaction.
REVOKE ALL ON FUNCTION public.finalize_campay_payment(uuid, text, numeric, text, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reject_campay_payment(uuid, text, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_campay_payment(uuid, text, numeric, text, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.reject_campay_payment(uuid, text, text, jsonb) TO service_role;

REVOKE EXECUTE ON FUNCTION public.confirm_mobile_money_payment(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.reject_mobile_money_payment(uuid, text) FROM PUBLIC, anon, authenticated;

DROP POLICY IF EXISTS "update_own_mobile_payments" ON public.mobile_money_payments;
DROP POLICY IF EXISTS "instructor_update_mobile_payments" ON public.mobile_money_payments;
