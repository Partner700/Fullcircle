-- Staged: do not activate a live championship until the client and tournament cutover are verified.

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
     'substitutes',CASE WHEN sentry_seat IS NOT NULL THEN (SELECT coalesce(jsonb_agg(jsonb_build_object('id',p.id,'name',p.display_name) ORDER BY p.display_name),'[]') FROM public.profiles p JOIN public.tent_members m ON m.user_id=p.id AND m.tent_id=sentry_tent AND m.role='cadet' WHERE p.id<>actor AND NOT(p.id=ANY(f.player_ids)) AND NOT(p.id=ANY(d.excluded_player_ids)) AND p.id IS DISTINCT FROM d.spirit_user_id AND (CASE WHEN sentry_seat=1 THEN d.home_allow_unqualified ELSE d.away_allow_unqualified END OR private.intertent_qualified(p.id)) AND NOT EXISTS(SELECT 1 FROM public.role_assignments a WHERE a.user_id=p.id AND a.role IN('sentry','instructor','admin') AND a.status IN('active','approved'))) ELSE '[]'::jsonb END,
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
  IF p_replacement_id IS NULL OR p_replacement_id=ANY(f.player_ids) OR p_replacement_id=ANY(d.excluded_player_ids) OR p_replacement_id=d.spirit_user_id OR p_replacement_id=p_sentry_id
    OR NOT (CASE WHEN seat=1 THEN d.home_allow_unqualified ELSE d.away_allow_unqualified END OR private.intertent_qualified(p_replacement_id))
    OR NOT EXISTS(SELECT 1 FROM public.tent_members m WHERE m.tent_id=v_tent_id AND m.user_id=p_replacement_id AND m.role='cadet')
    OR EXISTS(SELECT 1 FROM public.role_assignments a WHERE a.user_id=p_replacement_id AND a.role IN('sentry','instructor','admin') AND a.status IN('active','approved')) THEN RAISE EXCEPTION 'Choose a resident from your tent.'; END IF;
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

-- Staged tournament progression for 1v1 competitions. Install after the Spirit transaction layer.

CREATE TABLE private.intertent_duel_competitions (
  championship_id uuid PRIMARY KEY REFERENCES private.intertent_championships(id),
  source_championship_id uuid REFERENCES private.intertent_championships(id),
  excluded_player_ids uuid[] NOT NULL DEFAULT '{}',
  unqualified_tent_ids uuid[] NOT NULL DEFAULT '{}',
  finalist_tent_id uuid REFERENCES public.tents(id),
  champion_tent_id uuid REFERENCES public.tents(id)
);
ALTER TABLE private.intertent_duel_competitions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.intertent_duel_competitions FROM PUBLIC,anon,authenticated;

CREATE FUNCTION private.intertent_duel_pick(p_championship uuid,p_tent uuid,p_offset integer DEFAULT 0)
RETURNS uuid LANGUAGE sql STABLE SET search_path='' AS $$
  WITH eligible AS (
    SELECT m.user_id,row_number() OVER(ORDER BY coalesce((SELECT sum(r.points) FROM private.intertent_results r JOIN private.intertent_fixtures f ON f.id=r.fixture_id WHERE f.championship_id=p_championship AND r.user_id=m.user_id),0) DESC,m.joined_at,m.user_id)-1 AS n,
      count(*) OVER() AS total
    FROM public.tent_members m JOIN public.tents t ON t.id=m.tent_id
    WHERE m.tent_id=p_tent AND m.role='cadet' AND m.user_id IS DISTINCT FROM t.sentry_id
      AND NOT EXISTS(SELECT 1 FROM private.intertent_duel_competitions dc WHERE dc.championship_id=p_championship AND m.user_id=ANY(dc.excluded_player_ids))
      AND (private.intertent_qualified(m.user_id) OR EXISTS(SELECT 1 FROM private.intertent_duel_competitions dc WHERE dc.championship_id=p_championship AND p_tent=ANY(dc.unqualified_tent_ids)))
      AND NOT EXISTS(SELECT 1 FROM public.role_assignments a WHERE a.user_id=m.user_id AND a.role IN('sentry','instructor','admin') AND a.status IN('active','approved'))
  ) SELECT user_id FROM eligible WHERE n=mod(greatest(p_offset,0)::bigint,total) LIMIT 1;
$$;
REVOKE ALL ON FUNCTION private.intertent_duel_pick(uuid,uuid,integer) FROM PUBLIC,anon,authenticated;

CREATE FUNCTION private.intertent_duel_seed(p_fixture uuid,p_home uuid,p_away uuid,p_home_offset integer DEFAULT 0,p_away_offset integer DEFAULT 0)
RETURNS void LANGUAGE plpgsql SET search_path='' AS $$
DECLARE f private.intertent_fixtures%ROWTYPE; d private.intertent_duel_competitions%ROWTYPE; h uuid; a uuid;
BEGIN
  SELECT * INTO STRICT f FROM private.intertent_fixtures WHERE id=p_fixture AND room_id IS NULL AND result IS NULL FOR UPDATE;
  SELECT * INTO STRICT d FROM private.intertent_duel_competitions WHERE championship_id=f.championship_id;
  h:=private.intertent_duel_pick(f.championship_id,p_home,p_home_offset);
  a:=private.intertent_duel_pick(f.championship_id,p_away,p_away_offset);
  IF h IS NULL OR a IS NULL OR h=a OR p_home=p_away THEN RAISE EXCEPTION 'No eligible duel representatives.'; END IF;
  UPDATE private.intertent_fixtures SET player_ids=ARRAY[h,a],sides=jsonb_build_object(h::text,p_home::text,a::text,p_away::text) WHERE id=p_fixture;
  INSERT INTO private.intertent_duel_roles(fixture_id,home_tent_id,away_tent_id,excluded_player_ids,home_allow_unqualified,away_allow_unqualified) VALUES(p_fixture,p_home,p_away,d.excluded_player_ids,p_home=ANY(d.unqualified_tent_ids),p_away=ANY(d.unqualified_tent_ids));
END $$;
REVOKE ALL ON FUNCTION private.intertent_duel_seed(uuid,uuid,uuid,integer,integer) FROM PUBLIC,anon,authenticated;

CREATE FUNCTION private.intertent_duel_advance(p_championship uuid,p_fixture uuid,p_winner uuid)
RETURNS void LANGUAGE plpgsql SET search_path='' AS $$
DECLARE f private.intertent_fixtures%ROWTYPE; d private.intertent_duel_competitions%ROWTYPE; ranking uuid[]; next_f record; opponent uuid;
BEGIN
  SELECT * INTO STRICT f FROM private.intertent_fixtures WHERE id=p_fixture;
  SELECT * INTO STRICT d FROM private.intertent_duel_competitions WHERE championship_id=p_championship FOR UPDATE;
  IF f.stage='final' THEN
    UPDATE private.intertent_duel_competitions SET champion_tent_id=(f.sides->>p_winner::text)::uuid WHERE championship_id=p_championship;
    UPDATE private.intertent_championships SET status='completed',champion_id=p_winner WHERE id=p_championship;
    RETURN;
  END IF;
  IF EXISTS(SELECT 1 FROM private.intertent_fixtures WHERE championship_id=p_championship AND stage=f.stage AND result IS NULL) THEN RETURN; END IF;
  SELECT array_agg(tent_id ORDER BY points DESC,score DESC,answers DESC,tent_id) INTO ranking FROM (
    SELECT r.tent_id,sum(r.points) points,sum(r.score) score,sum(r.answers) answers FROM private.intertent_results r JOIN private.intertent_fixtures x ON x.id=r.fixture_id WHERE x.championship_id=p_championship AND x.stage=f.stage GROUP BY r.tent_id
  ) ranked;
  IF f.stage='group' THEN
    IF cardinality(ranking)<>3 THEN RAISE EXCEPTION 'Three tent standings required.'; END IF;
    UPDATE private.intertent_duel_competitions SET finalist_tent_id=ranking[1] WHERE championship_id=p_championship;
    FOR next_f IN SELECT id,leg FROM private.intertent_fixtures WHERE championship_id=p_championship AND stage='semi' AND room_id IS NULL ORDER BY leg LOOP
      PERFORM private.intertent_duel_seed(next_f.id,CASE WHEN next_f.leg=1 THEN ranking[2] ELSE ranking[3] END,CASE WHEN next_f.leg=1 THEN ranking[3] ELSE ranking[2] END);
      IF EXISTS(SELECT 1 FROM private.intertent_fixtures WHERE id=next_f.id AND planned_at>now()) THEN
        BEGIN PERFORM private.intertent_create_room(next_f.id); EXCEPTION WHEN OTHERS THEN RAISE WARNING 'Duel fixture % needs scheduling: %',next_f.id,SQLERRM; END;
      END IF;
    END LOOP;
  ELSE
    IF cardinality(ranking)<>2 OR d.finalist_tent_id IS NULL THEN RAISE EXCEPTION 'Semifinal standings incomplete.'; END IF;
    FOR next_f IN SELECT id FROM private.intertent_fixtures WHERE championship_id=p_championship AND stage='final' AND room_id IS NULL LOOP
      PERFORM private.intertent_duel_seed(next_f.id,d.finalist_tent_id,ranking[1]);
      IF EXISTS(SELECT 1 FROM private.intertent_fixtures WHERE id=next_f.id AND planned_at>now()) THEN
        BEGIN PERFORM private.intertent_create_room(next_f.id); EXCEPTION WHEN OTHERS THEN RAISE WARNING 'Duel final % needs scheduling: %',next_f.id,SQLERRM; END;
      END IF;
    END LOOP;
  END IF;
END $$;
REVOKE ALL ON FUNCTION private.intertent_duel_advance(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION private.intertent_create_room(p_fixture uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE f private.intertent_fixtures%ROWTYPE; c private.intertent_championships%ROWTYPE; rid uuid;
  label text; starts timestamptz; player uuid;
BEGIN
  SELECT * INTO STRICT f FROM private.intertent_fixtures WHERE id=p_fixture FOR UPDATE;
  IF f.room_id IS NOT NULL THEN RETURN f.room_id; END IF;
  SELECT * INTO STRICT c FROM private.intertent_championships WHERE id=f.championship_id;
  IF c.status NOT IN ('scheduled','playing') OR cardinality(f.player_ids)<>(CASE WHEN EXISTS(SELECT 1 FROM private.intertent_duel_roles d WHERE d.fixture_id=f.id) THEN 2 ELSE CASE f.stage WHEN 'group' THEN 4 WHEN 'semi' THEN 3 ELSE 2 END END) THEN RAISE EXCEPTION 'The championship fixture is not ready.'; END IF;
  -- Never schedule an already elapsed fixture automatically.
  IF f.planned_at<=now() THEN RAISE EXCEPTION 'This fixture needs rescheduling.'; END IF;
  starts:=f.planned_at;
  label:=CASE f.stage WHEN 'group' THEN 'Group '||f.group_key||' Series '||ceil(f.leg/2.0)::integer::text||' '||CASE WHEN f.leg%2=1 THEN 'Home' ELSE 'Away' END WHEN 'semi' THEN 'Semifinal '||CASE WHEN f.leg=1 THEN 'Home' ELSE 'Away' END ELSE 'Grand final' END;
  IF EXISTS(SELECT 1 FROM private.intertent_duel_roles d WHERE d.fixture_id=f.id) THEN
    label:=CASE f.stage WHEN 'group' THEN 'Duel '||f.sequence::text WHEN 'semi' THEN 'Semifinal · Leg '||f.leg::text ELSE 'Grand final' END;
  END IF;
  INSERT INTO public.arena_rooms(creator_id,room_name,stake_amount,max_players,status,tagged_user_ids,game_call_fee,expires_at)
  VALUES(f.player_ids[1],(CASE WHEN f.sequence>=18 THEN 'Mystery Inter-Tent · ' ELSE 'Journey Inter-Tent · ' END)||label||' [arena:journey]'||(CASE WHEN f.sequence>=18 THEN '' ELSE ' [character:'||coalesce(f.journey_character_slug,'david')||']' END)||' [intertent]'||CASE WHEN EXISTS(SELECT 1 FROM private.intertent_duel_roles d WHERE d.fixture_id=f.id) THEN ' [intertent-duel]' ELSE '' END,0,cardinality(f.player_ids),'waiting',f.player_ids,0,starts+interval '3 hours') RETURNING id INTO rid;
  INSERT INTO public.arena_scheduled_matches(room_id,scheduled_by,starts_at,player_ids,is_intertent_match)
  VALUES(rid,c.created_by,starts,f.player_ids,true);
  UPDATE private.intertent_fixtures SET room_id=rid WHERE id=p_fixture;
  FOREACH player IN ARRAY f.player_ids LOOP
    PERFORM public.notify_user(player,c.created_by,'arena','Inter-Tent Championship match scheduled',label||' · '||(CASE WHEN f.sequence>=18 THEN 'Mystery' ELSE coalesce((SELECT display_name FROM public.arena_journey_characters WHERE slug=f.journey_character_slug),'Journey') END)||' Journey Trivia','arena',jsonb_build_object('room_id',rid,'starts_at',starts));
  END LOOP;
  RETURN rid;
END; $function$
;

CREATE OR REPLACE FUNCTION private.intertent_settle_match()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE f private.intertent_fixtures%ROWTYPE; c private.intertent_championships%ROWTYPE; next_f record; ids uuid[]; v_sides jsonb; winning_tent text;
BEGIN
  IF NEW.status<>'completed' OR OLD.status='completed' OR NEW.winner_id IS NULL THEN RETURN NEW; END IF;
  SELECT * INTO f FROM private.intertent_fixtures WHERE room_id=NEW.id FOR UPDATE;
  IF NOT FOUND OR f.result IS NOT NULL OR NOT(NEW.winner_id=ANY(f.player_ids)) THEN RETURN NEW; END IF;
  SELECT * INTO STRICT c FROM private.intertent_championships WHERE id=f.championship_id FOR UPDATE;
  winning_tent:=f.sides->>NEW.winner_id::text;
  WITH individual AS (
    SELECT p.id AS user_id,(f.sides->>p.id::text)::uuid AS tent_id,coalesce(a.score,0)::numeric AS score,coalesce(a.correct_count,0)::numeric AS answers
    FROM unnest(f.player_ids) p(id) LEFT JOIN public.arena_participants a ON a.room_id=NEW.id AND a.user_id=p.id
  ), side_rank AS (
    SELECT tent_id,row_number() OVER (ORDER BY (tent_id::text=winning_tent) DESC,avg(score) DESC,avg(answers) DESC,tent_id) AS place
    FROM individual GROUP BY tent_id
  )
  INSERT INTO private.intertent_results(fixture_id,user_id,tent_id,points,score,answers)
  SELECT f.id,i.user_id,i.tent_id,CASE r.place WHEN 1 THEN 3 WHEN 2 THEN 1 ELSE 0 END,i.score,i.answers FROM individual i JOIN side_rank r USING(tent_id);
  UPDATE private.intertent_fixtures SET result=(SELECT jsonb_agg(jsonb_build_object('tent_id',tent_id,'points',points,'score',score,'answers',answers) ORDER BY points DESC,tent_id) FROM (SELECT tent_id,max(points) points,round(avg(score),2) score,round(avg(answers),2) answers FROM private.intertent_results WHERE fixture_id=f.id GROUP BY tent_id) r) WHERE id=f.id;
  IF EXISTS(SELECT 1 FROM private.intertent_duel_competitions d WHERE d.championship_id=c.id) THEN
    BEGIN PERFORM private.intertent_duel_advance(c.id,f.id,NEW.winner_id); EXCEPTION WHEN OTHERS THEN RAISE WARNING 'Duel progression needs review: %',SQLERRM; END;
    RETURN NEW;
  END IF;
  IF f.stage='final' THEN
    UPDATE private.intertent_championships SET status='completed',champion_id=NEW.winner_id WHERE id=c.id;
  ELSIF NOT EXISTS (SELECT 1 FROM private.intertent_fixtures WHERE championship_id=c.id AND stage=f.stage AND result IS NULL) THEN
    IF f.stage='group' THEN
      SELECT array_agg(user_id ORDER BY tent_id),jsonb_object_agg(user_id::text,tent_id::text) INTO ids,v_sides FROM (
        SELECT *,row_number() OVER(PARTITION BY tent_id ORDER BY average DESC,answers DESC,score DESC,user_id) AS tent_rank FROM private.intertent_rank(c.id,'group')
      ) ranked WHERE tent_rank=1;
      UPDATE private.intertent_fixtures SET player_ids=ids,sides=v_sides WHERE championship_id=c.id AND stage='semi' AND room_id IS NULL;
    ELSE
      SELECT array_agg(user_id ORDER BY points DESC,answers DESC,score DESC,user_id),jsonb_object_agg(user_id::text,tent_id::text) INTO ids,v_sides FROM (
        SELECT * FROM private.intertent_rank(c.id,'semi') ORDER BY points DESC,answers DESC,score DESC,user_id LIMIT 2
      ) ranked;
      UPDATE private.intertent_fixtures SET player_ids=ids,sides=v_sides WHERE championship_id=c.id AND stage='final' AND room_id IS NULL;
    END IF;
    -- A completed game must never be rolled back because a future date has passed.
    FOR next_f IN SELECT id FROM private.intertent_fixtures WHERE championship_id=c.id AND stage=CASE f.stage WHEN 'group' THEN 'semi' ELSE 'final' END AND room_id IS NULL AND planned_at>now() ORDER BY sequence LOOP
      BEGIN
        PERFORM private.intertent_create_room(next_f.id);
      EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'Inter-tent fixture % needs scheduling: %',next_f.id,SQLERRM;
      END;
    END LOOP;
  END IF;
  RETURN NEW;
END; $function$
;

CREATE OR REPLACE FUNCTION public.get_intertent_championships()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE actor uuid:=auth.uid(); camp bigint; manager boolean;
BEGIN
  IF actor IS NULL THEN RAISE EXCEPTION 'Sign in to view the championship.'; END IF;
  camp:=private.scripture_question_camp(actor); manager:=public.is_instructor(actor);
  RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('id',c.id,'title',c.title,'status',c.status,'opening_at',c.opening_at,'can_manage',manager,'duel',EXISTS(SELECT 1 FROM private.intertent_duel_competitions d WHERE d.championship_id=c.id),
    'champion',coalesce((SELECT t.name FROM private.intertent_duel_competitions d JOIN public.tents t ON t.id=d.champion_tent_id WHERE d.championship_id=c.id),(SELECT display_name FROM public.profiles WHERE id=c.champion_id)),
    'finalist_tent_name',(SELECT t.name FROM private.intertent_duel_competitions d JOIN public.tents t ON t.id=d.finalist_tent_id WHERE d.championship_id=c.id),
    'eligibility',CASE WHEN manager AND c.status='draft' THEN (SELECT coalesce(jsonb_agg(jsonb_build_object('user_id',p.id,'name',p.display_name,'qualified',private.intertent_qualified(p.id)) ORDER BY p.display_name),'[]') FROM public.profiles p WHERE p.id IN (SELECT DISTINCT u FROM private.intertent_fixtures f CROSS JOIN LATERAL unnest(f.player_ids) u WHERE f.championship_id=c.id)) ELSE '[]'::jsonb END,
    'standings',(SELECT coalesce(jsonb_agg(jsonb_build_object('user_id',r.user_id,'name',p.display_name,'tent_id',r.tent_id,'tent_name',t.name,'matches',r.matches,'points',r.points,'average',round(r.average,3)) ORDER BY r.average DESC,r.answers DESC,r.score DESC,r.user_id),'[]') FROM private.intertent_rank(c.id,'group') r JOIN public.profiles p ON p.id=r.user_id JOIN public.tents t ON t.id=r.tent_id),
    'semifinal_standings',(SELECT coalesce(jsonb_agg(jsonb_build_object('user_id',r.user_id,'name',p.display_name,'tent_id',r.tent_id,'tent_name',t.name,'matches',r.matches,'points',r.points) ORDER BY r.points DESC,r.answers DESC,r.score DESC,r.user_id),'[]') FROM private.intertent_rank(c.id,'semi') r JOIN public.profiles p ON p.id=r.user_id JOIN public.tents t ON t.id=r.tent_id),
    'fixtures',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',f.id,'sequence',f.sequence,'stage',f.stage,'group_key',f.group_key,'leg',f.leg,'planned_at',f.planned_at,'room_id',f.room_id,'room_status',room.status,'journey_character_slug',CASE WHEN f.sequence>=18 AND room.status IS DISTINCT FROM 'playing' AND f.result IS NULL THEN NULL ELSE f.journey_character_slug END,'journey_secret',f.sequence>=18 AND room.status IS DISTINCT FROM 'playing' AND f.result IS NULL,'result',f.result,'home_tent_id',(SELECT d.home_tent_id FROM private.intertent_duel_roles d WHERE d.fixture_id=f.id),'away_tent_id',(SELECT d.away_tent_id FROM private.intertent_duel_roles d WHERE d.fixture_id=f.id),
      'sides',(SELECT coalesce(jsonb_agg(jsonb_build_object('tent_id',s.tent_id,'tent_name',s.tent_name,'players',s.players) ORDER BY s.first_slot),'[]') FROM (SELECT t.id tent_id,t.name tent_name,min(u.slot) first_slot,jsonb_agg(jsonb_build_object('id',p.id,'name',p.display_name,'player_number',p.player_number) ORDER BY u.slot) players FROM unnest(f.player_ids) WITH ORDINALITY u(uid,slot) JOIN public.profiles p ON p.id=u.uid JOIN public.tents t ON t.id=(f.sides->>u.uid::text)::uuid GROUP BY t.id,t.name) s)) ORDER BY f.sequence),'[]') FROM private.intertent_fixtures f LEFT JOIN public.arena_rooms room ON room.id=f.room_id WHERE f.championship_id=c.id AND (c.title NOT LIKE '%(archived)%' OR f.result IS NOT NULL))
  ) ORDER BY c.created_at DESC) FROM (SELECT * FROM private.intertent_championships WHERE camp_id=camp ORDER BY created_at DESC LIMIT 4) c),'[]');
END; $function$
;
