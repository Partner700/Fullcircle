-- Staged: do not activate a live championship until the client and tournament cutover are verified.
BEGIN;

CREATE TABLE private.intertent_duel_roles (
  fixture_id uuid PRIMARY KEY REFERENCES private.intertent_fixtures(id),
  home_tent_id uuid NOT NULL REFERENCES public.tents(id),
  away_tent_id uuid NOT NULL REFERENCES public.tents(id),
  spirit_user_id uuid REFERENCES public.profiles(id),
  assists integer NOT NULL DEFAULT 0 CHECK(assists BETWEEN 0 AND 3),
  requested_question_id uuid,
  home_substitutions integer NOT NULL DEFAULT 0 CHECK(home_substitutions BETWEEN 0 AND 1),
  away_substitutions integer NOT NULL DEFAULT 0 CHECK(away_substitutions BETWEEN 0 AND 1),
  excluded_player_ids uuid[] NOT NULL DEFAULT '{}',
  home_allow_unqualified boolean NOT NULL DEFAULT false,
  away_allow_unqualified boolean NOT NULL DEFAULT false,
  home_roster uuid[] NOT NULL DEFAULT '{}',
  away_roster uuid[] NOT NULL DEFAULT '{}',
  CHECK(home_tent_id<>away_tent_id)
);
ALTER TABLE private.intertent_duel_roles ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.intertent_duel_roles FROM PUBLIC, anon, authenticated;

CREATE FUNCTION private.intertent_spirit_eligible(p_room uuid,p_tent uuid,p_witness uuid)
RETURNS boolean LANGUAGE sql STABLE SET search_path='' AS $$
  SELECT EXISTS (SELECT 1 FROM public.tent_members m JOIN public.tents t ON t.id=m.tent_id
    JOIN public.arena_viewers w ON w.user_id=m.user_id AND w.room_id=p_room
    WHERE m.tent_id=p_tent AND m.user_id=p_witness AND m.role='cadet'
      AND t.sentry_id IS DISTINCT FROM p_witness AND w.last_seen_at>now()-interval '2 minutes'
      AND NOT EXISTS(SELECT 1 FROM public.role_assignments a WHERE a.user_id=p_witness AND a.role IN ('sentry','instructor','admin') AND a.status IN ('active','approved'))
      AND NOT EXISTS(SELECT 1 FROM public.arena_scheduled_matches s WHERE s.room_id=p_room AND p_witness=ANY(s.player_ids)));
$$;
REVOKE ALL ON FUNCTION private.intertent_spirit_eligible(uuid,uuid,uuid) FROM PUBLIC, anon, authenticated;

-- An explicit tournament roster can include previously assigned non-resident
-- representatives without silently changing their account's tent membership.
CREATE FUNCTION private.intertent_duel_rep_allowed(p_user uuid,p_tent uuid,p_roster uuid[],p_excluded uuid[],p_allow_unqualified boolean)
RETURNS boolean LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT p_user IS NOT NULL AND NOT(p_user=ANY(p_excluded))
 AND NOT EXISTS(SELECT 1 FROM public.tents t WHERE t.id=p_tent AND t.sentry_id=p_user)
 AND NOT EXISTS(SELECT 1 FROM public.role_assignments a WHERE a.user_id=p_user AND a.role IN('sentry','instructor','admin') AND a.status IN('active','approved'))
 AND (p_allow_unqualified OR private.intertent_qualified(p_user))
 AND CASE WHEN cardinality(p_roster)>0 THEN p_user=ANY(p_roster)
   AND EXISTS(SELECT 1 FROM public.role_assignments a WHERE a.user_id=p_user AND a.role='cadet' AND a.status IN('active','approved'))
   AND NOT EXISTS(SELECT 1 FROM public.tent_members m WHERE m.user_id=p_user AND m.role='cadet' AND m.tent_id<>p_tent)
 ELSE EXISTS(SELECT 1 FROM public.tent_members m WHERE m.user_id=p_user AND m.tent_id=p_tent AND m.role='cadet') END;
$$;
REVOKE ALL ON FUNCTION private.intertent_duel_rep_allowed(uuid,uuid,uuid[],uuid[],boolean) FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.get_intertent_duel_roles(p_room_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE f private.intertent_fixtures%ROWTYPE; d private.intertent_duel_roles%ROWTYPE; actor uuid:=auth.uid(); sentry_seat integer; sentry_tent uuid;
BEGIN
  IF actor IS NULL THEN RAISE EXCEPTION 'Sign in first.'; END IF;
  SELECT * INTO f FROM private.intertent_fixtures WHERE room_id=p_room_id;
  SELECT * INTO d FROM private.intertent_duel_roles WHERE fixture_id=f.id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.arena_participants a WHERE a.room_id=p_room_id AND a.user_id=actor AND a.forfeited_at IS NULL)
    AND NOT EXISTS(SELECT 1 FROM public.arena_viewers w WHERE w.room_id=p_room_id AND w.user_id=actor AND w.last_seen_at>now()-interval '2 minutes')
    AND NOT EXISTS(SELECT 1 FROM public.tents t WHERE t.id IN (d.home_tent_id,d.away_tent_id) AND t.sentry_id=actor) THEN RETURN NULL; END IF;
  SELECT CASE WHEN t.id=d.home_tent_id THEN 1 ELSE 2 END,t.id INTO sentry_seat,sentry_tent FROM public.tents t WHERE t.id IN(d.home_tent_id,d.away_tent_id) AND t.sentry_id=actor AND EXISTS(SELECT 1 FROM public.role_assignments a WHERE a.user_id=actor AND a.role='sentry' AND a.status IN('active','approved'));
  RETURN jsonb_build_object('stage',f.stage,'homePlayerId',f.player_ids[1],'awayPlayerId',f.player_ids[2],
     'spiritUserId',d.spirit_user_id,'remaining',CASE WHEN f.stage='final' THEN 0 ELSE 3-d.assists END,'requestQuestionId',d.requested_question_id,
     'sentrySeat',sentry_seat,'substitutionRemaining',CASE WHEN sentry_seat=1 THEN 1-d.home_substitutions WHEN sentry_seat=2 THEN 1-d.away_substitutions ELSE 0 END,
     'substitutes',CASE WHEN sentry_seat IS NOT NULL THEN (SELECT coalesce(jsonb_agg(jsonb_build_object('id',p.id,'name',p.display_name) ORDER BY p.display_name),'[]') FROM public.profiles p WHERE p.id<>actor AND NOT(p.id=ANY(f.player_ids)) AND p.id IS DISTINCT FROM d.spirit_user_id AND private.intertent_duel_rep_allowed(p.id,sentry_tent,CASE WHEN sentry_seat=1 THEN d.home_roster ELSE d.away_roster END,d.excluded_player_ids,CASE WHEN sentry_seat=1 THEN d.home_allow_unqualified ELSE d.away_allow_unqualified END)) ELSE '[]'::jsonb END,
     'candidates',CASE WHEN f.stage<>'final' AND f.player_ids[1]=actor AND d.spirit_user_id IS NULL THEN
       (SELECT coalesce(jsonb_agg(jsonb_build_object('id',p.id,'name',p.display_name) ORDER BY p.display_name),'[]') FROM public.profiles p JOIN public.arena_viewers w ON w.user_id=p.id AND w.room_id=p_room_id WHERE private.intertent_spirit_eligible(p_room_id,d.home_tent_id,p.id)) ELSE '[]'::jsonb END);
END $$;
REVOKE ALL ON FUNCTION public.get_intertent_duel_roles(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_intertent_duel_roles(uuid) TO authenticated;

CREATE FUNCTION public.choose_intertent_spirit(p_room_id uuid,p_witness uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE f private.intertent_fixtures%ROWTYPE; d private.intertent_duel_roles%ROWTYPE; actor uuid:=auth.uid();
BEGIN
  IF actor IS NULL THEN RAISE EXCEPTION 'Sign in first.'; END IF;
  PERFORM 1 FROM public.arena_rooms WHERE id=p_room_id AND status='playing' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'The match is not live.'; END IF;
  SELECT * INTO STRICT f FROM private.intertent_fixtures WHERE room_id=p_room_id FOR UPDATE;
  SELECT * INTO STRICT d FROM private.intertent_duel_roles WHERE fixture_id=f.id FOR UPDATE;
  IF f.stage='final' OR cardinality(f.player_ids)<>2 OR f.player_ids[1] IS DISTINCT FROM actor OR d.spirit_user_id IS NOT NULL
     OR NOT EXISTS(SELECT 1 FROM public.arena_participants a WHERE a.room_id=p_room_id AND a.user_id=actor AND a.forfeited_at IS NULL)
     OR NOT private.intertent_spirit_eligible(p_room_id,d.home_tent_id,p_witness) THEN RAISE EXCEPTION 'Spirit selection is unavailable.'; END IF;
  UPDATE private.intertent_duel_roles SET spirit_user_id=p_witness WHERE fixture_id=f.id;
END $$;
REVOKE ALL ON FUNCTION public.choose_intertent_spirit(uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.choose_intertent_spirit(uuid,uuid) TO authenticated;

CREATE FUNCTION public.request_intertent_spirit_help(p_room_id uuid,p_question_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE f private.intertent_fixtures%ROWTYPE; d private.intertent_duel_roles%ROWTYPE; g public.arena_journey_games%ROWTYPE; actor uuid:=auth.uid();
BEGIN
  IF actor IS NULL THEN RAISE EXCEPTION 'Sign in first.'; END IF;
  PERFORM 1 FROM public.arena_rooms WHERE id=p_room_id AND status='playing' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'The match is not live.'; END IF;
  SELECT * INTO STRICT g FROM public.arena_journey_games WHERE room_id=p_room_id FOR UPDATE;
  SELECT * INTO STRICT f FROM private.intertent_fixtures WHERE room_id=p_room_id FOR UPDATE;
  SELECT * INTO STRICT d FROM private.intertent_duel_roles WHERE fixture_id=f.id FOR UPDATE;
  IF f.stage='final' OR f.player_ids[1] IS DISTINCT FROM actor OR d.spirit_user_id IS NULL OR d.assists>=3
    OR NOT private.intertent_spirit_eligible(p_room_id,d.home_tent_id,d.spirit_user_id)
    OR g.current_question_id IS DISTINCT FROM p_question_id OR p_question_id IS NULL
    OR g.state->>'currentQuestionPlayerId' IS DISTINCT FROM actor::text OR coalesce((g.state->>'awaitingRoll')::boolean,false)
    OR coalesce((g.state->>'questionDeadline')::timestamptz,'-infinity')<=now()
    OR coalesce((g.state->>'questionOpensAt')::timestamptz,'-infinity')>now() THEN RAISE EXCEPTION 'Spirit help is unavailable for this question.'; END IF;
  UPDATE private.intertent_duel_roles SET requested_question_id=p_question_id WHERE fixture_id=f.id;
END $$;
REVOKE ALL ON FUNCTION public.request_intertent_spirit_help(uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.request_intertent_spirit_help(uuid,uuid) TO authenticated;

-- Only the authenticated Edge function can submit computed Journey states.
-- The assistant's own inventory is spent in the same transaction as the move.
CREATE FUNCTION public.commit_intertent_spirit_action(p_room_id uuid,p_expected_version integer,p_next_state jsonb,p_command_id uuid,p_spirit_id uuid,p_question_id uuid,p_kind text,p_relic_slug text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE f private.intertent_fixtures%ROWTYPE; d private.intertent_duel_roles%ROWTYPE; g public.arena_journey_games%ROWTYPE; result jsonb; home_id uuid; v_relic uuid; board_relic boolean;
BEGIN
  IF coalesce(auth.role(),'')<>'service_role' THEN RAISE EXCEPTION 'Arena commands are server-only.'; END IF;
  PERFORM 1 FROM public.arena_rooms WHERE id=p_room_id AND status IN ('playing','completed') FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'The match is not live.'; END IF;
  SELECT * INTO STRICT g FROM public.arena_journey_games WHERE room_id=p_room_id FOR UPDATE;
  SELECT * INTO STRICT f FROM private.intertent_fixtures WHERE room_id=p_room_id FOR UPDATE;
  SELECT * INTO STRICT d FROM private.intertent_duel_roles WHERE fixture_id=f.id FOR UPDATE;
  home_id:=f.player_ids[1];
  IF f.stage='final' OR d.spirit_user_id IS DISTINCT FROM p_spirit_id THEN RAISE EXCEPTION 'Spirit assistance is unavailable.'; END IF;
  IF EXISTS(SELECT 1 FROM public.arena_journey_commands WHERE room_id=p_room_id AND command_id=p_command_id AND actor_id=home_id) THEN RETURN jsonb_build_object('duplicate',true,'state',g.state); END IF;
  board_relic:=p_kind='relic' AND p_relic_slug IN('undo','standstill','the-ninety-nine','shield-of-faith','boomerang');
  IF f.result IS NOT NULL OR d.assists>=3 OR g.version<>p_expected_version OR NOT private.intertent_spirit_eligible(p_room_id,d.home_tent_id,p_spirit_id)
     OR coalesce((g.state->'game'->>'matchDeadline')::timestamptz,'infinity')<=now() THEN RAISE EXCEPTION 'Spirit assistance is unavailable.'; END IF;
  IF NOT coalesce(board_relic,false) AND (g.state->>'currentQuestionPlayerId' IS DISTINCT FROM home_id::text OR g.current_question_id IS DISTINCT FROM p_question_id OR p_question_id IS NULL
     OR coalesce((g.state->>'awaitingRoll')::boolean,false) OR coalesce((g.state->>'questionDeadline')::timestamptz,'-infinity')<=now()
     OR coalesce((g.state->>'questionOpensAt')::timestamptz,'-infinity')>now()
     OR coalesce((g.state->>'pausedUntil')::timestamptz,'-infinity')>now() OR nullif(g.state->'game'->'shieldOffer','null'::jsonb) IS NOT NULL) THEN RAISE EXCEPTION 'Spirit assistance is unavailable.'; END IF;
  IF p_kind='answer' THEN
    IF d.requested_question_id IS DISTINCT FROM p_question_id OR p_relic_slug IS NOT NULL THEN RAISE EXCEPTION 'The representative must request help.'; END IF;
  ELSIF p_kind='relic' THEN
    IF board_relic THEN
      SELECT id INTO v_relic FROM public.relic_types WHERE slug=p_relic_slug AND is_active;
      UPDATE public.relic_inventory SET quantity=quantity-1 WHERE user_id=p_spirit_id AND relic_type_id=v_relic AND quantity>0;
      IF NOT FOUND THEN RAISE EXCEPTION 'You do not own this relic.'; END IF;
      INSERT INTO public.relic_usage_log(user_id,relic_type_id,effect_applied) VALUES(p_spirit_id,v_relic,'arena:'||p_room_id::text||':'||p_relic_slug);
    ELSE
      IF p_relic_slug IS NULL OR g.state->'questionAid'->'used' ? p_relic_slug THEN RAISE EXCEPTION 'This relic cannot be used.'; END IF;
      PERFORM journey_private.consume_arena_relic(p_spirit_id,p_room_id,p_relic_slug);
    END IF;
  ELSE RAISE EXCEPTION 'Invalid spirit action.'; END IF;
  result:=public.commit_arena_journey_turn(p_room_id,p_expected_version,p_next_state,p_command_id,home_id,NULL);
  IF NOT coalesce((result->>'duplicate')::boolean,false) THEN
    UPDATE private.intertent_duel_roles SET assists=assists+1,requested_question_id=CASE WHEN p_kind='answer' THEN NULL ELSE requested_question_id END WHERE fixture_id=f.id;
  ELSE RAISE EXCEPTION 'Duplicate command'; END IF;
  RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.commit_intertent_spirit_action(uuid,integer,jsonb,uuid,uuid,uuid,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.commit_intertent_spirit_action(uuid,integer,jsonb,uuid,uuid,uuid,text,text) TO service_role;

-- Service-side substitution commits a server-computed seat transfer with the roster.
CREATE FUNCTION public.commit_intertent_duel_substitution(p_room_id uuid,p_sentry_id uuid,p_replacement_id uuid,p_expected_version integer,p_next_state jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE f private.intertent_fixtures%ROWTYPE; d private.intertent_duel_roles%ROWTYPE; g public.arena_journey_games%ROWTYPE; r public.arena_rooms%ROWTYPE; seat integer; old_id uuid; v_tent_id uuid; game_exists boolean; new_ids uuid[];
BEGIN
  IF coalesce(auth.role(),'')<>'service_role' THEN RAISE EXCEPTION 'Arena commands are server-only.'; END IF;
  SELECT * INTO STRICT r FROM public.arena_rooms WHERE id=p_room_id AND status IN ('waiting','playing') FOR UPDATE;
  SELECT * INTO g FROM public.arena_journey_games WHERE room_id=p_room_id FOR UPDATE;
  game_exists:=FOUND;
  SELECT * INTO STRICT f FROM private.intertent_fixtures WHERE room_id=p_room_id AND result IS NULL FOR UPDATE;
  SELECT * INTO STRICT d FROM private.intertent_duel_roles WHERE fixture_id=f.id FOR UPDATE;
  IF cardinality(f.player_ids)<>2 THEN RAISE EXCEPTION 'Not a 1v1 duel.'; END IF;
  SELECT CASE WHEN t.id=d.home_tent_id THEN 1 ELSE 2 END,t.id INTO seat,v_tent_id FROM public.tents t WHERE t.id IN(d.home_tent_id,d.away_tent_id) AND t.sentry_id=p_sentry_id
    AND EXISTS(SELECT 1 FROM public.role_assignments a WHERE a.user_id=p_sentry_id AND a.role='sentry' AND a.status IN('active','approved'));
  IF seat IS NULL OR (seat=1 AND d.home_substitutions>=1) OR (seat=2 AND d.away_substitutions>=1) THEN RAISE EXCEPTION 'No sentry substitution available.'; END IF;
  old_id:=f.player_ids[seat];
  IF p_replacement_id IS NULL OR p_replacement_id=ANY(f.player_ids) OR p_replacement_id=d.spirit_user_id OR p_replacement_id=p_sentry_id
    OR NOT private.intertent_duel_rep_allowed(p_replacement_id,v_tent_id,CASE WHEN seat=1 THEN d.home_roster ELSE d.away_roster END,d.excluded_player_ids,CASE WHEN seat=1 THEN d.home_allow_unqualified ELSE d.away_allow_unqualified END) THEN RAISE EXCEPTION 'Choose an eligible representative from your tent.'; END IF;
  IF EXISTS(SELECT 1 FROM public.arena_participants a WHERE a.room_id=p_room_id AND (a.user_id=p_replacement_id OR (a.user_id=old_id AND a.forfeited_at IS NOT NULL))) THEN RAISE EXCEPTION 'This seat cannot be transferred.'; END IF;
  IF game_exists THEN
    IF g.version IS DISTINCT FROM p_expected_version OR p_next_state IS NULL OR (p_next_state->'game'->>'version')::integer<>g.version+1 THEN RAISE EXCEPTION 'The board advanced. Try again.'; END IF;
    IF EXISTS(SELECT 1 FROM jsonb_array_elements(g.state->'game'->'players') p WHERE p->>'id'=old_id::text) THEN
      IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p_next_state->'game'->'players') p WHERE p->>'id'=p_replacement_id::text) THEN RAISE EXCEPTION 'The seat was not transferred.'; END IF;
    ELSIF p_next_state->'game'->'players' IS DISTINCT FROM g.state->'game'->'players' THEN RAISE EXCEPTION 'An absent player cannot change the board.'; END IF;
  ELSIF p_next_state IS NOT NULL OR p_expected_version IS NOT NULL THEN RAISE EXCEPTION 'The board advanced. Try again.'; END IF;
  new_ids:=array_replace(f.player_ids,old_id,p_replacement_id);
  UPDATE private.intertent_fixtures SET player_ids=new_ids,sides=(sides-old_id::text)||jsonb_build_object(p_replacement_id::text,v_tent_id::text) WHERE id=f.id;
  UPDATE public.arena_scheduled_matches SET player_ids=new_ids WHERE room_id=p_room_id;
  UPDATE public.arena_rooms SET tagged_user_ids=new_ids,creator_id=CASE WHEN creator_id=old_id THEN p_replacement_id ELSE creator_id END WHERE id=p_room_id;
  UPDATE public.arena_participants SET user_id=p_replacement_id,journey_seen_version=NULL,last_active_at=now() WHERE room_id=p_room_id AND user_id=old_id;
  DELETE FROM public.arena_viewers WHERE room_id=p_room_id AND user_id=p_replacement_id;
  IF game_exists THEN UPDATE public.arena_journey_games SET state=p_next_state,version=g.version+1,turn_number=g.version+1,updated_at=now() WHERE room_id=p_room_id; END IF;
  UPDATE private.intertent_duel_roles SET home_substitutions=home_substitutions+CASE WHEN seat=1 THEN 1 ELSE 0 END,away_substitutions=away_substitutions+CASE WHEN seat=2 THEN 1 ELSE 0 END,requested_question_id=CASE WHEN seat=1 THEN NULL ELSE requested_question_id END WHERE fixture_id=f.id;
  PERFORM public.notify_user(p_replacement_id,p_sentry_id,'arena','You are the new tent representative','Enter the duel to take over the existing score and position.','arena',jsonb_build_object('room_id',p_room_id));
  PERFORM public.notify_user(old_id,p_sentry_id,'arena','Tent representative substituted','Your sentry has assigned a replacement for this duel.','arena',jsonb_build_object('room_id',p_room_id));
END $$;
REVOKE ALL ON FUNCTION public.commit_intertent_duel_substitution(uuid,uuid,uuid,integer,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.commit_intertent_duel_substitution(uuid,uuid,uuid,integer,jsonb) TO service_role;
COMMIT;
