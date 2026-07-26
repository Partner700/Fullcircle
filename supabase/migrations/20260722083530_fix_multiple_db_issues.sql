/*
# Fix multiple database issues

1. role_assignments unique constraint
   - Add partial unique index on (user_id, role) WHERE status IN ('active','approved')
   - Fixes: signup "on conflict" error, promote cadet/sentry, sentry replacement

2. Widen denarii_ledger_entries source_type CHECK
   - Old constraint only allowed: game_level, game_blitz, quiz_reward, relic_purchase, admin_adjustment
   - Add: hint_purchase, answer_reveal, freezer_daily, freezer_weekly, attendance, arena_stake, arena_reward, mobile_money
   - Fixes: "ledger source type does not exist" error when purchasing relics/freezers

3. Fix awards.award_month
   - Change column type from date to text so YYYY-MM values work
   - Fixes: "column is date type but expression is type text" error

4. Add slugs to old relics
   - hint, eliminate, freeze_timer, skip, reveal_reference all have slug=NULL
   - Set slugs so purchase_relic can find them

5. Update relic prices
   - freeze_timer: 4000 -> 30 denarii
   - skip: 5000 -> 30 denarii

6. Add attendance denarii source_type
   - Already covered in #2 above
*/

-- 1. Unique constraint on role_assignments
CREATE UNIQUE INDEX IF NOT EXISTS idx_role_assignments_unique_active
  ON role_assignments (user_id, role)
  WHERE status IN ('active', 'approved');

-- 2. Widen source_type CHECK constraint
ALTER TABLE denarii_ledger_entries DROP CONSTRAINT IF EXISTS denarii_ledger_entries_source_type_check;
ALTER TABLE denarii_ledger_entries ADD CONSTRAINT denarii_ledger_entries_source_type_check
  CHECK (source_type IN (
    'game_level', 'game_blitz', 'quiz_reward', 'relic_purchase', 'admin_adjustment',
    'hint_purchase', 'answer_reveal', 'freezer_daily', 'freezer_weekly',
    'attendance', 'arena_stake', 'arena_reward', 'mobile_money'
  ));

-- 3. Fix awards.award_month column type
ALTER TABLE awards ALTER COLUMN award_month TYPE text USING award_month::text;

-- 4. Add slugs to old relics
UPDATE relic_types SET slug = 'hint' WHERE effect = 'hint' AND slug IS NULL;
UPDATE relic_types SET slug = 'eliminate' WHERE effect = 'eliminate' AND slug IS NULL;
UPDATE relic_types SET slug = 'freeze-timer' WHERE effect = 'freeze_timer' AND slug IS NULL;
UPDATE relic_types SET slug = 'skip' WHERE effect = 'skip' AND slug IS NULL;
UPDATE relic_types SET slug = 'reveal-reference' WHERE effect = 'reveal_reference' AND slug IS NULL;

-- 5. Update relic prices
UPDATE relic_types SET denarii_cost = 30 WHERE effect = 'freeze_timer';
UPDATE relic_types SET denarii_cost = 30 WHERE effect = 'skip';
