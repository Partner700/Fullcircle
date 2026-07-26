/*
# Major Platform Overhaul

## Summary
1. Quiz sessions: add quiz_type (saturday/fortune) and reward fields
2. Daily records: add best_verse, daily_quote, attendance_late columns
3. New tent_messages table for tent-only messaging
4. Relic prices updated to reflect game value
5. Arena game call costs 10 denarii fee
6. Simon's Purse: 5-day absence streak protection, supersedes freezers
7. Saturday quiz: sole streak validation, annuls Simon's Purse + freezers
8. Fortune quiz: 1 talent (6000) perfect, 1000 partial
9. submit_quiz_attempt RPC for quiz rewards
10. is_saturday_quiz_scheduled RPC
11. get_unassigned_users RPC
*/

-- 1. Quiz sessions: add quiz_type and reward fields
ALTER TABLE quiz_sessions ADD COLUMN IF NOT EXISTS quiz_type text DEFAULT 'saturday';
ALTER TABLE quiz_sessions ADD COLUMN IF NOT EXISTS reward_perfect integer DEFAULT 6000;
ALTER TABLE quiz_sessions ADD COLUMN IF NOT EXISTS reward_partial integer DEFAULT 1000;

-- 2. Daily records: add meditation sub-fields and late attendance
ALTER TABLE daily_records ADD COLUMN IF NOT EXISTS best_verse text;
ALTER TABLE daily_records ADD COLUMN IF NOT EXISTS daily_quote text;
ALTER TABLE daily_records ADD COLUMN IF NOT EXISTS attendance_late boolean DEFAULT false;

-- 3. Tent messages table
CREATE TABLE IF NOT EXISTS tent_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tent_id uuid REFERENCES tents(id) ON DELETE CASCADE,
  sender_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  recipient_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  body text NOT NULL,
  read_at timestamptz,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE tent_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_own_tent_messages" ON tent_messages;
CREATE POLICY "select_own_tent_messages" ON tent_messages
  FOR SELECT TO authenticated
  USING (sender_id = auth.uid() OR recipient_id = auth.uid());

DROP POLICY IF EXISTS "insert_own_tent_messages" ON tent_messages;
CREATE POLICY "insert_own_tent_messages" ON tent_messages
  FOR INSERT TO authenticated
  WITH CHECK (sender_id = auth.uid());

DROP POLICY IF EXISTS "update_own_tent_messages" ON tent_messages;
CREATE POLICY "update_own_tent_messages" ON tent_messages
  FOR UPDATE TO authenticated
  USING (recipient_id = auth.uid()) WITH CHECK (recipient_id = auth.uid());

DROP POLICY IF EXISTS "delete_own_tent_messages" ON tent_messages;
CREATE POLICY "delete_own_tent_messages" ON tent_messages
  FOR DELETE TO authenticated
  USING (sender_id = auth.uid());

CREATE INDEX IF NOT EXISTS idx_tent_messages_tent ON tent_messages(tent_id);
CREATE INDEX IF NOT EXISTS idx_tent_messages_recipient ON tent_messages(recipient_id);

-- 4. Update relic prices to reflect game value
UPDATE relic_types SET denarii_cost = 50, money_price_usd = '0.99' WHERE slug = 'skip';
UPDATE relic_types SET denarii_cost = 50, money_price_usd = '0.99' WHERE slug = 'freeze-timer';
UPDATE relic_types SET denarii_cost = 80, money_price_usd = '1.49' WHERE slug = 'hint';
UPDATE relic_types SET denarii_cost = 80, money_price_usd = '0' WHERE slug = 'eliminate';
UPDATE relic_types SET denarii_cost = 200, money_price_usd = '0' WHERE slug = 'reveal-reference';
UPDATE relic_types SET denarii_cost = 300, money_price_usd = '4.99' WHERE slug = 'sword-goliath';
UPDATE relic_types SET denarii_cost = 500, money_price_usd = '5.99' WHERE slug = 'talking-donkey';
UPDATE relic_types SET denarii_cost = 1000, money_price_usd = '9.99' WHERE slug = 'witch-ball-endor';
UPDATE relic_types SET denarii_cost = 3000, money_price_usd = '14.99' WHERE slug = 'simons-purse';
UPDATE relic_types SET denarii_cost = 6000, money_price_usd = '24.99' WHERE slug = 'thieves-request';

UPDATE relic_types
SET description = 'Keep your streak alive for 5 days of absence. Supersedes freezers — freezers do not work while Simon''s Purse is active.',
    effect = 'streak_shield_5day'
WHERE slug = 'simons-purse';

-- 5. Arena: add game_call_fee column
ALTER TABLE arena_rooms ADD COLUMN IF NOT EXISTS game_call_fee integer DEFAULT 10;

-- 6. Update compute_strict_streak with Simon's Purse + Saturday quiz logic
CREATE OR REPLACE FUNCTION public.compute_strict_streak(p_user_id uuid)
RETURNS TABLE(current_streak integer, longest_streak integer, consecutive_inactive integer, cumulative_inactive integer)
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
  v_med boolean;
  v_current int := 0;
  v_longest int := 0;
  v_consec int := 0;
  v_cum int := 0;
  v_today date := CURRENT_DATE;
  v_check date;
  v_freezer_available boolean;
  v_simons_purse_active boolean;
  v_absence_count int := 0;
  v_has_saturday_quiz boolean;
  v_quiz_valid boolean;
BEGIN
  SELECT EXISTS(
    SELECT 1 FROM relic_inventory ri
    JOIN relic_types rt ON ri.relic_type_id = rt.id
    WHERE ri.user_id = p_user_id AND rt.slug = 'simons-purse' AND ri.quantity > 0
  ) INTO v_simons_purse_active;

  v_check := v_today;
  LOOP
    IF EXTRACT(DOW FROM v_check) = 0 THEN
      v_check := v_check - 1;
      CONTINUE;
    END IF;

    SELECT meditation_submitted INTO v_med FROM daily_records
    WHERE user_id = p_user_id AND record_date = v_check::text;

    v_has_saturday_quiz := false;
    v_quiz_valid := false;
    IF EXTRACT(DOW FROM v_check) = 6 THEN
      SELECT EXISTS(
        SELECT 1 FROM quiz_sessions qs
        WHERE qs.session_date = v_check
        AND qs.quiz_type = 'saturday'
        AND qs.status IN ('live', 'completed')
      ) INTO v_has_saturday_quiz;

      IF v_has_saturday_quiz THEN
        SELECT EXISTS(
          SELECT 1 FROM quiz_attempts qa
          JOIN quiz_sessions qs ON qa.quiz_session_id = qs.id
          WHERE qa.user_id = p_user_id
          AND qs.session_date = v_check
          AND qs.quiz_type = 'saturday'
          AND qa.status = 'submitted'
        ) INTO v_quiz_valid;

        IF v_quiz_valid THEN
          v_current := v_current + 1;
          v_consec := 0;
          v_absence_count := 0;
          IF v_current > v_longest THEN v_longest := v_current; END IF;
          v_check := v_check - 1;
          CONTINUE;
        ELSE
          v_consec := v_consec + 1;
          v_cum := v_cum + 1;
          v_current := 0;
          EXIT;
        END IF;
      END IF;
    END IF;

    SELECT EXISTS(
      SELECT 1 FROM streak_freezers
      WHERE user_id = p_user_id
      AND used_at IS NULL
      AND (expires_at IS NULL OR expires_at >= v_check)
      AND (applied_to_date IS NULL OR applied_to_date = v_check::text)
    ) INTO v_freezer_available;

    IF v_med = true THEN
      v_current := v_current + 1;
      v_consec := 0;
      v_absence_count := 0;
    ELSIF v_simons_purse_active AND v_absence_count < 5 AND v_check < v_today THEN
      v_current := v_current + 1;
      v_consec := 0;
      v_absence_count := v_absence_count + 1;
    ELSIF v_freezer_available AND v_check < v_today THEN
      v_current := v_current + 1;
      v_consec := 0;
      v_absence_count := v_absence_count + 1;
    ELSIF v_med = false THEN
      v_consec := v_consec + 1;
      v_cum := v_cum + 1;
      v_current := 0;
      EXIT;
    ELSIF v_check < v_today THEN
      v_consec := v_consec + 1;
      v_cum := v_cum + 1;
      v_current := 0;
      EXIT;
    END IF;

    IF v_current > v_longest THEN v_longest := v_current; END IF;
    IF v_check < v_today - 365 THEN EXIT; END IF;
    v_check := v_check - 1;
  END LOOP;

  RETURN QUERY SELECT v_current, v_longest, v_consec, v_cum;
END;
$function$;

-- 7. Update create_arena_room to charge 10 denarii game call fee
CREATE OR REPLACE FUNCTION public.create_arena_room(
  p_creator_id uuid,
  p_room_name text,
  p_stake_amount integer,
  p_max_players integer DEFAULT 4,
  p_narrative_date text DEFAULT NULL,
  p_tagged_user_ids uuid[] DEFAULT '{}'::uuid[]
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
  v_id uuid;
  v_balance bigint;
  v_game_fee integer := 10;
BEGIN
  SELECT public.get_user_denarii_total(p_creator_id) INTO v_balance;
  IF v_balance < (p_stake_amount + v_game_fee) THEN
    RAISE EXCEPTION 'Insufficient denarii. You need % (stake + 10 game fee) but have %.',
      (p_stake_amount + v_game_fee), v_balance;
  END IF;

  INSERT INTO arena_rooms (creator_id, room_name, stake_amount, max_players, narrative_date, tagged_user_ids, game_call_fee)
  VALUES (p_creator_id, p_room_name, p_stake_amount, p_max_players, p_narrative_date, p_tagged_user_ids, v_game_fee)
  RETURNING id INTO v_id;

  INSERT INTO arena_participants (room_id, user_id, stake_paid) VALUES (v_id, p_creator_id, true);
  INSERT INTO denarii_ledger_entries (user_id, amount, source_type, description)
  VALUES (p_creator_id, -p_stake_amount, 'arena_stake', 'Arena stake for room ' || v_id::text);
  INSERT INTO denarii_ledger_entries (user_id, amount, source_type, description)
  VALUES (p_creator_id, -v_game_fee, 'arena_fee', 'Arena game call fee for room ' || v_id::text);

  RETURN v_id;
END;
$function$;

-- 8. submit_quiz_attempt RPC
CREATE OR REPLACE FUNCTION public.submit_quiz_attempt(
  p_user_id uuid,
  p_quiz_session_id uuid,
  p_status text,
  p_highest_question_reached integer DEFAULT 0,
  p_relics_used jsonb DEFAULT '{}'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
  v_id uuid;
  v_session quiz_sessions%ROWTYPE;
  v_reward integer := 0;
  v_total_questions integer;
  v_is_perfect boolean;
BEGIN
  SELECT * INTO v_session FROM quiz_sessions WHERE id = p_quiz_session_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Quiz session not found';
  END IF;

  IF p_status = 'submitted' THEN
    SELECT count(*) INTO v_total_questions FROM custom_questions WHERE quiz_session_id = p_quiz_session_id;
    v_is_perfect := (p_highest_question_reached >= v_total_questions);

    IF v_is_perfect THEN
      v_reward := COALESCE(v_session.reward_perfect, 6000);
    ELSE
      v_reward := COALESCE(v_session.reward_partial, 1000);
    END IF;
  END IF;

  INSERT INTO quiz_attempts (user_id, quiz_session_id, status, talents_scored, highest_question_reached, relics_used, submitted_at)
  VALUES (p_user_id, p_quiz_session_id, p_status, v_reward, p_highest_question_reached, p_relics_used,
    CASE WHEN p_status = 'submitted' THEN now() ELSE NULL END)
  RETURNING id INTO v_id;

  IF v_reward > 0 THEN
    INSERT INTO denarii_ledger_entries (user_id, amount, source_type, source_reference, description)
    VALUES (p_user_id, v_reward, 'quiz_reward', v_id::text,
      CASE WHEN v_is_perfect THEN 'Perfect quiz score' ELSE 'Quiz participation' END);
  END IF;

  RETURN v_id;
END;
$function$;

-- 9. is_saturday_quiz_scheduled RPC
CREATE OR REPLACE FUNCTION public.is_saturday_quiz_scheduled()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
AS $function$
  SELECT EXISTS(
    SELECT 1 FROM quiz_sessions
    WHERE quiz_type = 'saturday'
    AND status IN ('scheduled', 'countdown', 'live')
    AND session_date >= CURRENT_DATE
  );
$function$;

-- 10. get_unassigned_users RPC
CREATE OR REPLACE FUNCTION public.get_unassigned_users()
RETURNS TABLE(user_id uuid, display_name text, email text, avatar_url text, created_at timestamptz)
LANGUAGE sql
SECURITY DEFINER
AS $function$
  SELECT p.id, p.display_name, p.email, p.avatar_url, p.created_at
  FROM profiles p
  WHERE NOT EXISTS (
    SELECT 1 FROM role_assignments ra
    WHERE ra.user_id = p.id AND ra.status = 'active'
  )
  ORDER BY p.created_at DESC;
$function$;
