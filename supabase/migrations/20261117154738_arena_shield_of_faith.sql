-- Keep the move, the Shield inventory debit, and its usage log in one transaction.
CREATE OR REPLACE FUNCTION public.commit_arena_shield_turn(
  p_room_id uuid, p_expected_version integer, p_next_state jsonb,
  p_command_id uuid, p_actor_id uuid, p_public_state jsonb DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_offer jsonb;
  v_result jsonb;
  v_relic_id uuid;
  v_inventory_id uuid;
  v_duplicate boolean;
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'Arena commands are server-only.' USING ERRCODE = '42501';
  END IF;

  -- Match the existing Arena commit functions' lock order.
  PERFORM 1 FROM public.arena_rooms WHERE id = p_room_id FOR UPDATE;
  IF p_public_state IS NULL THEN
    SELECT state->'game'->'shieldOffer' INTO v_offer
      FROM public.arena_journey_games WHERE room_id = p_room_id FOR UPDATE;
    SELECT EXISTS (SELECT 1 FROM public.arena_journey_commands
      WHERE room_id = p_room_id AND command_id = p_command_id) INTO v_duplicate;
  ELSE
    SELECT private_state->'shieldOffer' INTO v_offer
      FROM public.arena_ludo_games WHERE room_id = p_room_id FOR UPDATE;
    SELECT EXISTS (SELECT 1 FROM public.arena_ludo_commands
      WHERE room_id = p_room_id AND command_id = p_command_id) INTO v_duplicate;
  END IF;

  IF NOT v_duplicate THEN
    IF v_offer->>'playerId' IS DISTINCT FROM p_actor_id::text
      OR coalesce((v_offer->>'deadline')::timestamptz, '-infinity') <= clock_timestamp()
      OR NOT EXISTS (SELECT 1 FROM public.arena_participants
        WHERE room_id = p_room_id AND user_id = p_actor_id AND forfeited_at IS NULL) THEN
      RAISE EXCEPTION 'The Shield of Faith decision is no longer available to you.';
    END IF;

    SELECT id INTO v_relic_id FROM public.relic_types WHERE slug = 'shield-of-faith';
    SELECT id INTO v_inventory_id FROM public.relic_inventory
      WHERE user_id = p_actor_id AND relic_type_id = v_relic_id AND quantity > 0
      ORDER BY id LIMIT 1 FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'You do not own a Shield of Faith.'; END IF;
  END IF;

  IF p_public_state IS NULL THEN
    v_result := public.commit_arena_journey_turn(
      p_room_id, p_expected_version, p_next_state, p_command_id, p_actor_id, NULL);
  ELSE
    v_result := public.commit_arena_ludo_turn(
      p_room_id, p_expected_version, p_next_state, p_public_state, p_command_id, p_actor_id, NULL);
  END IF;

  IF NOT (v_result->>'duplicate')::boolean THEN
    UPDATE public.relic_inventory SET quantity = quantity - 1 WHERE id = v_inventory_id;
    INSERT INTO public.relic_usage_log(user_id, relic_type_id, effect_applied)
      VALUES (p_actor_id, v_relic_id, 'arena:' || p_room_id::text || ':shield-of-faith');
  END IF;
  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.commit_arena_shield_turn(uuid,integer,jsonb,uuid,uuid,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.commit_arena_shield_turn(uuid,integer,jsonb,uuid,uuid,jsonb) TO service_role;

UPDATE public.relic_types
SET description = concat_ws(' ', nullif(description, ''),
  'In Arena Ludo and Journey Trivia, use it within 10 seconds to prevent an offered penalty.')
WHERE slug = 'shield-of-faith';
