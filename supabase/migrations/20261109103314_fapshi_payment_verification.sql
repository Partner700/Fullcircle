ALTER TABLE public.mobile_money_payments
  ADD COLUMN IF NOT EXISTS fapshi_checked_at timestamptz,
  ADD COLUMN IF NOT EXISTS fapshi_checkout_url text;

CREATE UNIQUE INDEX IF NOT EXISTS mobile_money_payments_one_pending_fapshi_product
  ON public.mobile_money_payments(user_id, relic_slug)
  WHERE status = 'pending' AND left(reference, 3) = 'fp_';
