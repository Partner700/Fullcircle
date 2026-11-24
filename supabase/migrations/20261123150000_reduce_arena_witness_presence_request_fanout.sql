-- Reduce amplification when multiple cadets or guests witness Arena matches.
-- Applies the same public visibility checks without assembling room JSON.
-- Authenticated witness entry no longer repairs unrelated matches globally.
-- Room maintenance remains on the bounded Arena lobby path.

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
    SELECT 1 FROM private.intertent_fixtures WHERE room_id = p_room_id
  ) INTO v_intertent;
  SELECT room.status, room.started_at, room.completed_at
  INTO v_status, v_started_at, v_completed_at
  FROM public.arena_rooms room
  WHERE room.id = p_room_id
  FOR UPDATE;
  IF NOT FOUND OR v_status NOT IN ('waiting', 'playing')
     OR v_completed_at IS NOT NULL
     OR (v_status = 'playing' AND v_started_at IS NULL) THEN
    RAISE EXCEPTION 'This Arena match has ended and cannot be witnessed.';
  END IF;
  IF v_intertent AND v_status = 'playing'
     AND v_started_at + interval '5 minutes' >= now()
     AND EXISTS (
       SELECT 1 FROM public.arena_scheduled_matches s
       WHERE s.room_id = p_room_id AND v_user_id = ANY(s.player_ids)
     ) THEN
    RETURN public.join_instructor_arena_match(p_room_id);
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.arena_participants p
    WHERE p.room_id = p_room_id AND p.user_id = v_user_id
  ) THEN
    RAISE EXCEPTION 'You are already playing in this Arena match.';
  END IF;
  DELETE FROM public.arena_viewers
  WHERE user_id = v_user_id AND room_id <> p_room_id;
  INSERT INTO public.arena_viewers(room_id, user_id)
  VALUES (p_room_id, v_user_id)
  ON CONFLICT (room_id, user_id) DO UPDATE SET last_seen_at = now();
  RETURN true;
END;
$function$;

CREATE OR REPLACE FUNCTION public.watch_public_arena_room(p_room_id uuid, p_guest_key text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF char_length(btrim(coalesce(p_guest_key, ''))) NOT BETWEEN 8 AND 200 THEN
    RAISE EXCEPTION 'A guest session is required.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.arena_rooms room
    WHERE room.id = p_room_id
      AND room.status IN ('waiting', 'playing')
      AND room.completed_at IS NULL
      AND (room.status <> 'waiting'
        OR coalesce(room.expires_at, room.created_at + interval '15 minutes') > now())
      AND (room.status <> 'playing'
        OR (room.started_at IS NOT NULL AND EXISTS (
          SELECT 1 FROM public.arena_participants participant
          WHERE participant.room_id = p_room_id
            AND participant.forfeited_at IS NULL
            AND participant.finished_at IS NULL
            AND coalesce(participant.last_active_at, participant.joined_at, room.started_at)
                > now() - interval '3 minutes'
        )))
  ) THEN
    RETURN false;
  END IF;

  INSERT INTO public.arena_guest_witnesses(room_id, guest_key_hash, last_seen_at)
  VALUES (p_room_id, md5(p_guest_key), now())
  ON CONFLICT (room_id, guest_key_hash)
  DO UPDATE SET last_seen_at = now();
  RETURN true;
END;
$function$;
