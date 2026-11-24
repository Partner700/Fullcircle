-- The two-Shield offer meets the standalone Direct Pay minimum.
UPDATE public.relic_types
SET money_price_xaf = NULL, cash_bundles = cash_bundles || '{"2":100}'::jsonb
WHERE slug = 'shield-of-faith';

INSERT INTO public.relic_types (slug, name, description, effect, effect_type, effect_scope, rarity, denarii_cost, money_price_xaf, money_price_usd, icon, is_active)
VALUES
  ('undo', 'Undo', 'Rewind your last move in Arena Ludo or Journey before the match advances.',
   'arena_undo', 'arena_undo', 'arena_ludo', 'rare', NULL, 100, NULL, 'Undo2', true),
  ('standstill', 'Standstill', 'Pause your Arena Ludo or Journey match for 10 minutes. The question timer preserves its remaining time.',
   'arena_standstill', 'arena_standstill', 'arena_ludo', 'rare', NULL, 100, NULL, 'Pause', true)
ON CONFLICT (slug) DO UPDATE SET description = EXCLUDED.description,
  denarii_cost = EXCLUDED.denarii_cost, money_price_xaf = EXCLUDED.money_price_xaf,
  money_price_usd = EXCLUDED.money_price_usd, is_active = EXCLUDED.is_active;

CREATE OR REPLACE FUNCTION public.commit_arena_board_market_turn(
  p_room_id uuid, p_expected_version integer, p_next_state jsonb, p_public_state jsonb,
  p_command_id uuid, p_actor_id uuid, p_spend_slug text, p_award_slug text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_previous jsonb;
  v_result jsonb;
  v_relic_id uuid;
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'Arena commands are server-only.' USING ERRCODE = '42501';
  END IF;
  IF (p_spend_slug IS NULL) = (p_award_slug IS NULL) THEN
    RAISE EXCEPTION 'Choose a single Market action.';
  END IF;

  PERFORM 1 FROM public.arena_rooms WHERE id = p_room_id FOR UPDATE;
  IF p_public_state IS NULL THEN
    IF p_award_slug IS NOT NULL THEN RAISE EXCEPTION 'Journey has no Ludo discovery reward.'; END IF;
    v_result := public.commit_arena_journey_turn(
      p_room_id, p_expected_version, p_next_state, p_command_id, p_actor_id, NULL);
  ELSE
    SELECT private_state INTO v_previous FROM public.arena_ludo_games WHERE room_id = p_room_id FOR UPDATE;
    v_result := public.commit_arena_ludo_turn(
      p_room_id, p_expected_version, p_next_state, p_public_state, p_command_id, p_actor_id, NULL);
  END IF;
  IF (v_result->>'duplicate')::boolean THEN RETURN v_result; END IF;

  IF NOT EXISTS (SELECT 1 FROM public.arena_participants
    WHERE room_id = p_room_id AND user_id = p_actor_id AND forfeited_at IS NULL) THEN
    RAISE EXCEPTION 'Only an active player may use this Market action.';
  END IF;
  SELECT id INTO v_relic_id FROM public.relic_types WHERE slug = coalesce(p_spend_slug, p_award_slug) AND is_active;
  IF v_relic_id IS NULL THEN RAISE EXCEPTION 'This Market relic is unavailable.'; END IF;

  IF p_spend_slug IS NOT NULL THEN
    IF p_spend_slug NOT IN ('undo', 'standstill') THEN RAISE EXCEPTION 'Invalid Arena board relic.'; END IF;
    UPDATE public.relic_inventory SET quantity = quantity - 1
      WHERE user_id = p_actor_id AND relic_type_id = v_relic_id AND quantity > 0;
    IF NOT FOUND THEN RAISE EXCEPTION 'You do not own this relic.'; END IF;
    INSERT INTO public.relic_usage_log(user_id, relic_type_id, effect_applied)
      VALUES (p_actor_id, v_relic_id, 'arena:' || p_room_id::text || ':' || p_spend_slug);
  ELSE
    IF p_award_slug NOT IN ('skip', 'reveal-reference', 'shield-of-faith', 'freeze-timer')
      OR v_previous->>'phase' IS DISTINCT FROM 'SURPRISE_CARD'
      OR v_previous->'pendingSurprise'->>'marketRelicSlug' IS DISTINCT FROM p_award_slug
      OR v_previous->'players'->((v_previous->>'activePlayerIndex')::integer)->>'id' IS DISTINCT FROM p_actor_id::text THEN
      RAISE EXCEPTION 'This Ludo reward is unavailable.';
    END IF;
    INSERT INTO public.relic_inventory(user_id, relic_type_id, quantity, source_description)
      VALUES (p_actor_id, v_relic_id, 1, 'Earned in Arena Ludo')
      ON CONFLICT (user_id, relic_type_id) DO UPDATE SET quantity = public.relic_inventory.quantity + 1;
  END IF;
  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.commit_arena_board_market_turn(uuid,integer,jsonb,jsonb,uuid,uuid,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.commit_arena_board_market_turn(uuid,integer,jsonb,jsonb,uuid,uuid,text,text) TO service_role;
