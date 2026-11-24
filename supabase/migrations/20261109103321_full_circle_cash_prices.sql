-- These are XAF prices. Denarii balances and costs are independent.
UPDATE public.relic_types AS relic
SET money_price_xaf = price.xaf, money_price_usd = NULL
FROM (VALUES
  ('skip', 300),
  ('shield-of-faith', 300),
  ('reveal-reference', 300),
  ('freeze-timer', 300),
  ('witch-ball-endor', 300),
  ('hezekiahs-sundial', 300),
  ('sword-goliath', 300),
  ('masters-reward', 300),
  ('simons-purse', 3000),
  ('lazarus-coin', 3000),
  ('thieves-request', 5000),
  ('redemption-coin', 15000)
) AS price(slug, xaf)
WHERE relic.slug = price.slug AND relic.is_active;

UPDATE public.subscription_plans
SET amount_xaf = 2000, updated_at = now()
WHERE id = 'monthly';
