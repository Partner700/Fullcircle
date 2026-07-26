/*
# Add explicit XAF prices for every relic

Cameroon mobile money payments must charge the same FCFA amount the cadet sees
in the store. Keep the older USD column for compatibility, but make XAF the
authoritative checkout price.
*/

ALTER TABLE public.relic_types
  ADD COLUMN IF NOT EXISTS money_price_xaf integer;

ALTER TABLE public.relic_types
  ALTER COLUMN money_price_xaf SET DEFAULT 575;

UPDATE public.relic_types
SET money_price_xaf = CASE slug
  WHEN 'skip' THEN 575
  WHEN 'freeze-timer' THEN 575
  WHEN 'hint' THEN 850
  WHEN 'eliminate' THEN 850
  WHEN 'reveal-reference' THEN 1150
  WHEN 'sword-goliath' THEN 2875
  WHEN 'talking-donkey' THEN 3450
  WHEN 'witch-ball-endor' THEN 5750
  WHEN 'simons-purse' THEN 8625
  WHEN 'thieves-request' THEN 14375
  ELSE money_price_xaf
END
WHERE slug IN (
  'skip',
  'freeze-timer',
  'hint',
  'eliminate',
  'reveal-reference',
  'sword-goliath',
  'talking-donkey',
  'witch-ball-endor',
  'simons-purse',
  'thieves-request'
);

UPDATE public.relic_types
SET money_price_xaf = GREATEST(
  575,
  ROUND(
    COALESCE(NULLIF(money_price_usd, 0), GREATEST(denarii_cost, 1)::numeric / 100) * 575
  )::integer
)
WHERE money_price_xaf IS NULL OR money_price_xaf <= 0;

UPDATE public.relic_types
SET money_price_usd = ROUND(money_price_xaf::numeric / 575, 2)
WHERE COALESCE(money_price_usd, 0) <= 0
  AND money_price_xaf > 0;

ALTER TABLE public.relic_types
  ALTER COLUMN money_price_xaf SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'relic_types_money_price_xaf_positive'
  ) THEN
    ALTER TABLE public.relic_types
      ADD CONSTRAINT relic_types_money_price_xaf_positive CHECK (money_price_xaf > 0);
  END IF;
END $$;
