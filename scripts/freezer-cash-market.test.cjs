const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const store = readFileSync('src/screens/cadet/CadetStore.tsx', 'utf8');
const cart = readFileSync('src/components/FcxFapshiCheckout.tsx', 'utf8');
const sql = readFileSync('supabase/migrations/20261125074000_market_cash_freezers_daily_300_weekly_500.sql', 'utf8');
const currentPricing = readFileSync('supabase/migrations/20261125085000_lower_daily_freezer_cash_price_to_200.sql', 'utf8');
for (const value of [
  "relicSlug: 'streak-freezer-daily', unitPrice: 200",
  "relicSlug: 'streak-freezer-weekly', unitPrice: 500",
  "{FREEZER_DAILY_COST} Ð",
  "formatDenarii(FREEZER_WEEKLY_COST)",
]) assert.ok(store.includes(value), 'Missing market offer: ' + value);
assert.ok(cart.includes("line.relicSlug ? [{ slug: line.relicSlug"), 'Cart must transmit freezer slug');
for (const value of [
  
  "p_verified_amount IS DISTINCT FROM payment.amount_local",
  "payment.status = 'confirmed'",
  "freezer_daily_quantity",
  "freezer_weekly_quantity",
  "SELECT payment.user_id,'daily','payment'",
  "SELECT payment.user_id,'weekly','payment'",
]) assert.ok(sql.includes(value), 'Missing protected server settlement: ' + value);
assert.ok(currentPricing.includes('v_daily_freezers * 200 + v_weekly_freezers * 500'), 'Current cash price must be 200/500 FCFA');
assert.ok(!sql.includes("'daily','cash'") && !sql.includes("'weekly','cash'"), 'Cash is not a valid freezer source');
console.log('Freezer cash purchase catalogue and settlement integrity checks passed.');
