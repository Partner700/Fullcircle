-- Permit a participating player to manually start an Arena match alone.
-- Keep scheduled countdown and selected-player authorization intact.
-- Automatic starts with two players are managed separately by the client.
CREATE OR REPLACE FUNCTION public.start_arena_game(p_room_id uuid, p_user_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_room public.arena_rooms%ROWTYPE; v_count integer; v_participant record;
BEGIN
  IF auth.uid() IS NOT NULL AND auth.uid() <> p_user_id THEN RAISE EXCEPTION 'You can only start arena rooms as yourself.'; END IF;
  PERFORM public.expire_stale_arena_rooms();
  SELECT * INTO v_room FROM public.arena_rooms WHERE id = p_room_id FOR UPDATE;
  IF NOT FOUND OR v_room.status <> 'waiting' THEN RAISE EXCEPTION 'Room is not waiting.'; END IF;
  IF v_room.creator_id <> p_user_id THEN RAISE EXCEPTION 'Only the host can start this room.'; END IF;
  SELECT count(*) INTO v_count FROM public.arena_participants WHERE room_id = p_room_id;
  IF v_count < 1 THEN RAISE EXCEPTION 'At least one player must be in the room to start.'; END IF;
  UPDATE public.arena_rooms SET status = 'playing', started_at = now(), expires_at = NULL WHERE id = p_room_id;
  FOR v_participant IN SELECT user_id FROM public.arena_participants WHERE room_id = p_room_id LOOP
    PERFORM public.notify_user(v_participant.user_id, p_user_id, 'arena', 'Arena game started', '"' || v_room.room_name || '" has started.', 'arena', jsonb_build_object('room_id', p_room_id, 'status', 'playing'));
  END LOOP;
END;
$function$;

CREATE OR REPLACE FUNCTION public.start_scheduled_arena_match(p_room_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_match public.arena_scheduled_matches%ROWTYPE; v_room public.arena_rooms%ROWTYPE; v_player uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sign in to start this match.'; END IF;
  SELECT * INTO v_match FROM public.arena_scheduled_matches WHERE room_id = p_room_id;
  IF NOT FOUND OR auth.uid() <> ALL(v_match.player_ids) THEN
    RAISE EXCEPTION 'Only selected players can start this match.';
  END IF;
  SELECT * INTO v_room FROM public.arena_rooms WHERE id = p_room_id FOR UPDATE;
  IF v_room.status = 'playing' THEN RETURN true; END IF;
  IF v_room.status <> 'waiting' OR now() > v_room.expires_at THEN
    RAISE EXCEPTION 'This scheduled match is no longer open.';
  END IF;
  IF now() < v_match.starts_at THEN RAISE EXCEPTION 'The countdown is still running.'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.arena_participants WHERE room_id = p_room_id AND user_id = auth.uid()) THEN
    RAISE EXCEPTION 'Enter the match as a player first.';
  END IF;
  IF (SELECT count(*) FROM public.arena_participants WHERE room_id = p_room_id AND forfeited_at IS NULL) < 1 THEN
    RAISE EXCEPTION 'At least one selected player must enter before the match starts.';
  END IF;
  UPDATE public.arena_rooms SET status = 'playing', started_at = now(), expires_at = NULL WHERE id = p_room_id;
  FOR v_player IN SELECT user_id FROM public.arena_participants WHERE room_id = p_room_id LOOP
    PERFORM public.notify_user(v_player, auth.uid(), 'arena', 'Arena game started',
      'The scheduled Arena match is live.', 'arena', jsonb_build_object('room_id', p_room_id, 'status', 'playing'));
  END LOOP;
  RETURN true;
END;
$function$;
