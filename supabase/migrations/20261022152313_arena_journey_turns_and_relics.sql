-- Inventory and game effects commit together; only authenticated edge handlers may call these RPCs.
CREATE OR REPLACE FUNCTION journey_private.consume_arena_relic(p_user_id uuid, p_room_id uuid, p_slug text)
RETURNS void LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE v_relic uuid;
BEGIN
  IF p_slug IS NULL THEN RETURN; END IF;
  IF p_slug NOT IN ('hint','eliminate','freeze-timer','skip','reveal-reference','witch-ball-endor','talking-donkey') THEN
    RAISE EXCEPTION 'This relic is not used during Arena questions.';
  END IF;
  SELECT id INTO v_relic FROM public.relic_types WHERE slug = p_slug;
  UPDATE public.relic_inventory SET quantity = quantity - 1
  WHERE user_id = p_user_id AND relic_type_id = v_relic AND quantity > 0;
  IF NOT FOUND THEN RAISE EXCEPTION 'You do not own this relic.'; END IF;
  INSERT INTO public.relic_usage_log(user_id, relic_type_id, effect_applied)
  VALUES (p_user_id, v_relic, 'arena:' || p_room_id::text || ':' || p_slug);
END;
$$;
REVOKE ALL ON FUNCTION journey_private.consume_arena_relic(uuid, uuid, text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.commit_arena_journey_turn(
  p_room_id uuid, p_expected_version integer, p_next_state jsonb,
  p_command_id uuid, p_actor_id uuid, p_relic_slug text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_room public.arena_rooms%ROWTYPE; v_result jsonb; v_state jsonb;
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN RAISE EXCEPTION 'Arena commands are server-only.' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_room FROM public.arena_rooms WHERE id = p_room_id FOR UPDATE;
  SELECT state INTO v_state FROM public.arena_journey_games WHERE room_id = p_room_id FOR UPDATE;
  IF NOT EXISTS (SELECT 1 FROM public.arena_journey_commands WHERE room_id = p_room_id AND command_id = p_command_id)
    AND p_relic_slug IS NOT NULL THEN
    IF v_room.status <> 'playing' OR v_state->>'currentQuestionPlayerId' IS DISTINCT FROM p_actor_id::text
      OR coalesce((v_state->>'awaitingRoll')::boolean, false)
      OR coalesce((v_state->>'questionDeadline')::timestamptz, '-infinity') <= now()
      OR (v_state->>'questionOpensAt')::timestamptz > now()
      OR v_state->'questionAid'->'used' ? p_relic_slug THEN
      RAISE EXCEPTION 'Relics are available only during your open question.';
    END IF;
  END IF;
  IF v_room.play_mode = 'machine' THEN
    v_result := public.commit_machine_arena_journey_command(p_room_id,p_expected_version,p_next_state,p_command_id,p_actor_id);
  ELSE
    v_result := public.commit_arena_journey_command(p_room_id,p_expected_version,p_next_state,p_command_id,p_actor_id);
  END IF;
  IF NOT (v_result->>'duplicate')::boolean THEN
    PERFORM journey_private.consume_arena_relic(p_actor_id, p_room_id, p_relic_slug);
  END IF;
  RETURN v_result;
END;
$$;
REVOKE ALL ON FUNCTION public.commit_arena_journey_turn(uuid,integer,jsonb,uuid,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.commit_arena_journey_turn(uuid,integer,jsonb,uuid,uuid,text) TO service_role;

-- Keep actual correct-answer counts, but save the separate signed Journey points before result triggers run.
CREATE OR REPLACE FUNCTION journey_private.sync_journey_points()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_player jsonb;
BEGIN
  IF TG_TABLE_NAME = 'arena_participants' THEN
    SELECT player INTO v_player FROM public.arena_journey_games game,
      jsonb_array_elements(game.state->'game'->'players') player
    WHERE game.room_id = NEW.room_id AND player->>'id' = NEW.user_id::text;
    IF v_player ? 'score' THEN NEW.score := (v_player->>'score')::integer; END IF;
  ELSE
    SELECT player INTO v_player FROM public.arena_journey_games game,
      jsonb_array_elements(game.state->'game'->'players') player
    WHERE game.room_id = NEW.id AND player->>'id' = '00000000-0000-0000-0000-000000000000';
    IF v_player ? 'score' THEN NEW.machine_score := (v_player->>'score')::integer; END IF;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION journey_private.sync_journey_points() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER sync_journey_participant_points BEFORE UPDATE OF score ON public.arena_participants
FOR EACH ROW EXECUTE FUNCTION journey_private.sync_journey_points();
CREATE TRIGGER sync_journey_machine_points BEFORE UPDATE OF machine_score ON public.arena_rooms
FOR EACH ROW EXECUTE FUNCTION journey_private.sync_journey_points();

CREATE OR REPLACE FUNCTION public.commit_arena_ludo_turn(
  p_room_id uuid, p_expected_version integer, p_next_state jsonb, p_public_state jsonb,
  p_command_id uuid, p_actor_id uuid, p_relic_slug text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_room public.arena_rooms%ROWTYPE; v_game public.arena_ludo_games%ROWTYPE; v_version integer; v_event jsonb;
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN RAISE EXCEPTION 'Arena commands are server-only.' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_room FROM public.arena_rooms WHERE id = p_room_id FOR UPDATE;
  SELECT * INTO v_game FROM public.arena_ludo_games WHERE room_id = p_room_id FOR UPDATE;
  IF v_room.id IS NULL OR v_game.room_id IS NULL OR v_room.room_name NOT ILIKE '%[arena:ludo]%' THEN RAISE EXCEPTION 'Arena room not found.'; END IF;
  IF EXISTS (SELECT 1 FROM public.arena_ludo_commands WHERE room_id = p_room_id AND command_id = p_command_id) THEN
    RETURN jsonb_build_object('duplicate',true,'state',(SELECT public_state FROM public.arena_ludo_public_states WHERE room_id = p_room_id));
  END IF;
  IF v_room.status <> 'playing' OR v_game.version <> p_expected_version THEN RAISE EXCEPTION 'The match advanced on another device.' USING ERRCODE = '40001'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.arena_participants WHERE room_id = p_room_id AND user_id = p_actor_id) THEN
    RAISE EXCEPTION 'Only a player may advance the match.' USING ERRCODE = '42501';
  END IF;
  v_version := (p_next_state->>'version')::integer;
  IF v_version IS NULL OR v_version <= p_expected_version OR (p_public_state->>'version')::integer IS DISTINCT FROM v_version
    OR p_next_state->>'roomId' IS DISTINCT FROM p_room_id::text THEN RAISE EXCEPTION 'Invalid Arena turn.'; END IF;
  IF p_relic_slug IS NOT NULL THEN
    IF v_game.private_state->>'phase' IS DISTINCT FROM 'QUESTION'
      OR v_game.private_state->'players'->((v_game.private_state->>'activePlayerIndex')::integer)->>'id' IS DISTINCT FROM p_actor_id::text
      OR coalesce((v_game.private_state->>'questionDeadline')::timestamptz, '-infinity') <= now()
      OR v_game.private_state->'questionAid'->'used' ? p_relic_slug
      OR EXISTS (SELECT 1 FROM public.arena_participants WHERE room_id = p_room_id AND user_id = p_actor_id AND forfeited_at IS NOT NULL) THEN
      RAISE EXCEPTION 'Relics are available only during your open question.';
    END IF;
    PERFORM journey_private.consume_arena_relic(p_actor_id,p_room_id,p_relic_slug);
  END IF;
  UPDATE public.arena_ludo_games SET version = v_version, private_state = p_next_state, updated_at = now() WHERE room_id = p_room_id;
  INSERT INTO public.arena_ludo_public_states(room_id,version,public_state,updated_at)
  VALUES(p_room_id,v_version,p_public_state,now()) ON CONFLICT(room_id) DO UPDATE
    SET version = EXCLUDED.version, public_state = EXCLUDED.public_state, updated_at = EXCLUDED.updated_at;
  INSERT INTO public.arena_ludo_commands(room_id,command_id,actor_id,state_version) VALUES(p_room_id,p_command_id,p_actor_id,v_version);
  FOR v_event IN SELECT value FROM jsonb_array_elements(p_next_state->'eventLog') LOOP
    INSERT INTO public.arena_ludo_events(id,room_id,event_type,actor_id,message,event_data,created_at)
    VALUES(v_event->>'id',p_room_id,v_event->>'type',v_event->>'playerId',
      v_event->>'message','{}'::jsonb,(v_event->>'createdAt')::timestamptz) ON CONFLICT(id) DO NOTHING;
  END LOOP;
  RETURN jsonb_build_object('duplicate',false,'state',p_public_state);
END;
$$;
REVOKE ALL ON FUNCTION public.commit_arena_ludo_turn(uuid,integer,jsonb,jsonb,uuid,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.commit_arena_ludo_turn(uuid,integer,jsonb,jsonb,uuid,uuid,text) TO service_role;

CREATE OR REPLACE FUNCTION journey_private.add_journey_scores(p_room_id uuid,p_players jsonb)
RETURNS jsonb LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT coalesce(jsonb_agg(player || CASE WHEN saved.value ? 'score'
    THEN jsonb_build_object('score',(saved.value->>'score')::integer,'correct_count',(saved.value->>'correctAnswers')::integer) ELSE '{}'::jsonb END ORDER BY ordinal),'[]'::jsonb)
  FROM jsonb_array_elements(p_players) WITH ORDINALITY entry(player,ordinal)
  LEFT JOIN public.arena_journey_games game ON game.room_id = p_room_id
  LEFT JOIN LATERAL (SELECT value FROM jsonb_array_elements(game.state->'game'->'players')
    WHERE value->>'id' = player->>'user_id') saved ON true;
$$;
REVOKE ALL ON FUNCTION journey_private.add_journey_scores(uuid,jsonb) FROM PUBLIC,anon,authenticated;
ALTER FUNCTION public.get_public_arena_final_scorecard(uuid) SET SCHEMA journey_private;
REVOKE ALL ON FUNCTION journey_private.get_public_arena_final_scorecard(uuid) FROM PUBLIC,anon,authenticated;
CREATE FUNCTION public.get_public_arena_final_scorecard(p_room_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT CASE WHEN result IS NULL THEN NULL ELSE result || jsonb_build_object('players',
    journey_private.add_journey_scores(p_room_id,result->'players')) END
  FROM (SELECT journey_private.get_public_arena_final_scorecard(p_room_id) result) data;
$$;
REVOKE ALL ON FUNCTION public.get_public_arena_final_scorecard(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_arena_final_scorecard(uuid) TO anon,authenticated;
ALTER FUNCTION public.get_public_arena_journey_matchup(uuid) SET SCHEMA journey_private;
REVOKE ALL ON FUNCTION journey_private.get_public_arena_journey_matchup(uuid) FROM PUBLIC,anon,authenticated;
CREATE FUNCTION public.get_public_arena_journey_matchup(p_room_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT journey_private.add_journey_scores(p_room_id,journey_private.get_public_arena_journey_matchup(p_room_id));
$$;
REVOKE ALL ON FUNCTION public.get_public_arena_journey_matchup(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_arena_journey_matchup(uuid) TO anon,authenticated;
ALTER FUNCTION public.get_arena_matchups(uuid[]) SET SCHEMA journey_private;
REVOKE ALL ON FUNCTION journey_private.get_arena_matchups(uuid[]) FROM PUBLIC,anon,authenticated;
CREATE FUNCTION public.get_arena_matchups(p_room_ids uuid[])
RETURNS TABLE(room_id uuid,players jsonb) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT data.room_id, journey_private.add_journey_scores(data.room_id,data.players)
  FROM journey_private.get_arena_matchups(p_room_ids) data;
$$;
REVOKE ALL ON FUNCTION public.get_arena_matchups(uuid[]) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_arena_matchups(uuid[]) TO authenticated;
NOTIFY pgrst, 'reload schema';
