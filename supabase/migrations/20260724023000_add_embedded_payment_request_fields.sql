-- Store embedded checkout details so cadets can submit payment requests without
-- leaving the platform.

ALTER TABLE public.mobile_money_payments
  ADD COLUMN IF NOT EXISTS payment_method text,
  ADD COLUMN IF NOT EXISTS payment_details text,
  ADD COLUMN IF NOT EXISTS provider_reference text,
  ADD COLUMN IF NOT EXISTS external_reference text,
  ADD COLUMN IF NOT EXISTS operator text,
  ADD COLUMN IF NOT EXISTS ussd_code text;

CREATE INDEX IF NOT EXISTS idx_mobile_money_payments_provider_reference
  ON public.mobile_money_payments(provider_reference);

CREATE INDEX IF NOT EXISTS idx_mobile_money_payments_external_reference
  ON public.mobile_money_payments(external_reference);
