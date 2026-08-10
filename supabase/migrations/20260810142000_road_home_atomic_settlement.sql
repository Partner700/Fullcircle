/* Settle Road Home scores, winner payout, and room completion atomically. */

CREATE OR REPLACE FUNCTION public.settle_road_home_arena(
  p_room_id uuid,
  p_winner_id uuid,
  p_results jsonb,
  p_completion_reason text DEFAULT 'finished'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_room public.arena_rooms%ROWTYPE;
  v_result jsonb;
  v_real_players integer;
  v_reward integer;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'Road Home settlement is server-only.';
  END IF;
  SELECT * INTO v_room FROM public.arena_rooms WHERE id = p_room_id FOR UPDATE;
  IF NOT FOUND OR v_room.room_name !~* '\[arena:ludo\]' THEN
    RAISE EXCEPTION 'Road Home room not found.';
  END IF;
  IF v_room.status = 'completed' THEN
    RETURN jsonb_build_object('success', true, 'already_settled', true, 'winner_id', v_room.winner_id);
  END IF;
  IF p_winner_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.arena_participants participant
    WHERE participant.room_id = p_room_id AND participant.user_id = p_winner_id
  ) THEN RAISE EXCEPTION 'Winner is not a room participant.'; END IF;

  FOR v_result IN SELECT value FROM jsonb_array_elements(coalesce(p_results, '[]'::jsonb))
  LOOP
    UPDATE public.arena_participants
    SET score = greatest(0, coalesce((v_result->>'score')::integer, 0)),
        correct_count = greatest(0, coalesce((v_result->>'correct_count')::integer, 0)),
        finished_at = now()
    WHERE room_id = p_room_id AND user_id = (v_result->>'user_id')::uuid;
  END LOOP;

  SELECT count(*) INTO v_real_players
  FROM public.arena_participants WHERE room_id = p_room_id;
  v_reward := greatest(coalesce(v_room.stake_amount, 0), 0) * greatest(v_real_players, 1) * 10;
  IF p_winner_id IS NOT NULL AND v_reward > 0 AND NOT EXISTS (
    SELECT 1 FROM public.denarii_ledger_entries entry
    WHERE entry.user_id = p_winner_id
      AND entry.source_type = 'arena_reward'
      AND entry.source_reference = p_room_id::text
      AND entry.description LIKE 'Road Home%'
  ) THEN
    INSERT INTO public.denarii_ledger_entries(user_id, amount, source_type, source_reference, description)
    VALUES (p_winner_id, v_reward, 'arena_reward', p_room_id::text,
      'Road Home tenfold winner reward for ' || v_room.room_name);
  END IF;

  UPDATE public.arena_rooms
  SET status = 'completed', winner_id = p_winner_id, completed_at = now(),
      completion_reason = CASE WHEN p_completion_reason = 'forfeit' THEN 'forfeit' ELSE 'finished' END
  WHERE id = p_room_id;
  RETURN jsonb_build_object('success', true, 'winner_id', p_winner_id, 'reward', CASE WHEN p_winner_id IS NULL THEN 0 ELSE v_reward END);
END;
$$;

REVOKE ALL ON FUNCTION public.settle_road_home_arena(uuid, uuid, jsonb, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.settle_road_home_arena(uuid, uuid, jsonb, text) TO service_role;
