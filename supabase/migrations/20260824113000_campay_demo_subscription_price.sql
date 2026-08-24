/* Keep the real subscription price intact while allowing CamPay's demo
   environment to complete its capped end-to-end test transaction. */

ALTER TABLE public.subscription_plans
  ADD COLUMN IF NOT EXISTS demo_amount_xaf integer NOT NULL DEFAULT 25
  CHECK (demo_amount_xaf > 0 AND demo_amount_xaf <= 25);

UPDATE public.subscription_plans
SET demo_amount_xaf = 25,
    updated_at = now()
WHERE id = 'monthly';

