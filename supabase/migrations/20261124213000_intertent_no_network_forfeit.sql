-- Inter-tent Journey participants do not lose their game turn to a temporary
-- connection loss. Existing manual forfeiture rules remain intact.
CREATE OR REPLACE FUNCTION public.expire_inactive_arena_participants()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
      AND room.room_name NOT ILIKE '%[arena:prelude]%'
      -- Players in inter-tent Journey must not forfeit because a phone loses
      -- heartbeat. Only an explicit surrender may remove a selected player.
      AND room.room_name NOT ILIKE '%[intertent]%'
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
    WHERE room.status = 'playing' AND room.room_name NOT ILIKE '%[arena:prelude]%' AND room.room_name NOT ILIKE '%[intertent]%' AND participant.forfeited_at IS NOT NULL
  LOOP
    PERFORM public.settle_standard_arena_forfeit(v_room.room_id);
  END LOOP;
  RETURN v_count;
END;
$function$
;