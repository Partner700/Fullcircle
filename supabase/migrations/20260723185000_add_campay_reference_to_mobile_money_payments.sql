/*
# Add Campay payment reference

Stores the Campay transaction reference returned by the payment-link API so
the webhook can match successful payments back to pending relic purchases.
*/

ALTER TABLE mobile_money_payments
ADD COLUMN IF NOT EXISTS reference text;

CREATE UNIQUE INDEX IF NOT EXISTS idx_mobile_money_payments_reference
ON mobile_money_payments(reference)
WHERE reference IS NOT NULL;
