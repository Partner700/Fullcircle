/*
# Major Game / Store / Relics / Awards / Custom Questions Overhaul

## Summary
1. Drops restrictive check constraints on relic_types to allow new effect values
2. Seeds 5 biblical relic types with denarii + real-money prices
3. Creates custom_questions table for instructor-written quiz questions
4. Adds award_target_type + award_target_id to awards table
5. Creates avatars storage bucket for profile pictures
6. Adds strict streak RPC (one miss = full reset, only freezer saves)
7. Adds relic purchase + use RPCs
8. Adds currency detection based on whatsapp number
9. Fixes promotion RPCs
10. Adds record_meditation_streak RPC

## New Tables
- custom_questions: instructor-authored quiz questions

## Modified Tables
- relic_types: adds slug, money_price_usd, effect_type columns; drops old check constraints
- awards: adds award_target_type, award_target_id
*/

-- ═══════════════════════════════════════════════════
-- 0. DROP RESTRICTIVE CHECK CONSTRAINTS ON relic_types
-- ═══════════════════════════════════════════════════
DO $$
DECLARE
  c record;
BEGIN
  FOR c IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'relic_types'::regclass AND contype = 'c'
  LOOP
    EXECUTE format('ALTER TABLE relic_types DROP CONSTRAINT IF EXISTS %I', c.conname);
  END LOOP;
END $$;

-- ═══════════════════════════════════════════════════
-- 1. RELIC TYPES — add columns + seed 5 relics
-- ═══════════════════════════════════════════════════

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'relic_types' AND column_name = 'slug') THEN
    ALTER TABLE relic_types ADD COLUMN slug text UNIQUE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'relic_types' AND column_name = 'money_price_usd') THEN
    ALTER TABLE relic_types ADD COLUMN money_price_usd numeric DEFAULT 0;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'relic_types' AND column_name = 'effect_type') THEN
    ALTER TABLE relic_types ADD COLUMN effect_type text;
  END IF;
END $$;

INSERT INTO relic_types (id, slug, name, description, effect, effect_type, rarity, denarii_cost, money_price_usd, effect_scope, icon)
VALUES
  ('00000000-0000-0000-0000-000000000001', 'witch-ball-endor', 'Crystal Ball of Endor',
   'The medium of Endor summoned what could not be seen. This orb reveals the correct answer to any single question.',
   'reveal_answer', 'reveal_answer', 'legendary', 2000, 4.99, 'single_question', 'crystal-ball'),
  ('00000000-0000-0000-0000-000000000002', 'sword-goliath', 'Sword of Goliath',
   'No sword like the sword of Goliath — it was given to David. This blade reveals a hint for any question.',
   'reveal_hint', 'reveal_hint', 'epic', 1200, 2.99, 'single_question', 'sword'),
  ('00000000-0000-0000-0000-000000000003', 'talking-donkey', 'The Talking Donkey',
   'Balaam''s donkey saw what the prophet could not. This donkey alerts you when a wrong answer is selected, before you submit.',
   'wrong_answer_alert', 'wrong_answer_alert', 'epic', 1500, 3.49, 'single_question', 'donkey'),
  ('00000000-0000-0000-0000-000000000004', 'simons-purse', 'Simon''s Purse',
   'Simon the sorcerer offered money for the gift of God. This purse buys a full week of streak protection.',
   'streak_shield_week', 'streak_shield_week', 'legendary', 5000, 9.99, 'seven_days', 'purse'),
  ('00000000-0000-0000-0000-000000000005', 'thieves-request', 'The Thief''s Request',
   'Remember me when you come into your kingdom. The most precious relic — revives a completely lost streak.',
   'revive_lost_streak', 'revive_lost_streak', 'legendary', 8000, 14.99, 'single_use', 'cross')
ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name, description = EXCLUDED.description, effect = EXCLUDED.effect,
  effect_type = EXCLUDED.effect_type, rarity = EXCLUDED.rarity, denarii_cost = EXCLUDED.denarii_cost,
  money_price_usd = EXCLUDED.money_price_usd, effect_scope = EXCLUDED.effect_scope, icon = EXCLUDED.icon;

-- ═══════════════════════════════════════════════════
-- 2. CUSTOM QUESTIONS TABLE
-- ═══════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS custom_questions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  instructor_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  quiz_session_id uuid REFERENCES quiz_sessions(id) ON DELETE CASCADE,
  question_text text NOT NULL,
  question_type text NOT NULL DEFAULT 'multiple_choice',
  options jsonb,
  correct_answer text NOT NULL,
  explanation text,
  difficulty_tag text DEFAULT 'moderate',
  question_index integer DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE custom_questions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "instructor_select_custom_questions" ON custom_questions;
CREATE POLICY "instructor_select_custom_questions" ON custom_questions FOR SELECT
  TO authenticated USING (true);

DROP POLICY IF EXISTS "instructor_insert_custom_questions" ON custom_questions;
CREATE POLICY "instructor_insert_custom_questions" ON custom_questions FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = instructor_id);

DROP POLICY IF EXISTS "instructor_update_custom_questions" ON custom_questions;
CREATE POLICY "instructor_update_custom_questions" ON custom_questions FOR UPDATE
  TO authenticated USING (auth.uid() = instructor_id) WITH CHECK (auth.uid() = instructor_id);

DROP POLICY IF EXISTS "instructor_delete_custom_questions" ON custom_questions;
CREATE POLICY "instructor_delete_custom_questions" ON custom_questions FOR DELETE
  TO authenticated USING (auth.uid() = instructor_id);

-- ═══════════════════════════════════════════════════
-- 3. AWARDS — add target type columns
-- ═══════════════════════════════════════════════════

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'awards' AND column_name = 'award_target_type') THEN
    ALTER TABLE awards ADD COLUMN award_target_type text DEFAULT 'cadet';
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'awards' AND column_name = 'award_target_id') THEN
    ALTER TABLE awards ADD COLUMN award_target_id uuid;
  END IF;
END $$;

-- ═══════════════════════════════════════════════════
-- 4. AVATARS STORAGE BUCKET
-- ═══════════════════════════════════════════════════

INSERT INTO storage.buckets (id, name, public) VALUES ('avatars', 'avatars', true)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "avatar_read_all" ON storage.objects;
CREATE POLICY "avatar_read_all" ON storage.objects FOR SELECT
  TO anon, authenticated USING (bucket_id = 'avatars');

DROP POLICY IF EXISTS "avatar_upload_own" ON storage.objects;
CREATE POLICY "avatar_upload_own" ON storage.objects FOR INSERT
  TO authenticated WITH CHECK (bucket_id = 'avatars' AND (storage.foldername(name))[1] = auth.uid()::text);

DROP POLICY IF EXISTS "avatar_update_own" ON storage.objects;
CREATE POLICY "avatar_update_own" ON storage.objects FOR UPDATE
  TO authenticated USING (bucket_id = 'avatars' AND (storage.foldername(name))[1] = auth.uid()::text)
  WITH CHECK (bucket_id = 'avatars' AND (storage.foldername(name))[1] = auth.uid()::text);

DROP POLICY IF EXISTS "avatar_delete_own" ON storage.objects;
CREATE POLICY "avatar_delete_own" ON storage.objects FOR DELETE
  TO authenticated USING (bucket_id = 'avatars' AND (storage.foldername(name))[1] = auth.uid()::text);

-- ═══════════════════════════════════════════════════
-- 5. STRICT STREAK RPC
-- ═══════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION compute_strict_streak(p_user_id uuid)
RETURNS TABLE(current_streak integer, longest_streak integer, consecutive_inactive integer, cumulative_inactive integer)
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  v_med boolean; v_current int := 0; v_longest int := 0;
  v_consec int := 0; v_cum int := 0;
  v_today date := CURRENT_DATE; v_check date;
  v_has_freezer boolean; v_weekly_shield boolean;
BEGIN
  v_check := v_today;
  LOOP
    IF EXTRACT(DOW FROM v_check) = 0 THEN v_check := v_check - 1; CONTINUE; END IF;
    SELECT meditation_submitted INTO v_med FROM daily_records WHERE user_id = p_user_id AND record_date = v_check::text;
    SELECT EXISTS(SELECT 1 FROM streak_freezers WHERE user_id = p_user_id AND freezer_type = 'weekly' AND source = 'relic'
      AND used_at IS NULL AND purchased_at > v_check - 8) INTO v_weekly_shield;
    SELECT EXISTS(SELECT 1 FROM streak_freezers WHERE user_id = p_user_id AND used_at IS NULL AND freezer_type = 'daily'
      AND (applied_to_date IS NULL OR applied_to_date = v_check::text) LIMIT 1) INTO v_has_freezer;
    IF v_med = true THEN v_current := v_current + 1; v_consec := 0;
    ELSIF v_weekly_shield OR v_has_freezer THEN v_current := v_current + 1; v_consec := 0;
    ELSIF v_med = false THEN v_consec := v_consec + 1; v_cum := v_cum + 1; v_current := 0; EXIT;
    ELSIF v_check < v_today THEN v_consec := v_consec + 1; v_cum := v_cum + 1; v_current := 0; EXIT;
    END IF;
    IF v_current > v_longest THEN v_longest := v_current; END IF;
    IF v_check < v_today - 365 THEN EXIT; END IF;
    v_check := v_check - 1;
  END LOOP;
  RETURN QUERY SELECT v_current, v_longest, v_consec, v_cum;
END;
$$;

-- ═══════════════════════════════════════════════════
-- 6. PURCHASE RELIC RPC
-- ═══════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION purchase_relic(p_user_id uuid, p_relic_slug text, p_currency text DEFAULT 'denarii')
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE v_relic RECORD; v_balance numeric; v_existing RECORD; v_result jsonb;
BEGIN
  SELECT * INTO v_relic FROM relic_types WHERE slug = p_relic_slug;
  IF NOT FOUND THEN RAISE EXCEPTION 'Relic not found'; END IF;
  IF p_currency = 'denarii' THEN
    SELECT COALESCE(SUM(amount), 0) INTO v_balance FROM denarii_ledger_entries WHERE user_id = p_user_id;
    IF v_balance < v_relic.denarii_cost THEN
      RAISE EXCEPTION 'Insufficient denarii. You need % but have %.', v_relic.denarii_cost, v_balance;
    END IF;
    INSERT INTO denarii_ledger_entries (user_id, amount, source_type, description)
    VALUES (p_user_id, -v_relic.denarii_cost, 'relic_purchase'::ledger_source_type, 'Purchased ' || v_relic.name);
  END IF;
  SELECT * INTO v_existing FROM relic_inventory WHERE user_id = p_user_id AND relic_type_id = v_relic.id LIMIT 1;
  IF FOUND THEN UPDATE relic_inventory SET quantity = quantity + 1 WHERE id = v_existing.id;
  ELSE INSERT INTO relic_inventory (user_id, relic_type_id, quantity, source_description)
    VALUES (p_user_id, v_relic.id, 1, 'Purchased with ' || p_currency);
  END IF;
  v_result := jsonb_build_object('success', true, 'method', p_currency, 'relic_id', v_relic.id::text);
  RETURN v_result;
END;
$$;

-- ═══════════════════════════════════════════════════
-- 7. USE RELIC RPC
-- ═══════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION use_relic(p_user_id uuid, p_relic_slug text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE v_inv RECORD; v_relic RECORD; v_result jsonb;
BEGIN
  SELECT * INTO v_relic FROM relic_types WHERE slug = p_relic_slug;
  IF NOT FOUND THEN RAISE EXCEPTION 'Relic not found'; END IF;
  SELECT * INTO v_inv FROM relic_inventory WHERE user_id = p_user_id AND relic_type_id = v_relic.id AND quantity > 0 LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'You do not own this relic'; END IF;
  UPDATE relic_inventory SET quantity = quantity - 1 WHERE id = v_inv.id;
  IF v_relic.effect_type = 'revive_lost_streak' THEN
    INSERT INTO streak_freezers (user_id, freezer_type, source, applied_to_date)
    SELECT p_user_id, 'weekly', 'relic', d.record_date FROM daily_records d
    WHERE d.user_id = p_user_id AND d.meditation_submitted = false
      AND d.record_date = (SELECT MAX(record_date) FROM daily_records WHERE user_id = p_user_id AND meditation_submitted = false) LIMIT 1;
    IF NOT FOUND THEN
      INSERT INTO streak_freezers (user_id, freezer_type, source, applied_to_date)
      VALUES (p_user_id, 'weekly', 'relic', (CURRENT_DATE - 1)::text);
    END IF;
  ELSIF v_relic.effect_type = 'streak_shield_week' THEN
    INSERT INTO streak_freezers (user_id, freezer_type, source) SELECT p_user_id, 'daily', 'relic' FROM generate_series(1, 7);
  END IF;
  v_result := jsonb_build_object('success', true, 'effect', v_relic.effect_type);
  RETURN v_result;
END;
$$;

-- ═══════════════════════════════════════════════════
-- 8. AWARD RPCs
-- ═══════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION give_award(
  p_user_id uuid, p_title text, p_description text DEFAULT NULL,
  p_award_type text DEFAULT 'individual', p_award_month text DEFAULT NULL,
  p_metric_value numeric DEFAULT NULL, p_target_type text DEFAULT 'cadet', p_target_id uuid DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE v_id uuid;
BEGIN
  INSERT INTO awards (user_id, title, description, award_type, award_month, metric_value, award_target_type, award_target_id)
  VALUES (p_user_id, p_title, p_description, p_award_type, COALESCE(p_award_month, to_char(CURRENT_DATE, 'YYYY-MM')),
    p_metric_value, p_target_type, COALESCE(p_target_id, p_user_id))
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION award_tent(p_tent_id uuid, p_title text, p_description text DEFAULT NULL, p_award_month text DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE v_count int := 0; v_member RECORD;
BEGIN
  FOR v_member IN SELECT user_id FROM tent_members WHERE tent_id = p_tent_id AND role = 'cadet' LOOP
    INSERT INTO awards (user_id, title, description, award_type, award_month, award_target_type, award_target_id)
    VALUES (v_member.user_id, p_title, p_description, 'tent', COALESCE(p_award_month, to_char(CURRENT_DATE, 'YYYY-MM')), 'tent', p_tent_id);
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END;
$$;

-- ═══════════════════════════════════════════════════
-- 9. PROMOTION RPCs
-- ═══════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION promote_to_sentry(p_user_id uuid, p_approver_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE v_is_instructor boolean;
BEGIN
  SELECT EXISTS(SELECT 1 FROM role_assignments WHERE user_id = p_approver_id AND role = 'instructor' AND status IN ('active','approved')) INTO v_is_instructor;
  IF NOT v_is_instructor THEN RAISE EXCEPTION 'Only instructors can promote cadets'; END IF;
  UPDATE role_assignments SET status = 'removed' WHERE user_id = p_user_id AND role = 'cadet' AND status IN ('active','approved');
  INSERT INTO role_assignments (user_id, role, status, approver_id, start_date)
  VALUES (p_user_id, 'sentry', 'active', p_approver_id, CURRENT_DATE) ON CONFLICT DO NOTHING;
END;
$$;

CREATE OR REPLACE FUNCTION promote_to_instructor(p_new_instructor_id uuid, p_current_instructor_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE v_is_instructor boolean; v_is_sentry boolean;
BEGIN
  SELECT EXISTS(SELECT 1 FROM role_assignments WHERE user_id = p_current_instructor_id AND role = 'instructor' AND status IN ('active','approved')) INTO v_is_instructor;
  IF NOT v_is_instructor THEN RAISE EXCEPTION 'Only the current instructor can hand over'; END IF;
  SELECT EXISTS(SELECT 1 FROM role_assignments WHERE user_id = p_new_instructor_id AND role = 'sentry' AND status IN ('active','approved')) INTO v_is_sentry;
  IF NOT v_is_sentry THEN RAISE EXCEPTION 'Only sentries can be promoted to instructor'; END IF;
  UPDATE role_assignments SET status = 'removed' WHERE user_id = p_current_instructor_id AND role = 'instructor';
  UPDATE role_assignments SET status = 'removed' WHERE user_id = p_new_instructor_id AND role = 'sentry';
  INSERT INTO role_assignments (user_id, role, status, approver_id, start_date)
  VALUES (p_new_instructor_id, 'instructor', 'active', p_current_instructor_id, CURRENT_DATE) ON CONFLICT DO NOTHING;
END;
$$;

-- ═══════════════════════════════════════════════════
-- 10. CURRENCY DETECTION
-- ═══════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION get_currency_for_user(p_user_id uuid)
RETURNS TABLE(currency_code text, symbol text, rate_to_usd numeric)
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE v_phone text;
BEGIN
  SELECT whatsapp_number INTO v_phone FROM profiles WHERE id = p_user_id;
  RETURN QUERY
  SELECT c.code, c.symbol, c.rate::numeric FROM (
    VALUES ('USD','$',1.0),('NGN','₦',1500.0),('KES','KSh',129.0),('GHS','GH₵',15.0),('ZAR','R',18.5),('EUR','€',0.92),('GBP','£',0.79)
  ) AS c(code, symbol, rate)
  WHERE c.code = CASE
    WHEN v_phone LIKE '+234%' THEN 'NGN' WHEN v_phone LIKE '+254%' THEN 'KES'
    WHEN v_phone LIKE '+233%' THEN 'GHS' WHEN v_phone LIKE '+27%' THEN 'ZAR'
    WHEN v_phone LIKE '+44%' THEN 'GBP'
    WHEN v_phone LIKE '+33%' OR v_phone LIKE '+49%' OR v_phone LIKE '+34%' THEN 'EUR'
    ELSE 'USD'
  END;
END;
$$;

-- ═══════════════════════════════════════════════════
-- 11. RECORD MEDITATION STREAK
-- ═══════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION record_meditation_streak(p_user_id uuid, p_date text, p_meditation_text text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO daily_records (user_id, record_date, day_type, meditation_submitted, meditation_submitted_at, meditation_text, streak_valid)
  VALUES (p_user_id, p_date,
    CASE WHEN EXTRACT(DOW FROM p_date::date) = 0 THEN 'sunday' WHEN EXTRACT(DOW FROM p_date::date) = 6 THEN 'saturday' ELSE 'weekday' END,
    true, now(), p_meditation_text, true)
  ON CONFLICT (user_id, record_date) DO UPDATE SET
    meditation_submitted = true, meditation_submitted_at = now(),
    meditation_text = COALESCE(p_meditation_text, daily_records.meditation_text), streak_valid = true;
END;
$$;

-- ═══════════════════════════════════════════════════
-- 12. GRANTS
-- ═══════════════════════════════════════════════════

GRANT SELECT, INSERT, UPDATE, DELETE ON custom_questions TO authenticated;
GRANT SELECT ON relic_types TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON relic_inventory TO authenticated;
GRANT SELECT, INSERT ON streak_freezers TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON awards TO authenticated;
GRANT EXECUTE ON FUNCTION compute_strict_streak(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION purchase_relic(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION use_relic(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION give_award(uuid, text, text, text, text, numeric, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION award_tent(uuid, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION promote_to_sentry(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION promote_to_instructor(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION get_currency_for_user(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION record_meditation_streak(uuid, text, text) TO authenticated;
