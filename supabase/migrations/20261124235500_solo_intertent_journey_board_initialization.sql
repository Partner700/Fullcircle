-- Allow a scheduled inter-tent match to initialize its Journey board after
-- the first selected attendee starts it. Other selected players may still
-- join through the existing five-minute late-join function.
DO $migration$
DECLARE
  definition text;
  original_guard text := $old$IF v_expected_players NOT BETWEEN 2 AND 4 OR v_state_players <> v_expected_players$old$;
  revised_guard text := $new$
IF (
  v_expected_players < CASE
    WHEN v_room.room_name ILIKE '%[intertent]%'
      AND EXISTS (
        SELECT 1 FROM public.arena_scheduled_matches sm
        WHERE sm.room_id = p_room_id AND sm.is_intertent_match
      )
      AND EXISTS (
        SELECT 1 FROM private.intertent_fixtures f
        WHERE f.room_id = p_room_id
          AND (SELECT p.user_id FROM public.arena_participants p
               WHERE p.room_id = p_room_id AND p.forfeited_at IS NULL
               ORDER BY p.joined_at LIMIT 1) = ANY(f.player_ids)
      )
    THEN 1 ELSE 2 END
  OR v_expected_players > 4
) OR v_state_players <> v_expected_players$new$;
BEGIN
  definition := pg_get_functiondef('public.initialize_arena_journey_game(uuid,text,jsonb)'::regprocedure);
  IF position(original_guard in definition) = 0 THEN
    RAISE EXCEPTION 'Unexpected Journey initializer; review its authorization before changing.';
  END IF;
  EXECUTE replace(definition, original_guard, revised_guard);
END;
$migration$;
