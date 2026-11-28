-- Staged tournament progression for 1v1 competitions. Install after the Spirit transaction layer.
BEGIN;

CREATE TABLE private.intertent_duel_competitions (
  championship_id uuid PRIMARY KEY REFERENCES private.intertent_championships(id),
  source_championship_id uuid REFERENCES private.intertent_championships(id),
  excluded_player_ids uuid[] NOT NULL DEFAULT '{}',
  unqualified_tent_ids uuid[] NOT NULL DEFAULT '{}',
  representative_rosters jsonb NOT NULL DEFAULT '{}',
  finalist_tent_id uuid REFERENCES public.tents(id),
  champion_tent_id uuid REFERENCES public.tents(id)
);
ALTER TABLE private.intertent_duel_competitions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.intertent_duel_competitions FROM PUBLIC,anon,authenticated;

CREATE FUNCTION private.intertent_duel_pick(p_championship uuid,p_tent uuid,p_offset integer DEFAULT 0)
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
  INSERT INTO private.intertent_duel_roles(fixture_id,home_tent_id,away_tent_id,excluded_player_ids,home_allow_unqualified,away_allow_unqualified,home_roster,away_roster) VALUES(p_fixture,p_home,p_away,d.excluded_player_ids,p_home=ANY(d.unqualified_tent_ids),p_away=ANY(d.unqualified_tent_ids),coalesce((SELECT array_agg(value::uuid) FROM jsonb_array_elements_text(d.representative_rosters->p_home::text)),ARRAY[]::uuid[]),coalesce((SELECT array_agg(value::uuid) FROM jsonb_array_elements_text(d.representative_rosters->p_away::text)),ARRAY[]::uuid[]));
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
COMMIT;

