-- Selected participants can enter live inter-tent matches after the attendance grace period.
-- Preserve punctuality penalties, existing scores, role checks, and spectator restrictions.
CREATE OR REPLACE FUNCTION public.join_instructor_arena_match(p_room_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v_match public.arena_scheduled_matches%ROWTYPE; v_room public.arena_rooms%ROWTYPE;
 v_game public.arena_journey_games%ROWTYPE; v_fixture private.intertent_fixtures%ROWTYPE;
 v_user uuid:=auth.uid(); v_player jsonb; v_state jsonb; v_next_version integer;
BEGIN
 IF v_user IS NULL THEN RAISE EXCEPTION 'Sign in to join this match.'; END IF;
 SELECT * INTO v_match FROM public.arena_scheduled_matches WHERE room_id=p_room_id;
 IF NOT FOUND OR v_user <> ALL(v_match.player_ids) THEN RAISE EXCEPTION 'This match is reserved for its selected players.'; END IF;
 SELECT * INTO v_room FROM public.arena_rooms WHERE id=p_room_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'This waiting room has closed.'; END IF;
 IF v_room.status='waiting' AND v_room.expires_at>now() THEN
   INSERT INTO public.arena_participants(room_id,user_id,stake_paid) VALUES(p_room_id,v_user,true) ON CONFLICT(room_id,user_id) DO NOTHING;
   RETURN true;
 END IF;
 SELECT * INTO v_fixture FROM private.intertent_fixtures WHERE room_id=p_room_id;
 IF NOT FOUND OR NOT v_match.is_intertent_match OR v_room.status<>'playing' THEN RAISE EXCEPTION 'This waiting room has closed.'; END IF;
 IF EXISTS(SELECT 1 FROM public.arena_participants a WHERE a.room_id=p_room_id AND a.user_id=v_user AND a.forfeited_at IS NULL) THEN RETURN true; END IF;
 IF v_room.started_at IS NULL THEN RAISE EXCEPTION 'The match has not started.'; END IF;
 -- Selected competitors may join while an inter-tent Journey is live.
 -- The five-minute attendance penalty is evaluated separately and is not an access ban.
 IF NOT(v_user=ANY(v_fixture.player_ids)) OR NOT(v_fixture.sides ? v_user::text) OR EXISTS(SELECT 1 FROM public.arena_participants a WHERE a.room_id=p_room_id AND a.user_id=v_user) THEN RAISE EXCEPTION 'You cannot enter this fixture.'; END IF;
 SELECT * INTO v_game FROM public.arena_journey_games WHERE room_id=p_room_id FOR UPDATE;
 IF FOUND THEN
   IF v_game.state->'game'->>'status'<>'playing' OR jsonb_array_length(v_game.state->'game'->'players')>=cardinality(v_fixture.player_ids) THEN RAISE EXCEPTION 'This Journey match is no longer accepting players.'; END IF;
   v_player:=jsonb_build_object('id',v_user::text,'location',jsonb_build_object('route','main','space',1),'status','ACTIVE','loopEntryMainSpace',NULL,'completedLoopCircuits',0,'loopEscapes',0,'prisonTurnsRemaining',0,'savedLocation',NULL,'pendingEffects','[]'::jsonb,'correctAnswers',0,'completedLaps',0,'score',0,'questionFigs',0);
   v_next_version:=v_game.version+1;
   v_state:=jsonb_set(v_game.state- 'undo','{game,players}',v_game.state->'game'->'players'||jsonb_build_array(v_player));
   v_state:=jsonb_set(v_state,'{game,tentSides}',coalesce(v_state->'game'->'tentSides','{}'::jsonb)||jsonb_build_object(v_user::text,v_fixture.sides->>v_user::text));
   v_state:=jsonb_set(v_state,'{game,version}',to_jsonb(v_next_version));
   UPDATE public.arena_journey_games SET state=v_state,version=v_next_version,updated_at=now() WHERE room_id=p_room_id;
 END IF;
 INSERT INTO public.arena_participants(room_id,user_id,stake_paid) VALUES(p_room_id,v_user,true);
 DELETE FROM public.arena_viewers WHERE room_id=p_room_id AND user_id=v_user;
 RETURN true;
END; $function$
;

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
  -- Reserved competitors are participants, never spectators, even after
  -- the five-minute punctuality grace period has elapsed.
  IF v_intertent AND v_status = 'playing'
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
$function$
;
