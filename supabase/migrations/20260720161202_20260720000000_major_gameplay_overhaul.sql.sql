/*
# Major Gameplay Overhaul — Part 1: Schema

## Summary
Implements: VOD/MOD/QOD narrative split, challenge report formats + reject/resubmit,
streak freezers, 31-day trial + subscription gating, role promotion RPCs, tent house leaderboard RPC,
denarii spend tracking for hints/answer reveals.

## Changes

### 1. daily_narratives — add VOD/MOD/QOD fields
- `verse_of_day` text — VOD: the verse of the day
- `meditation_of_day` text — MOD: the meditation of the day (longer reflection)
- `quote_of_day` text — QOD: one-line, one-phrase quote of the day

### 2. challenge_submissions — add format + status + rejection
- `proof_type` now supports: text, png, pdf, link, image
- `status` text DEFAULT 'pending' — pending/approved/rejected
- `rejection_reason` text — instructor's reason when rejecting
- `reviewed_at` timestamptz — when instructor reviewed
- `reviewed_by` uuid — instructor who reviewed
- Drop the UNIQUE(user_id, narrative_date) constraint to allow resubmission.
  Instead, only one 'pending'/'approved' submission per day via a partial unique index.

### 3. daily_narratives — challenge_proof_format
- `challenge_proof_format` text DEFAULT 'text' — instructor selects: text, png, pdf, link, image

### 4. New table: streak_freezers
- Tracks freezer purchases that protect a streak after an absent day.
- `id`, `user_id`, `freezer_type` ('daily'|'weekly'), `purchased_at`, `used_at`, `source` ('denarii'|'payment')

### 5. New table: subscriptions
- Tracks cadet payment/subscription state.
- `id`, `user_id`, `status` ('trial'|'active'|'expired'|'grace'), `trial_started_at`, `trial_ends_at`,
  `current_period_end`, `payment_method`, `payment_reference`, `amount`, `currency`

### 6. New table: denarii_purchases
- Tracks denarii spent on hints, answer reveals, and freezers.
- `id`, `user_id`, `purchase_type` ('hint'|'answer_reveal'|'freezer_daily'), `amount`, `reference_id`, `created_at`

### 7. game_attempts — add hint_used / answer_revealed columns
- `hint_used` boolean DEFAULT false
- `answer_revealed` boolean DEFAULT false

### 8. New RPCs
- `promote_to_sentry(p_user_id uuid, p_approver_id uuid)` — instructor promotes cadet to sentry
- `promote_to_instructor(p_new_instructor_id uuid, p_current_instructor_id uuid)` — current instructor promotes a sentry to instructor and demotes self
- `get_tent_house_leaderboard()` — returns tent houses ranked by aggregate denarii of their cadets
- `record_meditation_streak(p_user_id uuid, p_date date, p_text text)` — upserts daily_records meditation fields (streak = meditation only now)

### 9. RLS on all new tables — owner-scoped for cadets, full access for instructor via role check
*/

-- ═══════════════════════════════════════════════════════════════
-- 1. daily_narratives: VOD / MOD / QOD + challenge proof format
-- ═══════════════════════════════════════════════════════════════
ALTER TABLE daily_narratives
  ADD COLUMN IF NOT EXISTS verse_of_day text,
  ADD COLUMN IF NOT EXISTS meditation_of_day text,
  ADD COLUMN IF NOT EXISTS quote_of_day text,
  ADD COLUMN IF NOT EXISTS challenge_proof_format text DEFAULT 'text';

-- ═══════════════════════════════════════════════════════════════
-- 2. challenge_submissions: format + status + reject/resubmit
-- ═══════════════════════════════════════════════════════════════
ALTER TABLE challenge_submissions
  ADD COLUMN IF NOT EXISTS status text DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  ADD COLUMN IF NOT EXISTS rejection_reason text,
  ADD COLUMN IF NOT EXISTS reviewed_at timestamptz,
  ADD COLUMN IF NOT EXISTS reviewed_by uuid REFERENCES profiles(id) ON DELETE SET NULL;

-- Drop the old unique constraint that blocked resubmission
ALTER TABLE challenge_submissions DROP CONSTRAINT IF EXISTS challenge_submissions_user_id_narrative_date_key;

-- Only one active (pending or approved) submission per user per day
CREATE UNIQUE INDEX IF NOT EXISTS one_active_challenge_per_day
  ON challenge_submissions (user_id, narrative_date)
  WHERE status IN ('pending', 'approved');

-- ═══════════════════════════════════════════════════════════════
-- 3. streak_freezers table
-- ═══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS streak_freezers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  freezer_type text NOT NULL CHECK (freezer_type IN ('daily','weekly')),
  source text NOT NULL DEFAULT 'denarii' CHECK (source IN ('denarii','payment')),
  purchased_at timestamptz NOT NULL DEFAULT now(),
  used_at timestamptz,
  applied_to_date date
);

ALTER TABLE streak_freezers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_own_freezers" ON streak_freezers;
CREATE POLICY "select_own_freezers" ON streak_freezers FOR SELECT
  TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "insert_own_freezers" ON streak_freezers;
CREATE POLICY "insert_own_freezers" ON streak_freezers FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "update_own_freezers" ON streak_freezers;
CREATE POLICY "update_own_freezers" ON streak_freezers FOR UPDATE
  TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "instructor_read_freezers" ON streak_freezers;
CREATE POLICY "instructor_read_freezers" ON streak_freezers FOR SELECT
  TO authenticated USING (
    EXISTS (SELECT 1 FROM role_assignments ra WHERE ra.user_id = auth.uid() AND ra.role = 'instructor' AND ra.status = 'active')
  );

-- ═══════════════════════════════════════════════════════════════
-- 4. subscriptions table
-- ═══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES profiles(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'trial' CHECK (status IN ('trial','active','expired','grace')),
  trial_started_at timestamptz NOT NULL DEFAULT now(),
  trial_ends_at timestamptz NOT NULL DEFAULT (now() + interval '31 days'),
  current_period_end timestamptz,
  payment_method text,
  payment_reference text,
  amount numeric DEFAULT 0,
  currency text DEFAULT 'USD',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_own_subscription" ON subscriptions;
CREATE POLICY "select_own_subscription" ON subscriptions FOR SELECT
  TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "insert_own_subscription" ON subscriptions;
CREATE POLICY "insert_own_subscription" ON subscriptions FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "update_own_subscription" ON subscriptions;
CREATE POLICY "update_own_subscription" ON subscriptions FOR UPDATE
  TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "instructor_read_subscriptions" ON subscriptions;
CREATE POLICY "instructor_read_subscriptions" ON subscriptions FOR SELECT
  TO authenticated USING (
    EXISTS (SELECT 1 FROM role_assignments ra WHERE ra.user_id = auth.uid() AND ra.role = 'instructor' AND ra.status = 'active')
  );

-- Auto-create a trial subscription for every new profile
CREATE OR REPLACE FUNCTION create_trial_subscription()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO subscriptions (user_id, status, trial_started_at, trial_ends_at)
  VALUES (NEW.id, 'trial', now(), now() + interval '31 days')
  ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_profile_create_trial ON profiles;
CREATE TRIGGER on_profile_create_trial
  AFTER INSERT ON profiles
  FOR EACH ROW EXECUTE FUNCTION create_trial_subscription();

-- Backfill trials for existing profiles that don't have a subscription yet
INSERT INTO subscriptions (user_id, status, trial_started_at, trial_ends_at)
SELECT p.id, 'trial', p.created_at, p.created_at + interval '31 days'
FROM profiles p
LEFT JOIN subscriptions s ON s.user_id = p.id
WHERE s.id IS NULL;

-- ═══════════════════════════════════════════════════════════════
-- 5. denarii_purchases table
-- ═══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS denarii_purchases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  purchase_type text NOT NULL CHECK (purchase_type IN ('hint','answer_reveal','freezer_daily')),
  amount integer NOT NULL,
  reference_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE denarii_purchases ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_own_purchases" ON denarii_purchases;
CREATE POLICY "select_own_purchases" ON denarii_purchases FOR SELECT
  TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "insert_own_purchases" ON denarii_purchases;
CREATE POLICY "insert_own_purchases" ON denarii_purchases FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = user_id);

-- ═══════════════════════════════════════════════════════════════
-- 6. game_attempts: hint/answer reveal tracking
-- ═══════════════════════════════════════════════════════════════
ALTER TABLE game_attempts
  ADD COLUMN IF NOT EXISTS hint_used boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS answer_revealed boolean DEFAULT false;

-- ═══════════════════════════════════════════════════════════════
-- 7. RPC: promote cadet → sentry
-- ═══════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION promote_to_sentry(p_user_id uuid, p_approver_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_approver_is_instructor boolean;
BEGIN
  SELECT EXISTS(
    SELECT 1 FROM role_assignments
    WHERE user_id = p_approver_id AND role = 'instructor' AND status = 'active'
  ) INTO v_approver_is_instructor;
  IF NOT v_approver_is_instructor THEN
    RAISE EXCEPTION 'Only an active instructor can promote cadets to sentry';
  END IF;

  -- Mark existing cadet assignment as removed
  UPDATE role_assignments SET status = 'removed'
  WHERE user_id = p_user_id AND role = 'cadet' AND status IN ('active','approved');

  -- Insert new sentry assignment
  INSERT INTO role_assignments (user_id, role, status, approver_id, start_date)
  VALUES (p_user_id, 'sentry', 'active', p_approver_id, now()::date);
END;
$$;

-- ═══════════════════════════════════════════════════════════════
-- 8. RPC: promote sentry → instructor (current instructor demotes self)
-- ═══════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION promote_to_instructor(p_new_instructor_id uuid, p_current_instructor_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_is_instructor boolean;
BEGIN
  SELECT EXISTS(
    SELECT 1 FROM role_assignments
    WHERE user_id = p_current_instructor_id AND role = 'instructor' AND status = 'active'
  ) INTO v_is_instructor;
  IF NOT v_is_instructor THEN
    RAISE EXCEPTION 'Only the current active instructor can hand over the role';
  END IF;

  -- Demote current instructor
  UPDATE role_assignments SET status = 'removed'
  WHERE user_id = p_current_instructor_id AND role = 'instructor' AND status = 'active';

  -- Mark new instructor's sentry assignment as removed
  UPDATE role_assignments SET status = 'removed'
  WHERE user_id = p_new_instructor_id AND role = 'sentry' AND status IN ('active','approved');

  -- Insert new instructor assignment
  INSERT INTO role_assignments (user_id, role, status, approver_id, start_date)
  VALUES (p_new_instructor_id, 'instructor', 'active', p_current_instructor_id, now()::date);
END;
$$;

-- ═══════════════════════════════════════════════════════════════
-- 9. RPC: tent house leaderboard (aggregate denarii per tent house)
-- ═══════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION get_tent_house_leaderboard()
RETURNS TABLE (
  tent_house_id text,
  tent_house_name text,
  total_denarii bigint,
  cadet_count integer,
  rank integer
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT
    t.tent_house_id,
    th.name AS tent_house_name,
    COALESCE(SUM(d.total), 0)::bigint AS total_denarii,
    COUNT(DISTINCT tm.user_id)::integer AS cadet_count,
    ROW_NUMBER() OVER (ORDER BY COALESCE(SUM(d.total), 0) DESC) AS rank
  FROM tents t
  JOIN tent_houses th ON th.id = t.tent_house_id
  LEFT JOIN tent_members tm ON tm.tent_id = t.id AND tm.role = 'cadet'
  LEFT JOIN LATERAL (
    SELECT get_user_denarii_total(tm.user_id) AS total
  ) d ON true
  GROUP BY t.tent_house_id, th.name
  ORDER BY total_denarii DESC;
END;
$$;

-- ═══════════════════════════════════════════════════════════════
-- 10. RPC: record meditation streak (streak = meditation only)
-- ═══════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION record_meditation_streak(p_user_id uuid, p_date date, p_text text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_day_type text;
  v_existing record;
BEGIN
  v_day_type := CASE
    WHEN EXTRACT(dow FROM p_date) = 6 THEN 'saturday'
    WHEN EXTRACT(dow FROM p_date) = 0 THEN 'sunday'
    ELSE 'weekday'
  END;

  SELECT * INTO v_existing FROM daily_records WHERE user_id = p_user_id AND record_date = p_date;

  IF v_existing IS NOT NULL THEN
    UPDATE daily_records SET
      meditation_submitted = true,
      meditation_submitted_at = now(),
      meditation_text = p_text
    WHERE user_id = p_user_id AND record_date = p_date;
  ELSE
    INSERT INTO daily_records (user_id, record_date, day_type, meditation_submitted, meditation_submitted_at, meditation_text)
    VALUES (p_user_id, p_date, v_day_type::day_type, true, now(), p_text);
  END IF;
END;
$$;

-- ═══════════════════════════════════════════════════════════════
-- 11. RPC: check subscription status
-- ═══════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION get_subscription_status(p_user_id uuid)
RETURNS TABLE (status text, trial_ends_at timestamptz, current_period_end timestamptz, is_paid boolean)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_sub record;
BEGIN
  SELECT * INTO v_sub FROM subscriptions WHERE user_id = p_user_id;
  IF v_sub IS NULL THEN
    RETURN QUERY SELECT 'trial'::text, (now() + interval '31 days')::timestamptz, NULL::timestamptz, false;
    RETURN;
  END IF;

  IF v_sub.status = 'active' AND v_sub.current_period_end IS NOT NULL AND v_sub.current_period_end < now() THEN
    UPDATE subscriptions SET status = 'expired', updated_at = now() WHERE user_id = p_user_id;
    RETURN QUERY SELECT 'expired'::text, v_sub.trial_ends_at, v_sub.current_period_end, false;
  ELSIF v_sub.status = 'trial' AND v_sub.trial_ends_at < now() THEN
    UPDATE subscriptions SET status = 'expired', updated_at = now() WHERE user_id = p_user_id;
    RETURN QUERY SELECT 'expired'::text, v_sub.trial_ends_at, v_sub.current_period_end, false;
  ELSE
    RETURN QUERY SELECT v_sub.status, v_sub.trial_ends_at, v_sub.current_period_end, v_sub.status = 'active';
  END IF;
END;
$$;

-- ═══════════════════════════════════════════════════════════════
-- 12. Update challenge_submissions RLS for new columns + instructor review
-- ═══════════════════════════════════════════════════════════════
-- Cadets can still insert/update their own submissions
-- Instructors can read all + update status/rejection_reason
DROP POLICY IF EXISTS "instructor_update_challenge_status" ON challenge_submissions;
CREATE POLICY "instructor_update_challenge_status" ON challenge_submissions FOR UPDATE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM role_assignments ra WHERE ra.user_id = auth.uid() AND ra.role = 'instructor' AND ra.status = 'active')
  ) WITH CHECK (
    EXISTS (SELECT 1 FROM role_assignments ra WHERE ra.user_id = auth.uid() AND ra.role = 'instructor' AND ra.status = 'active')
  );

DROP POLICY IF EXISTS "instructor_read_challenges" ON challenge_submissions;
CREATE POLICY "instructor_read_challenges" ON challenge_submissions FOR SELECT
  TO authenticated USING (
    auth.uid() = user_id OR
    EXISTS (SELECT 1 FROM role_assignments ra WHERE ra.user_id = auth.uid() AND ra.role = 'instructor' AND ra.status = 'active')
  );
