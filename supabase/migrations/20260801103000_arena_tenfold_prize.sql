-- Arena winners receive ten times the cumulative player stake.
CREATE OR REPLACE FUNCTION public.finish_arena_game(p_room_id uuid, p_user_id uuid, p_score integer, p_correct_count integer)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_room public.arena_rooms%ROWTYPE;
  v_winner uuid;
  v_winner_name text;
  v_total_stake integer;
  v_count integer;
  v_participant record;
BEGIN
  IF auth.uid() IS NOT NULL AND auth.uid() <> p_user_id THEN
    RAISE EXCEPTION 'You can only finish arena games as yourself.';
  END IF;

  SELECT * INTO v_room FROM public.arena_rooms WHERE id = p_room_id FOR UPDATE;
  IF NOT FOUND OR v_room.status <> 'playing' THEN
    RAISE EXCEPTION 'Arena game is not active.';
  END IF;

  UPDATE public.arena_participants
  SET score = p_score, correct_count = p_correct_count, finished_at = now()
  WHERE room_id = p_room_id AND user_id = p_user_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'You are not a participant in this arena room.'; END IF;

  IF NOT EXISTS (SELECT 1 FROM public.arena_participants WHERE room_id = p_room_id AND finished_at IS NULL) THEN
    SELECT user_id INTO v_winner FROM public.arena_participants
    WHERE room_id = p_room_id
    ORDER BY score DESC, correct_count DESC, finished_at ASC
    LIMIT 1;
    SELECT count(*) INTO v_count FROM public.arena_participants WHERE room_id = p_room_id;
    v_total_stake := COALESCE(v_room.stake_amount, 0) * v_count * 10;

    IF v_winner IS NOT NULL AND v_total_stake > 0 THEN
      INSERT INTO public.denarii_ledger_entries (user_id, amount, source_type, source_reference, description)
      VALUES (v_winner, v_total_stake, 'arena_reward', p_room_id::text, 'Arena tenfold winner reward for ' || v_room.room_name);
    END IF;

    SELECT display_name INTO v_winner_name FROM public.profiles WHERE id = v_winner;
    UPDATE public.arena_rooms SET status = 'completed', winner_id = v_winner, completed_at = now() WHERE id = p_room_id;

    FOR v_participant IN SELECT user_id FROM public.arena_participants WHERE room_id = p_room_id LOOP
      PERFORM public.notify_user(
        v_participant.user_id, v_winner, 'arena',
        CASE WHEN v_participant.user_id = v_winner THEN 'You won the arena' ELSE 'Arena game finished' END,
        CASE WHEN v_participant.user_id = v_winner
          THEN 'You won "' || v_room.room_name || '" and received ' || v_total_stake::text || ' denarii.'
          ELSE COALESCE(v_winner_name, 'A cadet') || ' won "' || v_room.room_name || '".'
        END,
        'arena', jsonb_build_object('room_id', p_room_id, 'status', 'completed', 'winner_id', v_winner, 'reward_amount', v_total_stake)
      );
    END LOOP;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.finish_arena_game(uuid, uuid, integer, integer) TO authenticated;
