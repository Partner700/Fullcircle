ALTER TABLE public.relic_types ADD COLUMN cash_bundles jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE public.relic_types ADD CONSTRAINT relic_cash_bundles_object CHECK (jsonb_typeof(cash_bundles) = 'object');

UPDATE public.relic_types relic
SET money_price_xaf = price.single_xaf, money_price_usd = NULL,
    cash_bundles = price.bundles, denarii_cost = coalesce(price.denarii, relic.denarii_cost)
FROM (VALUES
  ('witch-ball-endor', NULL::integer, '{"3":100}'::jsonb, NULL::integer),
  ('freeze-timer', NULL, '{"6":100}', NULL),
  ('hezekiahs-sundial', 200, '{}', 5000),
  ('redemption-coin', NULL, '{"5":15000,"2":5000}', NULL),
  ('reveal-reference', NULL, '{"10":300}', NULL),
  ('shield-of-faith', NULL, '{"10":300}', NULL),
  ('simons-purse', NULL, '{"3":3000}', NULL),
  ('skip', NULL, '{"10":300}', NULL),
  ('sword-goliath', NULL, '{"3":300}', NULL),
  ('lazarus-coin', 300, '{}', 6000),
  ('masters-reward', 200, '{}', NULL),
  ('thieves-request', NULL, '{"2":5000}', NULL)
) AS price(slug, single_xaf, bundles, denarii)
WHERE relic.slug = price.slug AND relic.is_active;

CREATE OR REPLACE FUNCTION public.reserve_fapshi_cart(
  p_user_id uuid, p_reference text, p_phone text, p_method text, p_displayed_amount numeric,
  p_relics jsonb, p_event_id uuid, p_ticket_quantity integer, p_xaf_per_usd numeric
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  event public.fcx_events%ROWTYPE;
  payment public.mobile_money_payments%ROWTYPE;
  lines jsonb;
  total numeric;
  line_count integer;
  distinct_count integer;
BEGIN
  IF p_method IS NULL OR p_method NOT IN ('mtn_momo', 'orange_money')
    OR p_ticket_quantity IS NULL OR p_ticket_quantity < 0
    OR (p_event_id IS NULL) <> (p_ticket_quantity = 0)
    OR jsonb_typeof(p_relics) IS DISTINCT FROM 'array'
    OR p_xaf_per_usd IS NULL OR p_xaf_per_usd <= 0 THEN
    RAISE EXCEPTION 'Review your cart and try again.';
  END IF;
  SELECT count(*), count(DISTINCT (slug, coalesce(pack_size, 1))) INTO line_count, distinct_count
  FROM jsonb_to_recordset(p_relics) AS item(slug text, quantity integer, pack_size integer);
  IF line_count <> distinct_count OR EXISTS (
    SELECT 1 FROM jsonb_to_recordset(p_relics) AS item(slug text, quantity integer, pack_size integer)
    WHERE quantity IS NULL OR quantity < 1 OR coalesce(pack_size, 1) < 1
  ) THEN RAISE EXCEPTION 'Review the quantities in your cart.'; END IF;

  WITH priced AS MATERIALIZED (
    SELECT relic.id AS relic_id, item.quantity, coalesce(item.pack_size, 1) AS pack_size,
      CASE
        WHEN coalesce(item.pack_size, 1) = 1 AND relic.money_price_xaf > 0 THEN round(relic.money_price_xaf)
        WHEN coalesce(item.pack_size, 1) = 1 AND relic.money_price_usd > 0 THEN round(relic.money_price_usd * p_xaf_per_usd)
        ELSE (relic.cash_bundles->>item.pack_size::text)::numeric
      END AS pack_xaf
    FROM jsonb_to_recordset(p_relics) AS item(slug text, quantity integer, pack_size integer)
    JOIN public.relic_types relic ON relic.slug = item.slug AND relic.is_active
    FOR KEY SHARE OF relic
  ), grouped AS (
    SELECT relic_id, sum(quantity::bigint * pack_size) AS quantity,
      sum(pack_xaf * quantity) AS subtotal, count(*) AS matching_lines
    FROM priced WHERE pack_xaf > 0 GROUP BY relic_id
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object('relic_id', relic_id, 'quantity', quantity,
      'subtotal_xaf', subtotal) ORDER BY relic_id), '[]'::jsonb),
    coalesce(sum(subtotal), 0), coalesce(sum(matching_lines), 0)
  INTO lines, total, distinct_count FROM grouped;
  IF distinct_count <> line_count THEN
    RAISE EXCEPTION 'One or more relic offers are no longer available. Review your cart.';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_to_recordset(lines) AS line(quantity bigint) WHERE quantity > 2147483647) THEN
    RAISE EXCEPTION 'Reduce the quantity of relics and try again.';
  END IF;

  IF p_event_id IS NOT NULL THEN
    SELECT * INTO event FROM public.fcx_events WHERE id = p_event_id AND is_active FOR UPDATE;
    IF NOT FOUND OR event.event_date IS NULL OR event.event_date < timezone('Africa/Douala', now())::date
       OR event.ticket_price_xaf IS NULL OR event.ticket_price_xaf < 300 THEN
      RAISE EXCEPTION 'This FCX edition is no longer open for mobile money purchases.';
    END IF;
    IF (SELECT count(*) FROM public.fcx_registrations WHERE event_id = event.id)
      + public.fcx_pending_paid_spots(event.id) + p_ticket_quantity > event.capacity THEN
      RAISE EXCEPTION 'There are fewer FCX spots available than requested.';
    END IF;
    total := total + event.ticket_price_xaf * p_ticket_quantity;
  END IF;
  IF total < 100 OR total <> trunc(total) OR total IS DISTINCT FROM p_displayed_amount THEN
    RAISE EXCEPTION 'The cart total changed or is below 100 FCFA. Review your cart and try again.';
  END IF;

  INSERT INTO public.mobile_money_payments(user_id, relic_slug, relic_name, purchase_kind, purchase_metadata,
    amount_usd, amount_local, currency_code, provider, sender_phone, status, reference, external_reference, payment_method)
  VALUES(p_user_id, p_reference, 'Market cart', 'cart',
    jsonb_build_object('relics', lines, 'event_id', p_event_id, 'ticket_quantity', p_ticket_quantity),
    round(total / p_xaf_per_usd, 2), total, 'XAF', 'Fapshi', p_phone, 'pending', p_reference, p_reference, p_method)
  RETURNING * INTO payment;
  RETURN jsonb_build_object('id', payment.id, 'amount', payment.amount_local);
END;
$$;
