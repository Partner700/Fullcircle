ALTER TABLE public.arena_rooms
  ADD COLUMN IF NOT EXISTS play_mode text NOT NULL DEFAULT 'versus' CHECK (play_mode IN ('versus', 'machine')),
  ADD COLUMN IF NOT EXISTS machine_score integer;

CREATE OR REPLACE FUNCTION public.create_machine_arena_room(
  p_creator_id uuid,
  p_room_name text DEFAULT 'Bible Trail vs Machine',
  p_narrative_date text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
  v_balance bigint;
  v_name text := COALESCE(NULLIF(btrim(p_room_name), ''), 'Bible Trail vs Machine');
BEGIN
  IF auth.uid() IS NOT NULL AND auth.uid() <> p_creator_id THEN RAISE EXCEPTION 'You can only create a machine match for yourself.'; END IF;
  SELECT public.get_user_denarii_total(p_creator_id) INTO v_balance;
  IF v_balance < 50 THEN RAISE EXCEPTION 'A machine match costs 50 denarii.'; END IF;

  INSERT INTO public.arena_rooms (creator_id, room_name, stake_amount, max_players, narrative_date, status, expires_at, play_mode, machine_score)
  VALUES (p_creator_id, v_name, 50, 1, p_narrative_date, 'waiting', now() + interval '1 hour', 'machine', 7 + floor(random() * 10)::integer)
  RETURNING id INTO v_id;
  INSERT INTO public.arena_participants (room_id, user_id, stake_paid) VALUES (v_id, p_creator_id, true);
  INSERT INTO public.denarii_ledger_entries (user_id, amount, source_type, source_reference, description)
  VALUES (p_creator_id, -50, 'arena_stake', v_id::text, 'Machine arena stake for ' || v_name);
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.start_arena_game(p_room_id uuid, p_user_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_room public.arena_rooms%ROWTYPE; v_count integer; v_participant record;
BEGIN
  IF auth.uid() IS NOT NULL AND auth.uid() <> p_user_id THEN RAISE EXCEPTION 'You can only start arena rooms as yourself.'; END IF;
  PERFORM public.expire_stale_arena_rooms();
  SELECT * INTO v_room FROM public.arena_rooms WHERE id = p_room_id FOR UPDATE;
  IF NOT FOUND OR v_room.status <> 'waiting' THEN RAISE EXCEPTION 'Room is not waiting.'; END IF;
  IF v_room.creator_id <> p_user_id THEN RAISE EXCEPTION 'Only the host can start this room.'; END IF;
  SELECT count(*) INTO v_count FROM public.arena_participants WHERE room_id = p_room_id;
  IF v_room.play_mode <> 'machine' AND v_count < 2 THEN RAISE EXCEPTION 'At least two players are required to start.'; END IF;
  UPDATE public.arena_rooms SET status = 'playing', started_at = now(), expires_at = NULL WHERE id = p_room_id;
  FOR v_participant IN SELECT user_id FROM public.arena_participants WHERE room_id = p_room_id LOOP
    PERFORM public.notify_user(v_participant.user_id, p_user_id, 'arena', 'Arena game started', '"' || v_room.room_name || '" has started.', 'arena', jsonb_build_object('room_id', p_room_id, 'status', 'playing'));
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.finish_arena_game(p_room_id uuid, p_user_id uuid, p_score integer, p_correct_count integer)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_room public.arena_rooms%ROWTYPE; v_winner uuid; v_winner_name text; v_total_stake integer; v_count integer; v_participant record;
BEGIN
  IF auth.uid() IS NOT NULL AND auth.uid() <> p_user_id THEN RAISE EXCEPTION 'You can only finish arena games as yourself.'; END IF;
  SELECT * INTO v_room FROM public.arena_rooms WHERE id = p_room_id FOR UPDATE;
  IF NOT FOUND OR v_room.status <> 'playing' THEN RAISE EXCEPTION 'Arena game is not active.'; END IF;
  UPDATE public.arena_participants SET score = p_score, correct_count = p_correct_count, finished_at = now() WHERE room_id = p_room_id AND user_id = p_user_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'You are not a participant in this arena room.'; END IF;
  IF v_room.play_mode = 'machine' OR NOT EXISTS (SELECT 1 FROM public.arena_participants WHERE room_id = p_room_id AND finished_at IS NULL) THEN
    IF v_room.play_mode = 'machine' THEN
      v_winner := CASE WHEN p_score >= COALESCE(v_room.machine_score, 10) THEN p_user_id ELSE NULL END;
    ELSE
      SELECT user_id INTO v_winner FROM public.arena_participants WHERE room_id = p_room_id ORDER BY score DESC, correct_count DESC, finished_at ASC LIMIT 1;
    END IF;
    SELECT count(*) INTO v_count FROM public.arena_participants WHERE room_id = p_room_id;
    v_total_stake := COALESCE(v_room.stake_amount, 0) * v_count * 10;
    IF v_winner IS NOT NULL AND v_total_stake > 0 THEN
      INSERT INTO public.denarii_ledger_entries (user_id, amount, source_type, source_reference, description)
      VALUES (v_winner, v_total_stake, 'arena_reward', p_room_id::text, 'Arena tenfold winner reward for ' || v_room.room_name);
    END IF;
    SELECT display_name INTO v_winner_name FROM public.profiles WHERE id = v_winner;
    UPDATE public.arena_rooms SET status = 'completed', winner_id = v_winner, completed_at = now() WHERE id = p_room_id;
    FOR v_participant IN SELECT user_id FROM public.arena_participants WHERE room_id = p_room_id LOOP
      PERFORM public.notify_user(v_participant.user_id, v_winner, 'arena', CASE WHEN v_participant.user_id = v_winner THEN 'You won the arena' ELSE 'Arena game finished' END,
        CASE WHEN v_winner IS NULL THEN 'The Machine won "' || v_room.room_name || '".' WHEN v_participant.user_id = v_winner THEN 'You won "' || v_room.room_name || '" and received ' || v_total_stake::text || ' denarii.' ELSE COALESCE(v_winner_name, 'A cadet') || ' won "' || v_room.room_name || '".' END,
        'arena', jsonb_build_object('room_id', p_room_id, 'status', 'completed', 'winner_id', v_winner, 'reward_amount', CASE WHEN v_winner IS NULL THEN 0 ELSE v_total_stake END));
    END LOOP;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_machine_arena_room(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.start_arena_game(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.finish_arena_game(uuid, uuid, integer, integer) TO authenticated;
