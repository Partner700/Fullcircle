ALTER TABLE private.intertent_duel_roles ADD COLUMN home_roster uuid[] NOT NULL DEFAULT '{}', ADD COLUMN away_roster uuid[] NOT NULL DEFAULT '{}';
ALTER TABLE private.intertent_duel_competitions ADD COLUMN representative_rosters jsonb NOT NULL DEFAULT '{}';
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

CREATE OR REPLACE FUNCTION public.get_intertent_duel_roles(p_room_id uuid)
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

CREATE OR REPLACE FUNCTION public.commit_intertent_duel_substitution(p_room_id uuid,p_sentry_id uuid,p_replacement_id uuid,p_expected_version integer,p_next_state jsonb)
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

CREATE OR REPLACE FUNCTION private.intertent_duel_pick(p_championship uuid,p_tent uuid,p_offset integer DEFAULT 0)
RETURNS uuid LANGUAGE sql STABLE SET search_path='' AS $$
  WITH competition AS (SELECT coalesce((SELECT array_agg(value::uuid) FROM jsonb_array_elements_text(dc.representative_rosters->p_tent::text)),ARRAY[]::uuid[]) roster,dc.excluded_player_ids,p_tent=ANY(dc.unqualified_tent_ids) allow_unqualified FROM private.intertent_duel_competitions dc WHERE dc.championship_id=p_championship), candidates AS (
    SELECT m.user_id,m.joined_at FROM public.tent_members m WHERE m.tent_id=p_tent AND m.role='cadet'
    UNION SELECT p.id, '-infinity'::timestamptz FROM public.profiles p CROSS JOIN competition c WHERE p.id=ANY(c.roster) AND NOT EXISTS(SELECT 1 FROM public.tent_members m WHERE m.user_id=p.id AND m.tent_id=p_tent AND m.role='cadet')
  ), eligible AS (
    SELECT m.user_id,row_number() OVER(ORDER BY coalesce((SELECT sum(r.points) FROM private.intertent_results r JOIN private.intertent_fixtures f ON f.id=r.fixture_id WHERE f.championship_id=p_championship AND r.user_id=m.user_id),0) DESC,m.joined_at,m.user_id)-1 AS n,
      count(*) OVER() AS total
    FROM candidates m CROSS JOIN competition c
    WHERE private.intertent_duel_rep_allowed(m.user_id,p_tent,c.roster,c.excluded_player_ids,c.allow_unqualified)
  ) SELECT user_id FROM eligible WHERE n=mod(greatest(p_offset,0)::bigint,total) LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION private.intertent_duel_seed(p_fixture uuid,p_home uuid,p_away uuid,p_home_offset integer DEFAULT 0,p_away_offset integer DEFAULT 0)
RETURNS void LANGUAGE plpgsql SET search_path='' AS $$
DECLARE f private.intertent_fixtures%ROWTYPE; d private.intertent_duel_competitions%ROWTYPE; h uuid; a uuid;
BEGIN
  SELECT * INTO STRICT f FROM private.intertent_fixtures WHERE id=p_fixture AND room_id IS NULL AND result IS NULL FOR UPDATE;
  SELECT * INTO STRICT d FROM private.intertent_duel_competitions WHERE championship_id=f.championship_id;
  h:=private.intertent_duel_pick(f.championship_id,p_home,p_home_offset);
  a:=private.intertent_duel_pick(f.championship_id,p_away,p_away_offset);
  IF h IS NULL OR a IS NULL OR h=a OR p_home=p_away THEN RAISE EXCEPTION 'No eligible duel representatives.'; END IF;
  UPDATE private.intertent_fixtures SET player_ids=ARRAY[h,a],sides=jsonb_build_object(h::text,p_home::text,a::text,p_away::text) WHERE id=p_fixture;
  INSERT INTO private.intertent_duel_roles(fixture_id,home_tent_id,away_tent_id,excluded_player_ids,home_allow_unqualified,away_allow_unqualified,home_roster,away_roster) VALUES(p_fixture,p_home,p_away,d.excluded_player_ids,p_home=ANY(d.unqualified_tent_ids),p_away=ANY(d.unqualified_tent_ids),coalesce((SELECT array_agg(value::uuid) FROM jsonb_array_elements_text(d.representative_rosters->p_home::text)),ARRAY[]::uuid[]),coalesce((SELECT array_agg(value::uuid) FROM jsonb_array_elements_text(d.representative_rosters->p_away::text)),ARRAY[]::uuid[]));
END $$;
REVOKE ALL ON FUNCTION private.intertent_duel_rep_allowed(uuid,uuid,uuid[],uuid[],boolean) FROM PUBLIC,anon,authenticated;
