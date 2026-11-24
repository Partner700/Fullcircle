-- Separate tournament mode. Install and integration-test on a staging database first.
-- The existing Arena tournament tables and their bracket functions are unchanged.
BEGIN;

-- Scheduled Arena ordinarily creates an automatic two/three-round series.
-- These fixtures are already explicit home/away legs: do not create extra rounds.
ALTER TABLE public.arena_scheduled_matches ADD COLUMN is_intertent_match boolean NOT NULL DEFAULT false;
CREATE OR REPLACE TRIGGER register_scheduled_arena_series_after_insert
AFTER INSERT ON public.arena_scheduled_matches FOR EACH ROW
WHEN (NOT NEW.is_sentry_match AND NOT NEW.is_intertent_match)
EXECUTE FUNCTION public.register_scheduled_arena_series();

CREATE TABLE private.intertent_championships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  camp_id bigint NOT NULL,
  created_by uuid NOT NULL REFERENCES public.profiles(id),
  opening_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','scheduled','playing','completed')),
  champion_id uuid REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX intertent_one_open_camp ON private.intertent_championships(camp_id) WHERE status <> 'completed';
CREATE TABLE private.intertent_fixtures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  championship_id uuid NOT NULL REFERENCES private.intertent_championships(id),
  sequence integer NOT NULL,
  stage text NOT NULL CHECK (stage IN ('group','semi','final')),
  group_key text CHECK (group_key IN ('A','B','C','D')),
  leg integer NOT NULL CHECK (leg BETWEEN 1 AND 4),
  planned_at timestamptz NOT NULL,
  player_ids uuid[] NOT NULL DEFAULT '{}',
  sides jsonb NOT NULL DEFAULT '{}',
  room_id uuid UNIQUE REFERENCES public.arena_rooms(id),
  result jsonb,
  UNIQUE (championship_id,sequence), UNIQUE(championship_id,planned_at)
);
CREATE TABLE private.intertent_results (
  fixture_id uuid NOT NULL REFERENCES private.intertent_fixtures(id),
  user_id uuid NOT NULL REFERENCES public.profiles(id),
  tent_id uuid NOT NULL REFERENCES public.tents(id),
  points integer NOT NULL CHECK (points IN (0,1,3)),
  score numeric NOT NULL,
  answers numeric NOT NULL,
  PRIMARY KEY (fixture_id,user_id)
);
ALTER TABLE private.intertent_championships ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.intertent_fixtures ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.intertent_results ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.intertent_championships,private.intertent_fixtures,private.intertent_results FROM PUBLIC,anon,authenticated;

-- The authoritative active cadet tent, scoped to the instructor's camp.
CREATE FUNCTION private.intertent_cadet_tent(p_player uuid,p_camp bigint) RETURNS uuid
LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT t.id FROM public.tent_members m JOIN public.tents t ON t.id=m.tent_id
  WHERE m.user_id=p_player AND m.role='cadet' AND t.camp_id=p_camp
  ORDER BY m.joined_at DESC,t.id LIMIT 1;
$$;
CREATE FUNCTION private.intertent_qualified(p_player uuid) RETURNS boolean
LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT coalesce(public.get_user_lifetime_figs(p_player,NULL),0)>=500 AND
    (SELECT count(*) FROM public.arena_rooms r WHERE r.winner_id=p_player AND r.status='completed')>=3;
$$;
CREATE FUNCTION private.intertent_rank(p_championship uuid,p_stage text)
RETURNS TABLE(user_id uuid,tent_id uuid,matches bigint,points bigint,average numeric,answers numeric,score numeric)
LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT r.user_id,r.tent_id,count(*),sum(r.points),avg(r.points),avg(r.answers),avg(r.score)
  FROM private.intertent_results r JOIN private.intertent_fixtures f ON f.id=r.fixture_id
  WHERE f.championship_id=p_championship AND f.stage=p_stage GROUP BY r.user_id,r.tent_id;
$$;

CREATE FUNCTION public.create_intertent_david_championship(p_groups jsonb,p_first_tuesday date,p_existing uuid DEFAULT NULL) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE actor uuid:=auth.uid(); camp bigint; cid uuid; groups text[]:=ARRAY['A','B','C','D'];
  g integer; w integer; ids uuid[]; side_map jsonb; player uuid; tent uuid; n integer; prior_tent text;
  all_sides jsonb:='{}'; day_offset integer; slot_time time; first_at timestamptz;
BEGIN
  IF actor IS NULL OR NOT public.is_instructor(actor) THEN RAISE EXCEPTION 'Only an instructor can create this championship.'; END IF;
  camp:=private.scripture_question_camp(actor);
  IF p_first_tuesday IS NULL OR extract(isodow FROM p_first_tuesday)<>2 THEN RAISE EXCEPTION 'Choose a Tuesday for the first group fixtures.'; END IF;
  first_at:=(p_first_tuesday+time '18:00') AT TIME ZONE 'Africa/Douala';
  IF first_at<=now()+interval '2 minutes' OR first_at>now()+interval '55 days' THEN RAISE EXCEPTION 'Choose a future first match within 55 days.'; END IF;
  IF jsonb_typeof(p_groups) IS DISTINCT FROM 'object' OR (SELECT count(*) FROM jsonb_object_keys(p_groups))<>4 THEN RAISE EXCEPTION 'Choose four groups.'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.arena_journey_characters WHERE slug='david' AND ready) THEN RAISE EXCEPTION 'David is not ready to play.'; END IF;
  IF p_existing IS NULL THEN
    INSERT INTO private.intertent_championships(title,camp_id,created_by,opening_at)
    VALUES('Journey Inter-Tent Championship · David',camp,actor,((p_first_tuesday-2)+time '19:00') AT TIME ZONE 'Africa/Douala') RETURNING id INTO cid;
  ELSE
    SELECT id INTO STRICT cid FROM private.intertent_championships WHERE id=p_existing AND camp_id=camp AND status='draft' FOR UPDATE;
    IF EXISTS(SELECT 1 FROM private.intertent_fixtures WHERE championship_id=cid AND room_id IS NOT NULL) THEN RAISE EXCEPTION 'Activated fixtures cannot be replaced.'; END IF;
    DELETE FROM private.intertent_fixtures WHERE championship_id=cid;
    UPDATE private.intertent_championships SET opening_at=((p_first_tuesday-2)+time '19:00') AT TIME ZONE 'Africa/Douala' WHERE id=cid;
  END IF;
  FOR g IN 1..4 LOOP
    IF jsonb_typeof(p_groups->groups[g]) IS DISTINCT FROM 'array' OR jsonb_array_length(p_groups->groups[g])<>4 THEN RAISE EXCEPTION 'Choose four players in each group.'; END IF;
    SELECT array_agg(value::uuid ORDER BY ord) INTO ids FROM jsonb_array_elements_text(p_groups->groups[g]) WITH ORDINALITY x(value,ord);
    IF (SELECT count(DISTINCT x) FROM unnest(ids) x)<>4 THEN RAISE EXCEPTION 'Every group needs four distinct players.'; END IF;
    side_map:='{}';
    FOREACH player IN ARRAY ids LOOP
      tent:=private.intertent_cadet_tent(player,camp);
      IF tent IS NULL THEN RAISE EXCEPTION 'All entrants must be cadets from this camp.'; END IF;
      prior_tent:=all_sides->>player::text;
      IF prior_tent IS NOT NULL AND prior_tent<>tent::text THEN RAISE EXCEPTION 'A cadet must represent the same tent throughout.'; END IF;
      side_map:=side_map||jsonb_build_object(player::text,tent::text);
      all_sides:=all_sides||jsonb_build_object(player::text,tent::text);
    END LOOP;
    SELECT count(DISTINCT value) INTO n FROM jsonb_each_text(side_map);
    IF n<>3 THEN RAISE EXCEPTION 'Each group must represent exactly three tents.'; END IF;
    FOR w IN 1..4 LOOP
      day_offset:=(w-1)*7+CASE WHEN g>2 THEN 2 ELSE 0 END;
      slot_time:=CASE WHEN g%2=1 THEN time '18:00' ELSE time '18:30' END;
      INSERT INTO private.intertent_fixtures(championship_id,sequence,stage,group_key,leg,planned_at,player_ids,sides)
      VALUES(cid,(w-1)*4+g,'group',groups[g],w,((p_first_tuesday+day_offset)+slot_time) AT TIME ZONE 'Africa/Douala',ids,side_map);
    END LOOP;
  END LOOP;
  IF (SELECT count(DISTINCT value) FROM jsonb_each_text(all_sides))<>3 THEN RAISE EXCEPTION 'Use the same three tents throughout.'; END IF;
  INSERT INTO private.intertent_fixtures(championship_id,sequence,stage,leg,planned_at) VALUES
    (cid,17,'semi',1,((p_first_tuesday+28)+time '18:00') AT TIME ZONE 'Africa/Douala'),
    (cid,18,'semi',2,((p_first_tuesday+30)+time '18:00') AT TIME ZONE 'Africa/Douala'),
    (cid,19,'final',1,((p_first_tuesday+35)+time '18:00') AT TIME ZONE 'Africa/Douala');
  RETURN cid;
END; $$;

CREATE FUNCTION private.intertent_create_room(p_fixture uuid) RETURNS uuid
LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE f private.intertent_fixtures%ROWTYPE; c private.intertent_championships%ROWTYPE; rid uuid;
  label text; starts timestamptz; player uuid;
BEGIN
  SELECT * INTO STRICT f FROM private.intertent_fixtures WHERE id=p_fixture FOR UPDATE;
  IF f.room_id IS NOT NULL THEN RETURN f.room_id; END IF;
  SELECT * INTO STRICT c FROM private.intertent_championships WHERE id=f.championship_id;
  IF c.status NOT IN ('scheduled','playing') OR cardinality(f.player_ids)<>(CASE f.stage WHEN 'group' THEN 4 WHEN 'semi' THEN 3 ELSE 2 END) THEN RAISE EXCEPTION 'The championship fixture is not ready.'; END IF;
  -- Never schedule an already elapsed fixture automatically.
  IF f.planned_at<=now() THEN RAISE EXCEPTION 'This fixture needs rescheduling.'; END IF;
  starts:=f.planned_at;
  label:=CASE f.stage WHEN 'group' THEN 'Group '||f.group_key||' Series '||ceil(f.leg/2.0)::integer::text||' '||CASE WHEN f.leg%2=1 THEN 'Home' ELSE 'Away' END WHEN 'semi' THEN 'Semifinal '||CASE WHEN f.leg=1 THEN 'Home' ELSE 'Away' END ELSE 'Grand final' END;
  INSERT INTO public.arena_rooms(creator_id,room_name,stake_amount,max_players,status,tagged_user_ids,game_call_fee,expires_at)
  VALUES(f.player_ids[1],'David Inter-Tent · '||label||' [arena:journey] [character:david] [intertent]',0,cardinality(f.player_ids),'waiting',f.player_ids,0,starts+interval '3 hours') RETURNING id INTO rid;
  INSERT INTO public.arena_scheduled_matches(room_id,scheduled_by,starts_at,player_ids,is_intertent_match)
  VALUES(rid,c.created_by,starts,f.player_ids,true);
  UPDATE private.intertent_fixtures SET room_id=rid WHERE id=p_fixture;
  FOREACH player IN ARRAY f.player_ids LOOP
    PERFORM public.notify_user(player,c.created_by,'arena','Inter-Tent Championship match scheduled',label||' · David Journey Trivia','arena',jsonb_build_object('room_id',rid,'starts_at',starts));
  END LOOP;
  RETURN rid;
END; $$;

CREATE FUNCTION public.activate_intertent_championship(p_championship uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE actor uuid:=auth.uid(); c private.intertent_championships%ROWTYPE; f record; player uuid; tent uuid;
BEGIN
  IF actor IS NULL OR NOT public.is_instructor(actor) THEN RAISE EXCEPTION 'Only an instructor may activate this championship.'; END IF;
  SELECT * INTO STRICT c FROM private.intertent_championships WHERE id=p_championship AND camp_id=private.scripture_question_camp(actor) FOR UPDATE;
  IF c.status<>'draft' THEN RAISE EXCEPTION 'This championship is already activated.'; END IF;
  FOR f IN SELECT DISTINCT e.key::uuid AS player,e.value::uuid AS tent FROM private.intertent_fixtures x CROSS JOIN LATERAL jsonb_each_text(x.sides) e WHERE x.championship_id=c.id LOOP
    player:=f.player; tent:=f.tent;
    IF private.intertent_cadet_tent(player,c.camp_id) IS DISTINCT FROM tent OR NOT private.intertent_qualified(player) THEN
      RAISE EXCEPTION '% must meet 500 Figs and 3 Rhudes and belong to the selected tent before activation.',(SELECT display_name FROM public.profiles WHERE id=player);
    END IF;
  END LOOP;
  UPDATE private.intertent_championships SET status='scheduled' WHERE id=c.id;
  FOR f IN SELECT id FROM private.intertent_fixtures WHERE championship_id=c.id AND stage='group' ORDER BY sequence LOOP
    PERFORM private.intertent_create_room(f.id);
  END LOOP;
END; $$;

CREATE FUNCTION public.reschedule_intertent_fixture(p_fixture uuid,p_planned_at timestamptz) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE actor uuid:=auth.uid(); c private.intertent_championships%ROWTYPE; f private.intertent_fixtures%ROWTYPE; r public.arena_rooms%ROWTYPE; player uuid;
BEGIN
  IF actor IS NULL OR NOT public.is_instructor(actor) THEN RAISE EXCEPTION 'Only an instructor may reschedule a fixture.'; END IF;
  IF p_planned_at IS NULL OR p_planned_at<now()+interval '2 minutes' OR p_planned_at>now()+interval '90 days' THEN RAISE EXCEPTION 'Choose a future match time.'; END IF;
  SELECT * INTO STRICT f FROM private.intertent_fixtures WHERE id=p_fixture FOR UPDATE;
  SELECT * INTO STRICT c FROM private.intertent_championships WHERE id=f.championship_id AND camp_id=private.scripture_question_camp(actor) FOR UPDATE;
  IF c.status NOT IN ('scheduled','playing') OR f.result IS NOT NULL OR cardinality(f.player_ids)=0 THEN RAISE EXCEPTION 'Only an unfinished fixture with selected players can be rescheduled.'; END IF;
  IF f.room_id IS NOT NULL THEN
    SELECT * INTO STRICT r FROM public.arena_rooms WHERE id=f.room_id FOR UPDATE;
    IF r.status='waiting' AND NOT EXISTS(SELECT 1 FROM public.arena_participants WHERE room_id=r.id) THEN
      UPDATE private.intertent_fixtures SET planned_at=p_planned_at WHERE id=f.id;
      UPDATE public.arena_scheduled_matches SET starts_at=p_planned_at WHERE room_id=r.id;
      UPDATE public.arena_rooms SET expires_at=p_planned_at+interval '3 hours' WHERE id=r.id;
      FOREACH player IN ARRAY f.player_ids LOOP
        PERFORM public.notify_user(player,actor,'arena','Inter-Tent match rescheduled','The fixture has a new start time.','arena',jsonb_build_object('room_id',r.id,'starts_at',p_planned_at));
      END LOOP;
      RETURN;
    ELSIF r.status NOT IN ('expired','cancelled','completed') THEN RAISE EXCEPTION 'An active fixture cannot be rescheduled.';
    ELSIF r.status='completed' AND r.winner_id IS NOT NULL THEN RAISE EXCEPTION 'A decided fixture cannot be rescheduled.';
    END IF;
  END IF;
  UPDATE private.intertent_fixtures SET planned_at=p_planned_at,room_id=NULL WHERE id=f.id;
  PERFORM private.intertent_create_room(f.id);
END; $$;

-- Called only by the Journey server; clients cannot choose or modify alliances.
CREATE FUNCTION public.get_intertent_match_sides(p_room_id uuid) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  SELECT sides FROM private.intertent_fixtures WHERE room_id=p_room_id;
$$;
REVOKE ALL ON FUNCTION public.get_intertent_match_sides(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_intertent_match_sides(uuid) TO service_role;

CREATE FUNCTION private.intertent_before_start() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE f private.intertent_fixtures%ROWTYPE;
BEGIN
  IF NEW.status<>'playing' OR OLD.status='playing' THEN RETURN NEW; END IF;
  SELECT * INTO f FROM private.intertent_fixtures WHERE room_id=NEW.id;
  IF NOT FOUND THEN RETURN NEW; END IF;
  PERFORM 1 FROM private.intertent_championships WHERE id=f.championship_id FOR UPDATE;
  IF EXISTS (SELECT 1 FROM unnest(f.player_ids) p WHERE NOT EXISTS(SELECT 1 FROM public.arena_participants a WHERE a.room_id=NEW.id AND a.user_id=p AND a.forfeited_at IS NULL)) THEN RAISE EXCEPTION 'All scheduled players must be present.'; END IF;
  IF EXISTS (SELECT 1 FROM private.intertent_fixtures x JOIN public.arena_rooms r ON r.id=x.room_id WHERE x.championship_id=f.championship_id AND x.id<>f.id AND r.status='playing') THEN RAISE EXCEPTION 'Another championship match is still being played.'; END IF;
  IF EXISTS (SELECT 1 FROM private.intertent_fixtures x WHERE x.championship_id=f.championship_id AND x.planned_at<f.planned_at AND (x.planned_at AT TIME ZONE 'Africa/Douala')::date=(f.planned_at AT TIME ZONE 'Africa/Douala')::date AND x.result IS NULL) THEN RAISE EXCEPTION 'The preceding match must be completed first.'; END IF;
  UPDATE private.intertent_championships SET status='playing' WHERE id=f.championship_id AND status='scheduled';
  RETURN NEW;
END; $$;
CREATE TRIGGER intertent_before_start BEFORE UPDATE OF status ON public.arena_rooms FOR EACH ROW EXECUTE FUNCTION private.intertent_before_start();

CREATE FUNCTION private.intertent_settle_match() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
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
END; $$;
CREATE TRIGGER intertent_settle_match AFTER UPDATE OF status ON public.arena_rooms FOR EACH ROW EXECUTE FUNCTION private.intertent_settle_match();

CREATE FUNCTION public.get_intertent_championships() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE actor uuid:=auth.uid(); camp bigint; manager boolean;
BEGIN
  IF actor IS NULL THEN RAISE EXCEPTION 'Sign in to view the championship.'; END IF;
  camp:=private.scripture_question_camp(actor); manager:=public.is_instructor(actor);
  RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('id',c.id,'title',c.title,'status',c.status,'opening_at',c.opening_at,'can_manage',manager,
    'champion',(SELECT display_name FROM public.profiles WHERE id=c.champion_id),
    'eligibility',CASE WHEN manager AND c.status='draft' THEN (SELECT coalesce(jsonb_agg(jsonb_build_object('user_id',p.id,'name',p.display_name,'qualified',private.intertent_qualified(p.id)) ORDER BY p.display_name),'[]') FROM public.profiles p WHERE p.id IN (SELECT DISTINCT u FROM private.intertent_fixtures f CROSS JOIN LATERAL unnest(f.player_ids) u WHERE f.championship_id=c.id)) ELSE '[]'::jsonb END,
    'standings',(SELECT coalesce(jsonb_agg(jsonb_build_object('user_id',r.user_id,'name',p.display_name,'tent_id',r.tent_id,'tent_name',t.name,'matches',r.matches,'points',r.points,'average',round(r.average,3)) ORDER BY r.average DESC,r.answers DESC,r.score DESC,r.user_id),'[]') FROM private.intertent_rank(c.id,'group') r JOIN public.profiles p ON p.id=r.user_id JOIN public.tents t ON t.id=r.tent_id),
    'semifinal_standings',(SELECT coalesce(jsonb_agg(jsonb_build_object('user_id',r.user_id,'name',p.display_name,'tent_name',t.name,'matches',r.matches,'points',r.points) ORDER BY r.points DESC,r.answers DESC,r.score DESC,r.user_id),'[]') FROM private.intertent_rank(c.id,'semi') r JOIN public.profiles p ON p.id=r.user_id JOIN public.tents t ON t.id=r.tent_id),
    'fixtures',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',f.id,'sequence',f.sequence,'stage',f.stage,'group_key',f.group_key,'leg',f.leg,'planned_at',f.planned_at,'room_id',f.room_id,'room_status',room.status,'result',f.result,
      'sides',(SELECT coalesce(jsonb_agg(jsonb_build_object('tent_id',s.tent_id,'tent_name',s.tent_name,'players',s.players) ORDER BY s.first_slot),'[]') FROM (SELECT t.id tent_id,t.name tent_name,min(u.slot) first_slot,jsonb_agg(jsonb_build_object('id',p.id,'name',p.display_name) ORDER BY u.slot) players FROM unnest(f.player_ids) WITH ORDINALITY u(uid,slot) JOIN public.profiles p ON p.id=u.uid JOIN public.tents t ON t.id=(f.sides->>u.uid::text)::uuid GROUP BY t.id,t.name) s)) ORDER BY f.sequence),'[]') FROM private.intertent_fixtures f LEFT JOIN public.arena_rooms room ON room.id=f.room_id WHERE f.championship_id=c.id)
  ) ORDER BY c.created_at DESC) FROM (SELECT * FROM private.intertent_championships WHERE camp_id=camp ORDER BY created_at DESC LIMIT 4) c),'[]');
END; $$;

REVOKE ALL ON FUNCTION public.create_intertent_david_championship(jsonb,date,uuid),public.activate_intertent_championship(uuid),public.reschedule_intertent_fixture(uuid,timestamptz),public.get_intertent_championships() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.create_intertent_david_championship(jsonb,date,uuid),public.activate_intertent_championship(uuid),public.reschedule_intertent_fixture(uuid,timestamptz),public.get_intertent_championships() TO authenticated;
REVOKE ALL ON FUNCTION private.intertent_cadet_tent(uuid,bigint),private.intertent_qualified(uuid),private.intertent_rank(uuid,text),private.intertent_create_room(uuid),private.intertent_before_start(),private.intertent_settle_match() FROM PUBLIC,anon,authenticated;
COMMIT;
