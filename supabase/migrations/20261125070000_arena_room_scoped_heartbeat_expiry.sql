-- Restrict Arena heartbeat inactivity cleanup to the current room.
-- Previously each heartbeat scanned all playing rooms and settled all forfeits.
-- Preserve the original three-minute inactivity rule and Inter-Tent exemption.
CREATE OR REPLACE FUNCTION public.heartbeat_arena_participant(p_room_id uuid, p_user_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_room_status text;
  v_forfeited integer := 0;
BEGIN
  IF auth.uid() IS NOT NULL AND auth.uid() <> p_user_id THEN
    RAISE EXCEPTION 'You can only update your own arena presence.';
  END IF;

  SELECT status INTO v_room_status
  FROM public.arena_rooms WHERE id=p_room_id;
  IF v_room_status='completed' THEN RETURN true; END IF;

  -- Formerly every player's 20-second heartbeat expired and settled every
  -- active Arena room globally. Restrict that work to this room so traffic
  -- from concurrent matches does not multiply database lock pressure.
  WITH expired AS (
    UPDATE public.arena_participants participant
    SET forfeited_at = now(), forfeit_reason = 'inactive',
        finished_at = coalesce(participant.finished_at, now())
    FROM public.arena_rooms room
    WHERE room.id=p_room_id AND participant.room_id=room.id
      AND room.status='playing'
      AND room.room_name NOT ILIKE '%[arena:prelude]%'
      AND room.room_name NOT ILIKE '%[intertent]%'
      AND participant.forfeited_at IS NULL
      AND participant.finished_at IS NULL
      AND participant.last_active_at < now() - interval '3 minutes'
    RETURNING participant.id
  )
  SELECT count(*) INTO v_forfeited FROM expired;

  IF v_forfeited > 0 OR EXISTS(
    SELECT 1 FROM public.arena_participants p
    JOIN public.arena_rooms r ON r.id=p.room_id
    WHERE p.room_id=p_room_id AND r.status='playing'
      AND r.room_name NOT ILIKE '%[arena:prelude]%'
      AND r.room_name NOT ILIKE '%[intertent]%'
      AND p.forfeited_at IS NOT NULL
  ) THEN
    PERFORM public.settle_standard_arena_forfeit(p_room_id);
  END IF;

  UPDATE public.arena_participants participant
  SET last_active_at=now()
  FROM public.arena_rooms room
  WHERE participant.room_id=p_room_id
    AND participant.user_id=p_user_id
    AND participant.room_id=room.id
    AND room.status='playing'
    AND participant.forfeited_at IS NULL;
  RETURN FOUND;
END;
$function$
;
REVOKE ALL ON FUNCTION public.heartbeat_arena_participant(uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.heartbeat_arena_participant(uuid,uuid) TO authenticated;
