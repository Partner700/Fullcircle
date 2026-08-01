ALTER TABLE public.arena_participants
  ADD COLUMN IF NOT EXISTS last_active_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS forfeited_at timestamptz,
  ADD COLUMN IF NOT EXISTS forfeit_reason text;

ALTER TABLE public.arena_rooms
  ADD COLUMN IF NOT EXISTS completion_reason text;

CREATE OR REPLACE FUNCTION public.settle_standard_arena_forfeit(p_room_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_room public.arena_rooms%ROWTYPE;
  v_remaining_count integer;
  v_winner uuid;
  v_winner_name text;
  v_total_stake integer;
  v_participant record;
BEGIN
  SELECT * INTO v_room FROM public.arena_rooms WHERE id = p_room_id FOR UPDATE;
  IF NOT FOUND OR v_room.status <> 'playing' OR v_room.room_name ILIKE '%[arena:ludo]%' THEN RETURN; END IF;

  SELECT count(*), (array_agg(user_id ORDER BY joined_at))[1]
  INTO v_remaining_count, v_winner
  FROM public.arena_participants
  WHERE room_id = p_room_id AND forfeited_at IS NULL;

  IF v_remaining_count > 1 THEN RETURN; END IF;
  IF v_room.play_mode = 'machine' THEN v_winner := NULL; END IF;

  SELECT count(*) INTO v_remaining_count FROM public.arena_participants WHERE room_id = p_room_id;
  v_total_stake := COALESCE(v_room.stake_amount, 0) * v_remaining_count * 10;
  IF v_winner IS NOT NULL AND v_total_stake > 0 AND NOT EXISTS (
    SELECT 1 FROM public.denarii_ledger_entries
    WHERE source_type = 'arena_reward' AND source_reference = p_room_id::text
  ) THEN
    INSERT INTO public.denarii_ledger_entries (user_id, amount, source_type, source_reference, description)
    VALUES (v_winner, v_total_stake, 'arena_reward', p_room_id::text, 'Arena tenfold winner reward after forfeiture for ' || v_room.room_name);
  END IF;

  SELECT display_name INTO v_winner_name FROM public.profiles WHERE id = v_winner;
  UPDATE public.arena_rooms
  SET status = 'completed', winner_id = v_winner, completed_at = now(), completion_reason = 'forfeit'
  WHERE id = p_room_id;

  FOR v_participant IN SELECT user_id FROM public.arena_participants WHERE room_id = p_room_id LOOP
    PERFORM public.notify_user(
      v_participant.user_id,
      v_winner,
      'arena',
      CASE WHEN v_participant.user_id = v_winner THEN 'You won by forfeit' ELSE 'Arena match ended' END,
      CASE WHEN v_winner IS NULL THEN 'The match ended by forfeiture.'
        WHEN v_participant.user_id = v_winner THEN 'You won "' || v_room.room_name || '" and received ' || v_total_stake::text || ' denarii.'
        ELSE COALESCE(v_winner_name, 'The remaining player') || ' won "' || v_room.room_name || '" after a forfeiture.' END,
      'arena',
      jsonb_build_object('room_id', p_room_id, 'status', 'completed', 'winner_id', v_winner, 'completion_reason', 'forfeit')
    );
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.expire_inactive_arena_participants()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer := 0;
  v_room record;
BEGIN
  WITH expired AS (
    UPDATE public.arena_participants participant
    SET forfeited_at = now(), forfeit_reason = 'inactive', finished_at = COALESCE(finished_at, now())
    FROM public.arena_rooms room
    WHERE participant.room_id = room.id
      AND room.status = 'playing'
      AND participant.forfeited_at IS NULL
      AND participant.finished_at IS NULL
      AND participant.last_active_at < now() - interval '3 minutes'
    RETURNING participant.room_id
  )
  SELECT count(*) INTO v_count FROM expired;

  FOR v_room IN
    SELECT DISTINCT participant.room_id
    FROM public.arena_participants participant
    JOIN public.arena_rooms room ON room.id = participant.room_id
    WHERE room.status = 'playing' AND participant.forfeited_at IS NOT NULL
  LOOP
    PERFORM public.settle_standard_arena_forfeit(v_room.room_id);
  END LOOP;
  RETURN v_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.heartbeat_arena_participant(p_room_id uuid, p_user_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND auth.uid() <> p_user_id THEN
    RAISE EXCEPTION 'You can only update your own arena presence.';
  END IF;
  PERFORM public.expire_inactive_arena_participants();
  UPDATE public.arena_participants participant
  SET last_active_at = now()
  FROM public.arena_rooms room
  WHERE participant.room_id = p_room_id
    AND participant.user_id = p_user_id
    AND participant.room_id = room.id
    AND room.status = 'playing'
    AND participant.forfeited_at IS NULL;
  RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION public.forfeit_arena_game(p_room_id uuid, p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND auth.uid() <> p_user_id THEN
    RAISE EXCEPTION 'You can only forfeit as yourself.';
  END IF;
  UPDATE public.arena_participants participant
  SET forfeited_at = now(), forfeit_reason = 'manual', finished_at = COALESCE(finished_at, now())
  FROM public.arena_rooms room
  WHERE participant.room_id = p_room_id
    AND participant.user_id = p_user_id
    AND participant.room_id = room.id
    AND room.status = 'playing'
    AND participant.forfeited_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'This active Arena place could not be forfeited.'; END IF;
  PERFORM public.settle_standard_arena_forfeit(p_room_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.finish_arena_game(p_room_id uuid, p_user_id uuid, p_score integer, p_correct_count integer)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_room public.arena_rooms%ROWTYPE; v_winner uuid; v_winner_name text; v_total_stake integer; v_count integer; v_participant record;
  v_score integer; v_correct_count integer;
BEGIN
  IF auth.uid() IS NOT NULL AND auth.uid() <> p_user_id THEN RAISE EXCEPTION 'You can only finish arena games as yourself.'; END IF;
  SELECT * INTO v_room FROM public.arena_rooms WHERE id = p_room_id FOR UPDATE;
  IF NOT FOUND OR v_room.status <> 'playing' THEN RAISE EXCEPTION 'Arena game is not active.'; END IF;
  IF EXISTS (SELECT 1 FROM public.arena_participants WHERE room_id = p_room_id AND user_id = p_user_id AND forfeited_at IS NOT NULL) THEN
    RAISE EXCEPTION 'You have forfeited this Arena match.';
  END IF;

  IF v_room.room_name NOT ILIKE '%[arena:ludo]%' THEN
    SELECT coalesce(sum(figs_earned), 0), count(*) FILTER (WHERE is_correct)
    INTO v_score, v_correct_count FROM public.arena_trivia_responses
    WHERE room_id = p_room_id AND user_id = p_user_id;
  ELSE
    v_score := greatest(0, coalesce(p_score, 0));
    v_correct_count := greatest(0, coalesce(p_correct_count, 0));
  END IF;

  UPDATE public.arena_participants
  SET score = v_score, correct_count = v_correct_count, finished_at = now(), last_active_at = now()
  WHERE room_id = p_room_id AND user_id = p_user_id AND forfeited_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'You are not an active participant in this arena room.'; END IF;

  IF v_room.play_mode = 'machine' OR NOT EXISTS (
    SELECT 1 FROM public.arena_participants
    WHERE room_id = p_room_id AND forfeited_at IS NULL AND finished_at IS NULL
  ) THEN
    IF v_room.play_mode = 'machine' THEN
      v_winner := CASE WHEN v_score >= COALESCE(v_room.machine_score, 10) THEN p_user_id ELSE NULL END;
    ELSE
      SELECT user_id INTO v_winner FROM public.arena_participants
      WHERE room_id = p_room_id AND forfeited_at IS NULL
      ORDER BY score DESC, correct_count DESC, finished_at ASC LIMIT 1;
    END IF;
    SELECT count(*) INTO v_count FROM public.arena_participants WHERE room_id = p_room_id;
    v_total_stake := COALESCE(v_room.stake_amount, 0) * v_count * 10;
    IF v_winner IS NOT NULL AND v_total_stake > 0 AND NOT EXISTS (
      SELECT 1 FROM public.denarii_ledger_entries WHERE source_type = 'arena_reward' AND source_reference = p_room_id::text
    ) THEN
      INSERT INTO public.denarii_ledger_entries (user_id, amount, source_type, source_reference, description)
      VALUES (v_winner, v_total_stake, 'arena_reward', p_room_id::text, 'Arena tenfold winner reward for ' || v_room.room_name);
    END IF;
    SELECT display_name INTO v_winner_name FROM public.profiles WHERE id = v_winner;
    UPDATE public.arena_rooms SET status = 'completed', winner_id = v_winner, completed_at = now(), completion_reason = 'finished' WHERE id = p_room_id;
    FOR v_participant IN SELECT user_id FROM public.arena_participants WHERE room_id = p_room_id LOOP
      PERFORM public.notify_user(v_participant.user_id, v_winner, 'arena', CASE WHEN v_participant.user_id = v_winner THEN 'You won the arena' ELSE 'Arena game finished' END,
        CASE WHEN v_winner IS NULL THEN 'The Machine won "' || v_room.room_name || '".' WHEN v_participant.user_id = v_winner THEN 'You won "' || v_room.room_name || '" and received ' || v_total_stake::text || ' denarii.' ELSE COALESCE(v_winner_name, 'A cadet') || ' won "' || v_room.room_name || '".' END,
        'arena', jsonb_build_object('room_id', p_room_id, 'status', 'completed', 'winner_id', v_winner, 'reward_amount', CASE WHEN v_winner IS NULL THEN 0 ELSE v_total_stake END));
    END LOOP;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.heartbeat_arena_participant(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.forfeit_arena_game(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.expire_inactive_arena_participants() TO authenticated;
