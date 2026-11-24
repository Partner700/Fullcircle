-- Late-entry penalties belong to an actual room, not a reusable fixture.
-- If a room was canceled, a replay receives a new 15-minute window and
-- cannot inherit a 5,000D penalty from the canceled attempt.
CREATE OR REPLACE FUNCTION private.process_intertent_late_penalties()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  fixture record;
  absent_player uuid;
  processed integer := 0;
  reference_key text;
BEGIN
  FOR fixture IN
    SELECT f.id AS fixture_id, f.player_ids, r.id AS room_id, r.started_at
    FROM private.intertent_fixtures f
    JOIN public.arena_rooms r ON r.id=f.room_id
    WHERE r.status IN ('playing','completed')
      AND r.started_at IS NOT NULL
      AND r.started_at + interval '15 minutes' <= now()
      AND f.result IS DISTINCT FROM '[]'::jsonb
    ORDER BY r.started_at, r.id
  LOOP
    -- Serialize with join_instructor_arena_match, which also locks this room.
    PERFORM 1 FROM public.arena_rooms WHERE id=fixture.room_id FOR UPDATE;
    reference_key := 'intertent-late-final:' || fixture.room_id::text;
    FOR absent_player IN
      SELECT player_id
      FROM unnest(fixture.player_ids) AS player_id
      WHERE NOT EXISTS (
        -- This player had NOT entered within the 15-minute grace period.
        -- Covers absentees AND participants who joined after the deadline.
        SELECT 1 FROM public.arena_participants a
        WHERE a.room_id=fixture.room_id AND a.user_id=player_id
          AND a.joined_at <= fixture.started_at + interval '15 minutes'
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.denarii_ledger_entries d
        WHERE d.user_id=player_id AND d.source_type='admin_adjustment'
          AND d.source_reference=reference_key
      )
    LOOP
      BEGIN
        INSERT INTO public.denarii_ledger_entries
          (user_id, amount, source_type, source_reference, description)
        VALUES (absent_player, -5000, 'admin_adjustment', reference_key,
                'Inter-Tent Championship · joined after 15-minute grace period')
        ON CONFLICT DO NOTHING;
        IF FOUND THEN processed := processed + 1; END IF;
      EXCEPTION WHEN raise_exception THEN
        -- Existing nonnegative-balance safeguard remains authoritative.
        RAISE WARNING 'Late Arena penalty could not be collected for fixture %', fixture.fixture_id;
      END;
    END LOOP;
  END LOOP;
  RETURN processed;
END;
$function$
;

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
   -- The first entrant can start as soon as the scheduled countdown finishes.
   -- Do not force the first player to wait for a second participant.
   IF v_match.is_intertent_match AND now()>=v_match.starts_at THEN
     PERFORM public.start_scheduled_arena_match(p_room_id);
   END IF;
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
   -- Join order is append-only. Journey advances via the existing
   -- modulo turn rotation, so a solo player keeps rolling until someone joins;
   -- every new player then takes their turns in arrival order.
   v_next_version:=v_game.version+1;
   v_state:=jsonb_set(v_game.state- 'undo','{game,players}',v_game.state->'game'->'players'||jsonb_build_array(v_player));
   v_state:=jsonb_set(v_state,'{game,tentSides}',coalesce(v_state->'game'->'tentSides','{}'::jsonb)||jsonb_build_object(v_user::text,v_fixture.sides->>v_user::text));
   v_state:=jsonb_set(v_state,'{game,version}',to_jsonb(v_next_version));
   UPDATE public.arena_journey_games SET state=v_state,version=v_next_version,updated_at=now() WHERE room_id=p_room_id;
 END IF;
 -- The first 15 minutes from the actual start are penalty-free.
 -- Selected players may still join once that window closes, even after
 -- forfeiture of punctuality. A unique ledger index ensures one debit only.
 IF now() > v_room.started_at + interval '15 minutes' THEN
   BEGIN
     INSERT INTO public.denarii_ledger_entries(user_id,amount,source_type,source_reference,description)
     VALUES(v_user,-5000,'admin_adjustment',
       'intertent-late-final:'||p_room_id::text,
       'Inter-Tent Championship · joined after 15-minute grace period')
     ON CONFLICT DO NOTHING;
   EXCEPTION WHEN raise_exception THEN
     -- A negative-balance protection may reject the debit; never turn that
     -- financial safeguard into a technical lockout from an active match.
     RAISE WARNING 'Selected player % has an unpaid late-entry penalty for fixture %',v_user,v_fixture.id;
   END;
 END IF;
 INSERT INTO public.arena_participants(room_id,user_id,stake_paid) VALUES(p_room_id,v_user,true);
 DELETE FROM public.arena_viewers WHERE room_id=p_room_id AND user_id=v_user;
 RETURN true;
END; $function$
;
