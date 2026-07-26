/*
# Arena (Multiplayer Challenge Games) + Relic Fixes + Streak Consistency
*/

-- ═══════════════════════════════════════════════════
-- 1. ARENA TABLES
-- ═══════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS arena_rooms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  room_name text NOT NULL DEFAULT 'Quick Match',
  stake_amount integer NOT NULL DEFAULT 50,
  max_players integer NOT NULL DEFAULT 4,
  status text NOT NULL DEFAULT 'waiting',
  narrative_date text,
  game_type text DEFAULT 'mixed',
  tagged_user_ids uuid[] DEFAULT '{}',
  started_at timestamptz,
  completed_at timestamptz,
  winner_id uuid,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE arena_rooms ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "arena_rooms_select" ON arena_rooms;
CREATE POLICY "arena_rooms_select" ON arena_rooms FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "arena_rooms_insert" ON arena_rooms;
CREATE POLICY "arena_rooms_insert" ON arena_rooms FOR INSERT TO authenticated WITH CHECK (auth.uid() = creator_id);

DROP POLICY IF EXISTS "arena_rooms_update" ON arena_rooms;
CREATE POLICY "arena_rooms_update" ON arena_rooms FOR UPDATE TO authenticated USING (auth.uid() = creator_id);

CREATE TABLE IF NOT EXISTS arena_participants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id uuid NOT NULL REFERENCES arena_rooms(id) ON DELETE CASCADE,
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  stake_paid boolean NOT NULL DEFAULT false,
  score integer NOT NULL DEFAULT 0,
  correct_count integer NOT NULL DEFAULT 0,
  finished_at timestamptz,
  joined_at timestamptz DEFAULT now(),
  UNIQUE(room_id, user_id)
);

ALTER TABLE arena_participants ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "arena_participants_select" ON arena_participants;
CREATE POLICY "arena_participants_select" ON arena_participants FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "arena_participants_insert" ON arena_participants;
CREATE POLICY "arena_participants_insert" ON arena_participants FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "arena_participants_update" ON arena_participants;
CREATE POLICY "arena_participants_update" ON arena_participants FOR UPDATE TO authenticated USING (auth.uid() = user_id);

-- ═══════════════════════════════════════════════════
-- 2. ARENA RPCs
-- ═══════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION create_arena_room(
  p_creator_id uuid, p_room_name text, p_stake_amount integer, p_max_players integer DEFAULT 4,
  p_narrative_date text DEFAULT NULL, p_tagged_user_ids uuid[] DEFAULT '{}'
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE v_id uuid; v_balance numeric;
BEGIN
  SELECT COALESCE(SUM(amount), 0) INTO v_balance FROM denarii_ledger_entries WHERE user_id = p_creator_id;
  IF v_balance < p_stake_amount THEN
    RAISE EXCEPTION 'Insufficient denarii for stake. You need % but have %.', p_stake_amount, v_balance;
  END IF;

  INSERT INTO arena_rooms (creator_id, room_name, stake_amount, max_players, narrative_date, tagged_user_ids)
  VALUES (p_creator_id, p_room_name, p_stake_amount, p_max_players, p_narrative_date, p_tagged_user_ids)
  RETURNING id INTO v_id;

  INSERT INTO arena_participants (room_id, user_id, stake_paid) VALUES (v_id, p_creator_id, true);
  INSERT INTO denarii_ledger_entries (user_id, amount, source_type, description)
  VALUES (p_creator_id, -p_stake_amount, 'relic_purchase'::ledger_source_type, 'Arena stake for room ' || v_id::text);

  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION join_arena_room(p_room_id uuid, p_user_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE v_stake integer; v_balance numeric; v_count integer; v_max integer;
BEGIN
  SELECT stake_amount, max_players INTO v_stake, v_max FROM arena_rooms WHERE id = p_room_id AND status = 'waiting';
  IF NOT FOUND THEN RAISE EXCEPTION 'Room not found or not accepting players'; END IF;

  SELECT count(*) INTO v_count FROM arena_participants WHERE room_id = p_room_id;
  IF v_count >= v_max THEN RAISE EXCEPTION 'Room is full'; END IF;

  SELECT COALESCE(SUM(amount), 0) INTO v_balance FROM denarii_ledger_entries WHERE user_id = p_user_id;
  IF v_balance < v_stake THEN
    RAISE EXCEPTION 'Insufficient denarii for stake. You need % but have %.', v_stake, v_balance;
  END IF;

  INSERT INTO arena_participants (room_id, user_id, stake_paid) VALUES (p_room_id, p_user_id, true)
  ON CONFLICT (room_id, user_id) DO NOTHING;

  INSERT INTO denarii_ledger_entries (user_id, amount, source_type, description)
  VALUES (p_user_id, -v_stake, 'relic_purchase'::ledger_source_type, 'Arena stake for room ' || p_room_id::text);
END;
$$;

CREATE OR REPLACE FUNCTION finish_arena_game(p_room_id uuid, p_user_id uuid, p_score integer, p_correct_count integer)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE v_winner uuid; v_total_stake integer; v_count integer;
BEGIN
  UPDATE arena_participants SET score = p_score, correct_count = p_correct_count, finished_at = now()
  WHERE room_id = p_room_id AND user_id = p_user_id;

  IF NOT EXISTS (SELECT 1 FROM arena_participants WHERE room_id = p_room_id AND finished_at IS NULL) THEN
    SELECT user_id INTO v_winner FROM arena_participants
    WHERE room_id = p_room_id ORDER BY score DESC, correct_count DESC, finished_at ASC LIMIT 1;

    SELECT count(*) INTO v_count FROM arena_participants WHERE room_id = p_room_id;
    SELECT stake_amount * v_count INTO v_total_stake FROM arena_rooms WHERE id = p_room_id;

    IF v_winner IS NOT NULL THEN
      INSERT INTO denarii_ledger_entries (user_id, amount, source_type, description)
      VALUES (v_winner, v_total_stake, 'game_level'::ledger_source_type, 'Arena winner for room ' || p_room_id::text);
    END IF;

    UPDATE arena_rooms SET status = 'completed', winner_id = v_winner, completed_at = now() WHERE id = p_room_id;
  END IF;
END;
$$;

-- ═══════════════════════════════════════════════════
-- 3. FIXED PURCHASE_RELIC RPC
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
  IF FOUND THEN
    UPDATE relic_inventory SET quantity = quantity + 1 WHERE id = v_existing.id;
  ELSE
    INSERT INTO relic_inventory (user_id, relic_type_id, quantity, source_description)
    VALUES (p_user_id, v_relic.id, 1, 'Purchased with ' || p_currency);
  END IF;

  v_result := jsonb_build_object('success', true, 'method', p_currency, 'relic_id', v_relic.id::text);
  RETURN v_result;
END;
$$;

-- ═══════════════════════════════════════════════════
-- 4. ADD expires_at TO streak_freezers
-- ═══════════════════════════════════════════════════

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'streak_freezers' AND column_name = 'expires_at') THEN
    ALTER TABLE streak_freezers ADD COLUMN expires_at date;
  END IF;
END $$;

-- ═══════════════════════════════════════════════════
-- 5. FIXED USE_RELIC RPC
-- ═══════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION use_relic(p_user_id uuid, p_relic_slug text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  v_inv RECORD; v_relic RECORD; v_result jsonb;
  v_days_on_platform integer; v_retroactive_denarii integer;
  v_first_record RECORD; v_saturday_date date;
BEGIN
  SELECT * INTO v_relic FROM relic_types WHERE slug = p_relic_slug;
  IF NOT FOUND THEN RAISE EXCEPTION 'Relic not found'; END IF;

  SELECT * INTO v_inv FROM relic_inventory
  WHERE user_id = p_user_id AND relic_type_id = v_relic.id AND quantity > 0 LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'You do not own this relic'; END IF;

  UPDATE relic_inventory SET quantity = quantity - 1 WHERE id = v_inv.id;

  IF v_relic.effect_type = 'revive_lost_streak' THEN
    SELECT MIN(record_date::date) INTO v_first_record FROM daily_records WHERE user_id = p_user_id;
    IF v_first_record IS NOT NULL THEN
      v_days_on_platform := CURRENT_DATE - v_first_record.record_date::date;
      v_retroactive_denarii := v_days_on_platform * 650;
    ELSE
      v_retroactive_denarii := 0;
    END IF;

    IF v_retroactive_denarii > 0 THEN
      INSERT INTO denarii_ledger_entries (user_id, amount, source_type, description)
      VALUES (p_user_id, v_retroactive_denarii, 'game_level'::ledger_source_type,
        'Thief''s Request: retroactive ' || v_days_on_platform || ' days at perfect score');
    END IF;

    INSERT INTO streak_freezers (user_id, freezer_type, source, applied_to_date)
    SELECT p_user_id, 'weekly', 'relic', d.record_date FROM daily_records d
    WHERE d.user_id = p_user_id AND d.meditation_submitted = false
      AND d.record_date = (SELECT MAX(record_date) FROM daily_records WHERE user_id = p_user_id AND meditation_submitted = false)
    LIMIT 1;
    IF NOT FOUND THEN
      INSERT INTO streak_freezers (user_id, freezer_type, source, applied_to_date)
      VALUES (p_user_id, 'weekly', 'relic', (CURRENT_DATE - 1)::text);
    END IF;

    v_result := jsonb_build_object('success', true, 'effect', 'revive_lost_streak',
      'retroactive_denarii', v_retroactive_denarii, 'days_on_platform', v_days_on_platform);

  ELSIF v_relic.effect_type = 'streak_shield_week' THEN
    v_saturday_date := CURRENT_DATE + ((6 - EXTRACT(DOW FROM CURRENT_DATE)::int + 7) % 7);
    IF v_saturday_date = CURRENT_DATE THEN v_saturday_date := CURRENT_DATE + 7; END IF;

    INSERT INTO streak_freezers (user_id, freezer_type, source, expires_at)
    SELECT p_user_id, 'daily', 'relic', v_saturday_date FROM generate_series(1, 7);

    v_result := jsonb_build_object('success', true, 'effect', 'streak_shield_week',
      'expires_on', v_saturday_date::text);

  ELSE
    v_result := jsonb_build_object('success', true, 'effect', v_relic.effect_type);
  END IF;

  RETURN v_result;
END;
$$;

-- ═══════════════════════════════════════════════════
-- 6. FIXED COMPUTE_STRICT_STREAK
-- ═══════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION compute_strict_streak(p_user_id uuid)
RETURNS TABLE(current_streak integer, longest_streak integer, consecutive_inactive integer, cumulative_inactive integer)
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  v_med boolean; v_current int := 0; v_longest int := 0;
  v_consec int := 0; v_cum int := 0;
  v_today date := CURRENT_DATE; v_check date;
  v_freezer_id uuid;
BEGIN
  v_check := v_today;
  LOOP
    IF EXTRACT(DOW FROM v_check) = 0 THEN v_check := v_check - 1; CONTINUE; END IF;

    SELECT meditation_submitted INTO v_med FROM daily_records WHERE user_id = p_user_id AND record_date = v_check::text;

    SELECT id INTO v_freezer_id FROM streak_freezers
    WHERE user_id = p_user_id AND used_at IS NULL
      AND (expires_at IS NULL OR expires_at >= v_check)
      AND (applied_to_date IS NULL OR applied_to_date = v_check::text)
    ORDER BY purchased_at ASC LIMIT 1;

    IF v_med = true THEN
      v_current := v_current + 1; v_consec := 0;
    ELSIF v_freezer_id IS NOT NULL AND v_check < v_today THEN
      UPDATE streak_freezers SET used_at = now(), applied_to_date = v_check::text WHERE id = v_freezer_id;
      v_current := v_current + 1; v_consec := 0;
    ELSIF v_med = false THEN
      v_consec := v_consec + 1; v_cum := v_cum + 1; v_current := 0; EXIT;
    ELSIF v_check < v_today THEN
      v_consec := v_consec + 1; v_cum := v_cum + 1; v_current := 0; EXIT;
    END IF;

    IF v_current > v_longest THEN v_longest := v_current; END IF;
    IF v_check < v_today - 365 THEN EXIT; END IF;
    v_check := v_check - 1;
  END LOOP;

  RETURN QUERY SELECT v_current, v_longest, v_consec, v_cum;
END;
$$;

-- ═══════════════════════════════════════════════════
-- 7. GRANTS
-- ═══════════════════════════════════════════════════

GRANT SELECT, INSERT, UPDATE, DELETE ON arena_rooms TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON arena_participants TO authenticated;
GRANT EXECUTE ON FUNCTION create_arena_room(uuid, text, integer, integer, text, uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION join_arena_room(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION finish_arena_game(uuid, uuid, integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION purchase_relic(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION use_relic(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION compute_strict_streak(uuid) TO authenticated;
