-- Each Direct Pay relic collection has its own reference and delivers one relic.
-- Keep the single-pending rule for hosted checkout, subscriptions and FCX.
CREATE UNIQUE INDEX mobile_money_payments_one_pending_nonrepeatable_fapshi_product
  ON public.mobile_money_payments(user_id, relic_slug)
  WHERE status = 'pending' AND left(reference, 3) = 'fp_'
    AND (purchase_kind IS DISTINCT FROM 'relic'
      OR coalesce(payment_method, '') NOT IN ('mtn_momo', 'orange_money'));

DROP INDEX public.mobile_money_payments_one_pending_fapshi_product;
