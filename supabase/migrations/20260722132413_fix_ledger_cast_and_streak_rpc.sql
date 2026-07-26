/*
# Fix ledger_source_type cast + streak RPC side effects

1. Remove `::ledger_source_type` casts from purchase_relic and create_arena_room
   - The column is `text` with a CHECK constraint, no enum type exists
   - This caused "type ledger_source_type does not exist" error on every relic purchase and arena stake

2. Fix compute_strict_streak to NOT consume freezers during read
   - The original function UPDATEd streak_freezers SET used_at=now() on each call
   - This caused the streak number to change on every read → inconsistency across screens
   - New version is pure read-only: counts a freezer as protecting the day without consuming it
*/

-- 1. Fix purchase_relic — remove ::ledger_source_type cast
CREATE OR REPLACE FUNCTION purchase_relic(p_user_id uuid, p_relic_slug text, p_currency text DEFAULT 'denarii')
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
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
    VALUES (p_user_id, -v_relic.denarii_cost, 'relic_purchase', 'Purchased ' || v_relic.name);
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

-- 2. Fix create_arena_room — remove ::ledger_source_type cast + use correct source_type
CREATE OR REPLACE FUNCTION create_arena_room(
  p_creator_id uuid,
  p_room_name text,
  p_stake_amount integer,
  p_max_players integer DEFAULT 4,
  p_narrative_date text DEFAULT NULL,
  p_tagged_user_ids uuid[] DEFAULT '{}'
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
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
  VALUES (p_creator_id, -p_stake_amount, 'arena_stake', 'Arena stake for room ' || v_id::text);

  RETURN v_id;
END;
$$;

-- 3. Fix compute_strict_streak — read-only, no freezer consumption
CREATE OR REPLACE FUNCTION compute_strict_streak(p_user_id uuid)
RETURNS TABLE(current_streak integer, longest_streak integer, consecutive_inactive integer, cumulative_inactive integer)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_med boolean;
  v_current int := 0;
  v_longest int := 0;
  v_consec int := 0;
  v_cum int := 0;
  v_today date := CURRENT_DATE;
  v_check date;
  v_freezer_available boolean;
BEGIN
  v_check := v_today;
  LOOP
    -- Skip Sundays
    IF EXTRACT(DOW FROM v_check) = 0 THEN
      v_check := v_check - 1;
      CONTINUE;
    END IF;

    SELECT meditation_submitted INTO v_med FROM daily_records WHERE user_id = p_user_id AND record_date = v_check::text;

    -- Check if an unused freezer is available for this date (READ ONLY — do not consume)
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
    ELSIF v_freezer_available AND v_check < v_today THEN
      -- Freezer protects this day but we DON'T consume it here
      v_current := v_current + 1;
      v_consec := 0;
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
$$;
