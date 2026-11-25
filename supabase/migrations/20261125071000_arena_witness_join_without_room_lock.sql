-- Witnesses read room state without locking active player turns.
-- Scheduled competitors opening witness links are admitted as players.
CREATE OR REPLACE FUNCTION public.watch_arena_room(p_room_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_status text;
  v_started_at timestamptz;
  v_completed_at timestamptz;
  v_intertent boolean;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Sign in before witnessing an Arena match.';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM private.intertent_fixtures WHERE room_id=p_room_id
  ) INTO v_intertent;

  -- Spectators read room status but never alter the room; do not acquire
  -- the row lock used by active players and turn commands.
  SELECT room.status,room.started_at,room.completed_at
  INTO v_status,v_started_at,v_completed_at
  FROM public.arena_rooms room WHERE room.id=p_room_id;

  IF NOT FOUND OR v_status NOT IN ('waiting','playing')
     OR v_completed_at IS NOT NULL
     OR (v_status='playing' AND v_started_at IS NULL) THEN
    RAISE EXCEPTION 'This Arena match has ended and cannot be witnessed.';
  END IF;

  -- Even a selected competitor who opens a witness link enters as a player.
  -- The join function takes the proper lock and controls admission.
  IF v_intertent AND v_status IN ('waiting','playing')
     AND EXISTS(
       SELECT 1 FROM public.arena_scheduled_matches s
       WHERE s.room_id=p_room_id AND v_user_id=ANY(s.player_ids)
     ) THEN
    RETURN public.join_instructor_arena_match(p_room_id);
  END IF;

  IF EXISTS(
    SELECT 1 FROM public.arena_participants a
    WHERE a.room_id=p_room_id AND a.user_id=v_user_id
  ) THEN
    RAISE EXCEPTION 'You are already playing in this Arena match.';
  END IF;

  DELETE FROM public.arena_viewers
  WHERE user_id=v_user_id AND room_id<>p_room_id;

  -- Verify eligibility again at insertion time without locking game rows.
  INSERT INTO public.arena_viewers(room_id,user_id)
  SELECT p_room_id,v_user_id
  FROM public.arena_rooms room
  WHERE room.id=p_room_id
    AND room.status IN ('waiting','playing')
    AND room.completed_at IS NULL
    AND (room.status='waiting' OR room.started_at IS NOT NULL)
  ON CONFLICT(room_id,user_id) DO UPDATE SET last_seen_at=now();

  IF NOT FOUND THEN
    RAISE EXCEPTION 'This Arena match has ended and cannot be witnessed.';
  END IF;
  RETURN true;
END;
$function$
;
REVOKE ALL ON FUNCTION public.watch_arena_room(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.watch_arena_room(uuid) TO authenticated;
