/*
# Temporary demo pricing

CamPay is currently running through a demo account, so keep every real-money
relic purchase at 25 FCFA for now. The app and checkout function both read this
same database value, so the phone confirmation amount stays aligned with the
amount displayed in the platform.
*/

ALTER TABLE public.relic_types
  ALTER COLUMN money_price_xaf SET DEFAULT 25;

UPDATE public.relic_types
SET
  money_price_xaf = 25,
  money_price_usd = ROUND(25::numeric / 575, 2)
WHERE money_price_xaf IS DISTINCT FROM 25
   OR money_price_usd IS DISTINCT FROM ROUND(25::numeric / 575, 2);
