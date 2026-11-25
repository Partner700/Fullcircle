const assert = require('node:assert/strict');
const fs = require('node:fs');
const migration=fs.readFileSync('supabase/migrations/20261125095000_sentry_weekly_freezer_cadet_gifts.sql','utf8');
const ui=fs.readFileSync('src/screens/cadet/CadetStore.tsx','utf8');
const queries=fs.readFileSync('src/lib/queries.ts','utf8');
for (const marker of [
  'public.purchase_weekly_freezer_for_cadet',
  'public.assert_sentry_can_gift_cadet(p_sentry_id,p_cadet_id)',
  'v_cost integer := 18000',
  "VALUES (p_cadet_id,'weekly','denarii')",
  'v_freezer_id::text',
  'v_weekly_freezers * 500',
  "SELECT coalesce((payment.purchase_metadata->>'gift_recipient_id')::uuid,payment.user_id),'weekly','payment'",
  'public.is_sentry(p_user_id)',
  'cadet.tent_id = sentry.tent_id',
]) assert.ok(migration.includes(marker),'Missing server gift protection: '+marker);
assert.ok(queries.includes("supabase.rpc('purchase_weekly_freezer_for_cadet'"));
assert.ok(ui.includes("await purchaseWeeklyFreezerForCadet(profile.id, giftRecipientId)"));
assert.ok(ui.includes("await purchaseWeeklyFreezer(profile.id)"));
assert.ok(!ui.includes("giftRecipientId !== 'self' || denarii < FREEZER_WEEKLY_COST"));
assert.ok(ui.includes("Sentries can gift Weekly Freezers to active cadets in their own tent."));
console.log('Weekly Freezer sentry gift permissions, recipient delivery and pricing checks passed.');
