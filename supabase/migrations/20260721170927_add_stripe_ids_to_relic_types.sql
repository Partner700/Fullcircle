/*
# Add Stripe product/price IDs to relic_types

1. Changes
- Add `stripe_product_id` (text, nullable) — stores the Stripe Product ID
  for each relic that has a real-money price.
- Add `stripe_price_id` (text, nullable) — stores the Stripe Price ID
  used at checkout.
- These are populated by the sync-stripe-products edge function and
  used by the create-checkout-session edge function to build Checkout
  Sessions.
2. Security
- No RLS changes. relic_types existing policies remain in effect.
3. Notes
- Both columns are nullable so relics without real-money prices
  (denarii-only or quiz aids) are unaffected.
- The edge function updates these columns idempotently on each sync.
*/

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'relic_types' AND column_name = 'stripe_product_id'
  ) THEN
    ALTER TABLE relic_types ADD COLUMN stripe_product_id text;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'relic_types' AND column_name = 'stripe_price_id'
  ) THEN
    ALTER TABLE relic_types ADD COLUMN stripe_price_id text;
  END IF;
END $$;
